import { createHash } from "node:crypto";

import {
  ApprovalRequestId,
  type AssistantDeliveryMode,
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  NativeSubagentTraceItemId,
  type ModelSelection,
  type NativeSubagentTraceItemKind,
  type NativeSubagentTraceItemStatus,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationNativeSubagentTraceItem,
  type OrchestrationProposedPlanId,
  type OrchestrationTeamTask,
  CheckpointRef,
  isToolLifecycleItemType,
  ProviderKind,
  TeamTaskId,
  ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { Cache, Cause, Duration, Effect, Layer, Option, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { isGitRepository } from "../../git/Utils.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProviderRuntimeIngestionService,
  type ProviderRuntimeIngestionShape,
} from "../Services/ProviderRuntimeIngestion.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const providerTurnKey = (threadId: ThreadId, turnId: TurnId) => `${threadId}:${turnId}`;
const providerCommandId = (event: ProviderRuntimeEvent, tag: string): CommandId =>
  CommandId.make(`provider:${event.eventId}:${tag}:${crypto.randomUUID()}`);

interface AssistantSegmentState {
  baseKey: string;
  nextSegmentIndex: number;
  activeMessageId: MessageId | null;
}

const TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY = 10_000;
const TURN_MESSAGE_IDS_BY_TURN_TTL = Duration.minutes(120);
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY = 20_000;
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL = Duration.minutes(120);
const BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY = 10_000;
const BUFFERED_PROPOSED_PLAN_BY_ID_TTL = Duration.minutes(120);
const MAX_BUFFERED_ASSISTANT_CHARS = 24_000;
const STRICT_PROVIDER_LIFECYCLE_GUARD = process.env.T3CODE_STRICT_PROVIDER_LIFECYCLE_GUARD !== "0";

type TurnStartRequestedDomainEvent = Extract<
  OrchestrationEvent,
  { type: "thread.turn-start-requested" }
>;

type RuntimeIngestionInput =
  | {
      source: "runtime";
      event: ProviderRuntimeEvent;
    }
  | {
      source: "domain";
      event: TurnStartRequestedDomainEvent;
    };

function toTurnId(value: TurnId | string | undefined): TurnId | undefined {
  return value === undefined ? undefined : TurnId.make(String(value));
}

function toApprovalRequestId(value: string | undefined): ApprovalRequestId | undefined {
  return value === undefined ? undefined : ApprovalRequestId.make(value);
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

function truncateDetail(value: string, limit = 180): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function trimNonEmpty(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function nativeTaskHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function deriveNativeTeamTaskId(input: {
  readonly provider: ProviderKind;
  readonly parentThreadId: ThreadId;
  readonly providerTaskId: string;
}): TeamTaskId {
  const hash = nativeTaskHash(`${input.provider}:${input.parentThreadId}:${input.providerTaskId}`);
  return TeamTaskId.make(`team-task:native:${input.provider}:${hash}`);
}

function deriveNativeChildThreadId(input: {
  readonly provider: ProviderKind;
  readonly parentThreadId: ThreadId;
  readonly providerTaskId: string;
}): ThreadId {
  const hash = nativeTaskHash(`${input.provider}:${input.parentThreadId}:${input.providerTaskId}`);
  return ThreadId.make(`native-child:${input.provider}:${hash}`);
}

function nativeTaskModelSelection(input: {
  readonly provider: ProviderKind;
  readonly parentModelSelection: ModelSelection;
}): ModelSelection {
  return input.parentModelSelection.provider === input.provider
    ? input.parentModelSelection
    : {
        provider: input.provider,
        model: DEFAULT_MODEL_BY_PROVIDER[input.provider],
      };
}

interface CodexCollabAgentState {
  readonly message?: string | null;
  readonly status?: string | null;
}

interface CodexCollabAgentItem {
  readonly agentsStates?: Record<string, CodexCollabAgentState>;
  readonly model?: string | null;
  readonly prompt?: string | null;
  readonly receiverThreadIds?: ReadonlyArray<string>;
  readonly tool?: string | null;
}

function codexCollabAgentItem(data: unknown): CodexCollabAgentItem | null {
  if (typeof data !== "object" || data === null) return null;
  const payload = data as { readonly item?: unknown };
  if (typeof payload.item !== "object" || payload.item === null) return null;
  const item = payload.item as {
    readonly agentsStates?: unknown;
    readonly model?: unknown;
    readonly prompt?: unknown;
    readonly receiverThreadIds?: unknown;
    readonly tool?: unknown;
  };
  const receiverThreadIds = Array.isArray(item.receiverThreadIds)
    ? item.receiverThreadIds.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : undefined;
  const agentsStates =
    typeof item.agentsStates === "object" && item.agentsStates !== null
      ? Object.fromEntries(
          Object.entries(item.agentsStates as Record<string, unknown>)
            .filter(([key]) => key.trim().length > 0)
            .map(([key, value]) => {
              const state =
                typeof value === "object" && value !== null
                  ? (value as { readonly message?: unknown; readonly status?: unknown })
                  : {};
              return [
                key,
                {
                  message: typeof state.message === "string" ? state.message : null,
                  status: typeof state.status === "string" ? state.status : null,
                },
              ];
            }),
        )
      : undefined;

  return {
    ...(agentsStates ? { agentsStates } : {}),
    ...(typeof item.model === "string" ? { model: item.model } : {}),
    ...(typeof item.prompt === "string" ? { prompt: item.prompt } : {}),
    ...(receiverThreadIds && receiverThreadIds.length > 0 ? { receiverThreadIds } : {}),
    ...(typeof item.tool === "string" ? { tool: item.tool } : {}),
  };
}

function codexReceiverThreadIds(item: CodexCollabAgentItem): ReadonlyArray<string> {
  const ids = new Set<string>();
  for (const receiverThreadId of item.receiverThreadIds ?? []) {
    ids.add(receiverThreadId);
  }
  for (const receiverThreadId of Object.keys(item.agentsStates ?? {})) {
    if (receiverThreadId.trim().length > 0) {
      ids.add(receiverThreadId);
    }
  }
  return [...ids];
}

function codexNativeTaskStatus(input: {
  readonly eventType: "item.started" | "item.completed";
  readonly itemStatus?: string | undefined;
  readonly tool?: string | null | undefined;
  readonly agentState?: CodexCollabAgentState | undefined;
}): OrchestrationTeamTask["status"] {
  const agentStatus = input.agentState?.status;
  switch (agentStatus) {
    case "completed":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "stopped":
    case "cancelled":
    case "declined":
      return "cancelled";
    default:
      break;
  }

  if (input.itemStatus === "failed") return "failed";
  if (input.itemStatus === "declined") return "cancelled";

  // Codex marks the spawnAgent tool call completed as soon as the child
  // thread is created. The child itself is still pending/running and later
  // reports completion through wait-agent collab events.
  if (input.tool === "spawnAgent") return "running";
  if (input.eventType === "item.started") return "running";
  return input.tool === "wait" && input.itemStatus === "completed" ? "completed" : "running";
}

function nativeTeamTasksFromRuntimeEvent(input: {
  readonly event: ProviderRuntimeEvent;
  readonly thread: { readonly id: ThreadId; readonly modelSelection: ModelSelection };
}): ReadonlyArray<OrchestrationTeamTask> {
  const { event, thread } = input;
  const provider = event.provider;
  const providerTurnId = event.turnId ? String(event.turnId) : undefined;

  if (
    provider === "claudeAgent" &&
    (event.type === "task.started" ||
      event.type === "task.progress" ||
      event.type === "task.completed")
  ) {
    let providerTaskId: string;
    let description: string | undefined;
    let title: string;
    let status: OrchestrationTeamTask["status"];
    let latestSummary: string | null;
    let toolName: string | undefined;
    const rawPayload = rawRecord(event.raw?.payload);
    const providerSessionId =
      typeof rawPayload?.session_id === "string" ? rawPayload.session_id : undefined;

    if (event.type === "task.started") {
      providerTaskId = String(event.payload.taskId);
      description = trimNonEmpty(event.payload.description);
      title = description ?? trimNonEmpty(event.payload.taskType) ?? "Native subagent";
      status = "running";
      latestSummary = null;
    } else if (event.type === "task.progress") {
      providerTaskId = String(event.payload.taskId);
      description = trimNonEmpty(event.payload.description);
      title = trimNonEmpty(event.payload.summary) ?? description ?? "Native subagent";
      status = "running";
      latestSummary = trimNonEmpty(event.payload.summary) ?? description ?? null;
      toolName = event.payload.lastToolName;
    } else {
      providerTaskId = String(event.payload.taskId);
      description = trimNonEmpty(event.payload.summary);
      title = description ?? "Native subagent";
      status =
        event.payload.status === "failed"
          ? "failed"
          : event.payload.status === "stopped"
            ? "cancelled"
            : "completed";
      latestSummary = description ?? null;
    }

    return [
      {
        id: deriveNativeTeamTaskId({
          provider,
          parentThreadId: thread.id,
          providerTaskId,
        }),
        parentThreadId: thread.id,
        childThreadId: deriveNativeChildThreadId({
          provider,
          parentThreadId: thread.id,
          providerTaskId,
        }),
        title,
        task: description ?? "Provider-native Claude subagent",
        roleLabel: null,
        kind: "general",
        modelSelection: nativeTaskModelSelection({
          provider,
          parentModelSelection: thread.modelSelection,
        }),
        modelSelectionMode: "coordinator-selected",
        modelSelectionReason:
          "Provider-native subagent; exact worker runtime is managed by the provider.",
        workspaceMode: "shared",
        resolvedWorkspaceMode: "shared",
        setupMode: "skip",
        resolvedSetupMode: "skip",
        source: "native-provider",
        childThreadMaterialized: false,
        nativeProviderRef: {
          provider,
          providerTaskId,
          ...(providerTurnId ? { providerTurnId } : {}),
          ...(toolName ? { toolName } : {}),
          ...(providerSessionId ? { providerSessionId } : {}),
        },
        status,
        latestSummary,
        errorText: status === "failed" ? latestSummary : null,
        createdAt: event.createdAt,
        startedAt: status === "running" ? event.createdAt : null,
        completedAt:
          status === "completed" || status === "failed" || status === "cancelled"
            ? event.createdAt
            : null,
        updatedAt: event.createdAt,
      },
    ];
  }

  if (
    provider === "codex" &&
    (event.type === "item.started" || event.type === "item.completed") &&
    event.payload.itemType === "collab_agent_tool_call"
  ) {
    const item = codexCollabAgentItem(event.payload.data);
    if (!item) return [];
    const receiverThreadIds = codexReceiverThreadIds(item);
    if (receiverThreadIds.length === 0) return [];

    const providerItemId = String(event.itemId ?? event.eventId);
    const detail = trimNonEmpty(event.payload.detail);
    const prompt = trimNonEmpty(item.prompt);

    return receiverThreadIds.map((receiverThreadId) => {
      const agentState = item.agentsStates?.[receiverThreadId];
      const status = codexNativeTaskStatus({
        eventType: event.type,
        itemStatus: event.payload.status,
        tool: item.tool,
        agentState,
      });
      const latestSummary =
        status === "completed" || status === "failed" || status === "cancelled"
          ? (trimNonEmpty(agentState?.message) ?? detail ?? null)
          : (trimNonEmpty(agentState?.message) ?? null);
      const providerTaskId = `receiver:${receiverThreadId}`;
      return {
        id: deriveNativeTeamTaskId({
          provider,
          parentThreadId: thread.id,
          providerTaskId,
        }),
        parentThreadId: thread.id,
        childThreadId: deriveNativeChildThreadId({
          provider,
          parentThreadId: thread.id,
          providerTaskId,
        }),
        title: detail ?? prompt ?? "Native subagent",
        task: prompt ?? detail ?? "Provider-native Codex subagent",
        roleLabel: null,
        kind: "general",
        modelSelection: nativeTaskModelSelection({
          provider,
          parentModelSelection: thread.modelSelection,
        }),
        modelSelectionMode: "coordinator-selected",
        modelSelectionReason:
          "Provider-native subagent; exact worker runtime is managed by the provider.",
        workspaceMode: "shared",
        resolvedWorkspaceMode: "shared",
        setupMode: "skip",
        resolvedSetupMode: "skip",
        source: "native-provider",
        childThreadMaterialized: false,
        nativeProviderRef: {
          provider,
          providerItemId,
          ...(providerTurnId ? { providerTurnId } : {}),
          providerThreadIds: [receiverThreadId],
          ...(item.tool ? { toolName: item.tool } : {}),
        },
        status,
        latestSummary,
        errorText: status === "failed" ? latestSummary : null,
        createdAt: event.createdAt,
        startedAt: status === "running" ? event.createdAt : null,
        completedAt:
          status === "completed" || status === "failed" || status === "cancelled"
            ? event.createdAt
            : null,
        updatedAt: event.createdAt,
      };
    });
  }

  return [];
}

function safeJsonSummary(value: unknown, limit = 400): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return truncateDetail(value, limit);
  try {
    return truncateDetail(JSON.stringify(value), limit);
  } catch {
    return null;
  }
}

function rawRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function providerThreadIdFromRawEvent(event: ProviderRuntimeEvent): string | null {
  const payload = rawRecord(event.raw?.payload);
  const threadId = payload?.threadId;
  if (typeof threadId === "string" && threadId.trim().length > 0) return threadId;
  const thread = rawRecord(payload?.thread);
  const nestedThreadId = thread?.id;
  return typeof nestedThreadId === "string" && nestedThreadId.trim().length > 0
    ? nestedThreadId
    : null;
}

function rawItemRecord(event: ProviderRuntimeEvent): Record<string, unknown> | null {
  return rawRecord(rawRecord(event.raw?.payload)?.item);
}

function textFromRawItem(event: ProviderRuntimeEvent): string | null {
  const item = rawItemRecord(event);
  const text = item?.text ?? item?.message;
  if (typeof text === "string" && text.trim().length > 0) return text;
  const content = item?.content;
  if (typeof content === "string" && content.trim().length > 0) return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((entry) => {
        const record = rawRecord(entry);
        const entryText = record?.text ?? record?.content;
        return typeof entryText === "string" ? entryText : "";
      })
      .filter((entry) => entry.trim().length > 0);
    if (parts.length > 0) return parts.join("\n");
  }
  return null;
}

function nativeTraceItemId(input: {
  readonly taskId: string;
  readonly providerThreadId: string | null;
  readonly providerItemId: string | null;
  readonly suffix?: string;
}): NativeSubagentTraceItemId {
  const raw = [
    "native-trace",
    input.taskId,
    input.providerThreadId ?? "thread",
    input.providerItemId ?? "item",
    input.suffix ?? "main",
  ].join(":");
  return NativeSubagentTraceItemId.make(raw);
}

function traceStatusFromRuntimeStatus(status: string | undefined): NativeSubagentTraceItemStatus {
  switch (status) {
    case "failed":
    case "declined":
      return "failed";
    case "cancelled":
    case "stopped":
      return "cancelled";
    case "completed":
      return "completed";
    default:
      return "running";
  }
}

function traceKindForItemType(
  itemType: string,
  streamKind?: string,
): NativeSubagentTraceItemKind | null {
  switch (itemType) {
    case "user_message":
      return "user_message";
    case "assistant_message":
      return "assistant_message";
    case "reasoning":
      return streamKind === "reasoning_summary_text" ? "reasoning_summary" : null;
    case "command_execution":
      return "command_output";
    case "file_change":
      return "file_change";
    case "mcp_tool_call":
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
    case "web_search":
    case "image_view":
      return "tool_call";
    case "error":
      return "error";
    default:
      return streamKind === "reasoning_summary_text" ? "reasoning_summary" : null;
  }
}

function findNativeTaskForProviderEvent(input: {
  readonly event: ProviderRuntimeEvent;
  readonly thread: { readonly teamTasks?: ReadonlyArray<OrchestrationTeamTask> };
  readonly nativeTeamTasks: ReadonlyArray<OrchestrationTeamTask>;
}): OrchestrationTeamTask | null {
  const nativeTasks = [...(input.thread.teamTasks ?? []), ...input.nativeTeamTasks].filter(
    (task) => task.source === "native-provider" && task.childThreadMaterialized === false,
  );

  if (input.event.provider === "codex") {
    const providerThreadId = providerThreadIdFromRawEvent(input.event);
    if (!providerThreadId) return null;
    return (
      nativeTasks.find((task) =>
        task.nativeProviderRef?.providerThreadIds?.includes(providerThreadId),
      ) ?? null
    );
  }

  if (
    input.event.provider === "claudeAgent" &&
    (input.event.type === "task.started" ||
      input.event.type === "task.progress" ||
      input.event.type === "task.completed")
  ) {
    const taskId = String(input.event.payload.taskId);
    return nativeTasks.find((task) => task.nativeProviderRef?.providerTaskId === taskId) ?? null;
  }

  return null;
}

function nativeTraceCommandsFromRuntimeEvent(input: {
  readonly event: ProviderRuntimeEvent;
  readonly task: OrchestrationTeamTask;
}): ReadonlyArray<OrchestrationCommand> {
  const { event, task } = input;
  const providerThreadId = providerThreadIdFromRawEvent(event);
  const providerItemId = event.itemId ? String(event.itemId) : null;
  const providerTurnId = event.turnId ? String(event.turnId) : null;
  const sequence = Math.max(0, Date.parse(event.createdAt) || 0);
  const baseItem = (params: {
    readonly id: NativeSubagentTraceItemId;
    readonly kind: NativeSubagentTraceItemKind;
    readonly status?: NativeSubagentTraceItemStatus;
    readonly title?: string | null;
    readonly detail?: string | null;
    readonly text?: string | null;
    readonly toolName?: string | null;
    readonly inputSummary?: string | null;
    readonly outputSummary?: string | null;
  }): OrchestrationNativeSubagentTraceItem => ({
    id: params.id,
    parentThreadId: task.parentThreadId,
    taskId: task.id,
    provider: event.provider,
    providerThreadId,
    providerTurnId,
    providerItemId,
    providerToolUseId: null,
    kind: params.kind,
    status: params.status ?? "running",
    title: params.title ?? null,
    detail: params.detail ?? null,
    text: params.text ?? null,
    toolName: params.toolName ?? null,
    inputSummary: params.inputSummary ?? null,
    outputSummary: params.outputSummary ?? null,
    sequence,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    completedAt: params.status && params.status !== "running" ? event.createdAt : null,
  });
  const upsert = (item: OrchestrationNativeSubagentTraceItem): OrchestrationCommand => ({
    type: "thread.team-task.native-trace.upsert-item",
    commandId: CommandId.make(`provider-native-trace:${event.eventId}:${item.id}:upsert`),
    parentThreadId: task.parentThreadId,
    taskId: task.id,
    item,
    createdAt: event.createdAt,
  });
  const append = (
    traceItemId: NativeSubagentTraceItemId,
    delta: string,
    suffix: string,
  ): OrchestrationCommand => ({
    type: "thread.team-task.native-trace.append-content",
    commandId: CommandId.make(`provider-native-trace:${event.eventId}:${traceItemId}:${suffix}`),
    parentThreadId: task.parentThreadId,
    taskId: task.id,
    traceItemId,
    delta,
    updatedAt: event.createdAt,
    createdAt: event.createdAt,
  });
  const complete = (
    traceItemId: NativeSubagentTraceItemId,
    status: NativeSubagentTraceItemStatus,
    detail: string | null,
  ): OrchestrationCommand => ({
    type: "thread.team-task.native-trace.mark-completed",
    commandId: CommandId.make(`provider-native-trace:${event.eventId}:${traceItemId}:complete`),
    parentThreadId: task.parentThreadId,
    taskId: task.id,
    traceItemId,
    status,
    detail,
    completedAt: event.createdAt,
    updatedAt: event.createdAt,
    createdAt: event.createdAt,
  });

  if (
    event.provider === "claudeAgent" &&
    (event.type === "task.started" ||
      event.type === "task.progress" ||
      event.type === "task.completed")
  ) {
    const providerTaskId = String(event.payload.taskId);
    const id = nativeTraceItemId({
      taskId: task.id,
      providerThreadId,
      providerItemId: providerTaskId,
      suffix: event.type,
    });
    const status =
      event.type === "task.completed"
        ? event.payload.status === "failed"
          ? "failed"
          : event.payload.status === "stopped"
            ? "cancelled"
            : "completed"
        : "running";
    return [
      upsert(
        baseItem({
          id,
          kind: "lifecycle",
          status,
          title:
            event.type === "task.started"
              ? "Task started"
              : event.type === "task.progress"
                ? "Task progress"
                : "Task completed",
          detail:
            event.type === "task.started"
              ? (event.payload.description ?? null)
              : event.type === "task.progress"
                ? (event.payload.summary ?? event.payload.description ?? null)
                : (event.payload.summary ?? null),
          outputSummary: event.type === "task.completed" ? (event.payload.summary ?? null) : null,
        }),
      ),
    ];
  }

  if (event.provider !== "codex") return [];

  if (event.type === "item.started" || event.type === "item.completed") {
    const kind = traceKindForItemType(event.payload.itemType);
    if (!kind) return [];
    const id = nativeTraceItemId({ taskId: task.id, providerThreadId, providerItemId });
    const status =
      event.type === "item.completed"
        ? traceStatusFromRuntimeStatus(event.payload.status)
        : "running";
    return [
      upsert(
        baseItem({
          id,
          kind,
          status,
          title: event.payload.title ?? event.payload.itemType,
          detail: event.payload.detail ?? null,
          text: kind === "user_message" ? textFromRawItem(event) : null,
          toolName: kind === "tool_call" ? (event.payload.title ?? null) : null,
          inputSummary: safeJsonSummary(rawItemRecord(event)?.input),
          outputSummary:
            event.type === "item.completed"
              ? (event.payload.detail ?? safeJsonSummary(rawItemRecord(event)?.output))
              : null,
        }),
      ),
      ...(event.type === "item.completed"
        ? [complete(id, status, event.payload.detail ?? null)]
        : []),
    ];
  }

  if (event.type === "content.delta") {
    if (event.payload.streamKind === "reasoning_text") return [];
    const kind =
      event.payload.streamKind === "assistant_text"
        ? "assistant_message"
        : event.payload.streamKind === "reasoning_summary_text"
          ? "reasoning_summary"
          : event.payload.streamKind === "command_output"
            ? "command_output"
            : event.payload.streamKind === "file_change_output"
              ? "file_change"
              : null;
    if (!kind) return [];
    const id = nativeTraceItemId({
      taskId: task.id,
      providerThreadId,
      providerItemId,
      ...(kind === "reasoning_summary" ? { suffix: "reasoning-summary" } : {}),
    });
    return [
      upsert(
        baseItem({
          id,
          kind,
          title: kind === "reasoning_summary" ? "Reasoning summary" : null,
        }),
      ),
      append(id, event.payload.delta, "delta"),
    ];
  }

  if (event.type === "tool.progress" || event.type === "tool.summary") {
    const id = nativeTraceItemId({
      taskId: task.id,
      providerThreadId,
      providerItemId: providerItemId ?? String(event.eventId),
      suffix: event.type,
    });
    return [
      upsert(
        baseItem({
          id,
          kind: "tool_output",
          title: event.type === "tool.progress" ? "Tool progress" : "Tool summary",
          detail: event.type === "tool.progress" ? (event.payload.summary ?? null) : null,
          outputSummary: event.type === "tool.summary" ? event.payload.summary : null,
          toolName: event.type === "tool.progress" ? (event.payload.toolName ?? null) : null,
        }),
      ),
    ];
  }

  if (event.type === "runtime.error") {
    const id = nativeTraceItemId({
      taskId: task.id,
      providerThreadId,
      providerItemId: providerItemId ?? String(event.eventId),
      suffix: "error",
    });
    return [
      upsert(
        baseItem({
          id,
          kind: "error",
          status: "failed",
          title: "Provider error",
          detail: event.payload.message,
        }),
      ),
    ];
  }

  return [];
}

function normalizeProposedPlanMarkdown(planMarkdown: string | undefined): string | undefined {
  const trimmed = planMarkdown?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function hasRenderableAssistantText(text: string | undefined): boolean {
  return (text?.trim().length ?? 0) > 0;
}

function proposedPlanIdForTurn(threadId: ThreadId, turnId: TurnId): string {
  return `plan:${threadId}:turn:${turnId}`;
}

function proposedPlanIdFromEvent(event: ProviderRuntimeEvent, threadId: ThreadId): string {
  const turnId = toTurnId(event.turnId);
  if (turnId) {
    return proposedPlanIdForTurn(threadId, turnId);
  }
  if (event.itemId) {
    return `plan:${threadId}:item:${event.itemId}`;
  }
  return `plan:${threadId}:event:${event.eventId}`;
}

function assistantSegmentBaseKeyFromEvent(event: ProviderRuntimeEvent): string {
  return String(event.itemId ?? event.turnId ?? event.eventId);
}

function assistantSegmentMessageId(baseKey: string, segmentIndex: number): MessageId {
  return MessageId.make(
    segmentIndex === 0 ? `assistant:${baseKey}` : `assistant:${baseKey}:segment:${segmentIndex}`,
  );
}
function buildContextWindowActivityPayload(
  event: ProviderRuntimeEvent,
): ThreadTokenUsageSnapshot | undefined {
  if (event.type !== "thread.token-usage.updated" || event.payload.usage.usedTokens <= 0) {
    return undefined;
  }
  return event.payload.usage;
}

function normalizeRuntimeTurnState(
  value: string | undefined,
): "completed" | "failed" | "interrupted" | "cancelled" {
  switch (value) {
    case "failed":
    case "interrupted":
    case "cancelled":
    case "completed":
      return value;
    default:
      return "completed";
  }
}

function orchestrationSessionStatusFromRuntimeState(
  state: "starting" | "running" | "waiting" | "ready" | "interrupted" | "stopped" | "error",
): "starting" | "running" | "ready" | "interrupted" | "stopped" | "error" {
  switch (state) {
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "ready":
      return "ready";
    case "interrupted":
      return "interrupted";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
  }
}

function requestKindFromCanonicalRequestType(
  requestType: string | undefined,
): "command" | "file-read" | "file-change" | undefined {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return undefined;
  }
}

function runtimeEventToActivities(
  event: ProviderRuntimeEvent,
): ReadonlyArray<OrchestrationThreadActivity> {
  const maybeSequence = (() => {
    const eventWithSequence = event as ProviderRuntimeEvent & { sessionSequence?: number };
    return eventWithSequence.sessionSequence !== undefined
      ? { sequence: eventWithSequence.sessionSequence }
      : {};
  })();
  switch (event.type) {
    case "request.opened": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: "approval.requested",
          summary:
            requestKind === "command"
              ? "Command approval requested"
              : requestKind === "file-read"
                ? "File-read approval requested"
                : requestKind === "file-change"
                  ? "File-change approval requested"
                  : "Approval requested",
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "request.resolved": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: "approval.resolved",
          summary: "Approval resolved",
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.decision ? { decision: event.payload.decision } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.error": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "error",
          kind: "runtime.error",
          summary: "Runtime error",
          payload: {
            message: truncateDetail(event.payload.message),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.warning": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "runtime.warning",
          summary: "Runtime warning",
          payload: {
            message: truncateDetail(event.payload.message),
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "turn.plan.updated": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "turn.plan.updated",
          summary: "Plan updated",
          payload: {
            plan: event.payload.plan,
            ...(event.payload.explanation !== undefined
              ? { explanation: event.payload.explanation }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.requested": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.requested",
          summary: "User input requested",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            questions: event.payload.questions,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.resolved": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.resolved",
          summary: "User input submitted",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            answers: event.payload.answers,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.started": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.started",
          summary:
            event.payload.taskType === "plan"
              ? "Plan task started"
              : event.payload.taskType
                ? `${event.payload.taskType} task started`
                : "Task started",
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.taskType ? { taskType: event.payload.taskType } : {}),
            ...(event.payload.description
              ? { detail: truncateDetail(event.payload.description) }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.progress": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.progress",
          summary: "Reasoning update",
          payload: {
            taskId: event.payload.taskId,
            detail: truncateDetail(event.payload.summary ?? event.payload.description),
            ...(event.payload.summary ? { summary: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.lastToolName ? { lastToolName: event.payload.lastToolName } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.completed": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.status === "failed" ? "error" : "info",
          kind: "task.completed",
          summary:
            event.payload.status === "failed"
              ? "Task failed"
              : event.payload.status === "stopped"
                ? "Task stopped"
                : "Task completed",
          payload: {
            taskId: event.payload.taskId,
            status: event.payload.status,
            ...(event.payload.summary ? { detail: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.state.changed": {
      if (event.payload.state !== "compacted") {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-compaction",
          summary: "Context compacted",
          payload: {
            state: event.payload.state,
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.token-usage.updated": {
      const payload = buildContextWindowActivityPayload(event);
      if (!payload) {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-window.updated",
          summary: "Context window updated",
          payload,
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.updated": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.updated",
          summary: event.payload.title ?? "Tool updated",
          payload: {
            itemType: event.payload.itemType,
            ...(event.payload.status ? { status: event.payload.status } : {}),
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.completed": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.completed",
          summary: event.payload.title ?? "Tool",
          payload: {
            itemType: event.payload.itemType,
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.started": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.started",
          summary: `${event.payload.title ?? "Tool"} started`,
          payload: {
            itemType: event.payload.itemType,
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    default:
      break;
  }

  return [];
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const serverSettingsService = yield* ServerSettingsService;

  const turnMessageIdsByTurnKey = yield* Cache.make<string, Set<MessageId>>({
    capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
    timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
    lookup: () => Effect.succeed(new Set<MessageId>()),
  });

  const bufferedAssistantTextByMessageId = yield* Cache.make<MessageId, string>({
    capacity: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL,
    lookup: () => Effect.succeed(""),
  });

  const assistantSegmentStateByTurnKey = yield* Cache.make<string, AssistantSegmentState>({
    capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
    timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
    lookup: () =>
      Effect.die(
        new Error("assistant segment state should be read through getOption before initialization"),
      ),
  });

  const bufferedProposedPlanById = yield* Cache.make<string, { text: string; createdAt: string }>({
    capacity: BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_PROPOSED_PLAN_BY_ID_TTL,
    lookup: () => Effect.succeed({ text: "", createdAt: "" }),
  });

  const isGitRepoForThread = Effect.fn("isGitRepoForThread")(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (!thread) {
      return false;
    }
    const workspaceCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: readModel.projects,
    });
    if (!workspaceCwd) {
      return false;
    }
    return isGitRepository(workspaceCwd);
  });

  const rememberAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Cache.set(
          turnMessageIdsByTurnKey,
          providerTurnKey(threadId, turnId),
          Option.match(existingIds, {
            onNone: () => new Set([messageId]),
            onSome: (ids) => {
              const nextIds = new Set(ids);
              nextIds.add(messageId);
              return nextIds;
            },
          }),
        ),
      ),
    );

  const forgetAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Option.match(existingIds, {
          onNone: () => Effect.void,
          onSome: (ids) => {
            const nextIds = new Set(ids);
            nextIds.delete(messageId);
            if (nextIds.size === 0) {
              return Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));
            }
            return Cache.set(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId), nextIds);
          },
        }),
      ),
    );

  const getAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.map((existingIds) =>
        Option.getOrElse(existingIds, (): Set<MessageId> => new Set<MessageId>()),
      ),
    );

  const clearAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));

  const getAssistantSegmentStateForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.getOption(assistantSegmentStateByTurnKey, providerTurnKey(threadId, turnId));

  const setAssistantSegmentStateForTurn = (
    threadId: ThreadId,
    turnId: TurnId,
    state: AssistantSegmentState,
  ) => Cache.set(assistantSegmentStateByTurnKey, providerTurnKey(threadId, turnId), state);

  const clearAssistantSegmentStateForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.invalidate(assistantSegmentStateByTurnKey, providerTurnKey(threadId, turnId));

  const getActiveAssistantMessageIdForTurn = (threadId: ThreadId, turnId: TurnId) =>
    getAssistantSegmentStateForTurn(threadId, turnId).pipe(
      Effect.map((state) =>
        Option.flatMap(state, (entry) =>
          entry.activeMessageId ? Option.some(entry.activeMessageId) : Option.none(),
        ),
      ),
    );

  const startAssistantSegmentForTurn = (input: {
    threadId: ThreadId;
    turnId: TurnId;
    baseKey: string;
  }) =>
    getAssistantSegmentStateForTurn(input.threadId, input.turnId).pipe(
      Effect.flatMap((existingState) =>
        Effect.gen(function* () {
          const nextState = Option.match(existingState, {
            onNone: () => ({
              baseKey: input.baseKey,
              nextSegmentIndex: 1,
              activeMessageId: assistantSegmentMessageId(input.baseKey, 0),
            }),
            onSome: (state) => {
              const segmentIndex = state.baseKey === input.baseKey ? state.nextSegmentIndex : 0;
              const messageId = assistantSegmentMessageId(input.baseKey, segmentIndex);
              return {
                baseKey: input.baseKey,
                nextSegmentIndex: state.baseKey === input.baseKey ? state.nextSegmentIndex + 1 : 1,
                activeMessageId: messageId,
              } satisfies AssistantSegmentState;
            },
          });
          yield* setAssistantSegmentStateForTurn(input.threadId, input.turnId, nextState);
          return nextState.activeMessageId!;
        }),
      ),
    );

  const getOrCreateAssistantMessageId = (input: {
    threadId: ThreadId;
    event: ProviderRuntimeEvent;
    turnId?: TurnId;
  }) =>
    Effect.gen(function* () {
      if (!input.turnId) {
        return assistantSegmentMessageId(assistantSegmentBaseKeyFromEvent(input.event), 0);
      }

      const activeMessageId = yield* getActiveAssistantMessageIdForTurn(
        input.threadId,
        input.turnId,
      );
      if (Option.isSome(activeMessageId)) {
        return activeMessageId.value;
      }

      return yield* startAssistantSegmentForTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        baseKey: assistantSegmentBaseKeyFromEvent(input.event),
      });
    });

  const appendBufferedAssistantText = (messageId: MessageId, delta: string) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existingText) =>
        Effect.gen(function* () {
          const nextText = Option.match(existingText, {
            onNone: () => delta,
            onSome: (text) => `${text}${delta}`,
          });
          if (nextText.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
            yield* Cache.set(bufferedAssistantTextByMessageId, messageId, nextText);
            return "";
          }

          // Safety valve: flush full buffered text as an assistant delta to cap memory.
          yield* Cache.invalidate(bufferedAssistantTextByMessageId, messageId);
          return nextText;
        }),
      ),
    );

  const takeBufferedAssistantText = (messageId: MessageId) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existingText) =>
        Cache.invalidate(bufferedAssistantTextByMessageId, messageId).pipe(
          Effect.as(Option.getOrElse(existingText, () => "")),
        ),
      ),
    );

  const clearBufferedAssistantText = (messageId: MessageId) =>
    Cache.invalidate(bufferedAssistantTextByMessageId, messageId);

  const appendBufferedProposedPlan = (planId: string, delta: string, createdAt: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) => {
        const existing = Option.getOrUndefined(existingEntry);
        return Cache.set(bufferedProposedPlanById, planId, {
          text: `${existing?.text ?? ""}${delta}`,
          createdAt:
            existing?.createdAt && existing.createdAt.length > 0 ? existing.createdAt : createdAt,
        });
      }),
    );

  const takeBufferedProposedPlan = (planId: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) =>
        Cache.invalidate(bufferedProposedPlanById, planId).pipe(
          Effect.as(Option.getOrUndefined(existingEntry)),
        ),
      ),
    );

  const clearBufferedProposedPlan = (planId: string) =>
    Cache.invalidate(bufferedProposedPlanById, planId);

  const clearAssistantMessageState = (messageId: MessageId) =>
    clearBufferedAssistantText(messageId);

  const flushBufferedAssistantMessage = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    messageId: MessageId;
    turnId?: TurnId;
    createdAt: string;
    commandTag: string;
  }) =>
    Effect.gen(function* () {
      const bufferedText = yield* takeBufferedAssistantText(input.messageId);
      if (!hasRenderableAssistantText(bufferedText)) {
        return false;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: providerCommandId(input.event, input.commandTag),
        threadId: input.threadId,
        messageId: input.messageId,
        delta: bufferedText,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        createdAt: input.createdAt,
      });
      return true;
    });

  const flushBufferedAssistantMessagesForTurn = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    turnId: TurnId;
    createdAt: string;
    commandTag: string;
  }) =>
    Effect.gen(function* () {
      const assistantMessageIds = yield* getAssistantMessageIdsForTurn(
        input.threadId,
        input.turnId,
      );
      const flushedMessageIds = new Set<MessageId>();
      yield* Effect.forEach(
        assistantMessageIds,
        (messageId) =>
          flushBufferedAssistantMessage({
            event: input.event,
            threadId: input.threadId,
            messageId,
            turnId: input.turnId,
            createdAt: input.createdAt,
            commandTag: input.commandTag,
          }).pipe(
            Effect.tap((flushed) =>
              flushed ? Effect.sync(() => flushedMessageIds.add(messageId)) : Effect.void,
            ),
          ),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      return flushedMessageIds;
    });

  const finalizeAssistantMessage = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    messageId: MessageId;
    turnId?: TurnId;
    createdAt: string;
    commandTag: string;
    finalDeltaCommandTag: string;
    fallbackText?: string;
    hasProjectedMessage?: boolean;
  }) =>
    Effect.gen(function* () {
      const bufferedText = yield* takeBufferedAssistantText(input.messageId);
      const text =
        bufferedText.length > 0
          ? bufferedText
          : (input.fallbackText?.trim().length ?? 0) > 0
            ? input.fallbackText!
            : "";
      const hasRenderableText = hasRenderableAssistantText(text);

      if (hasRenderableText) {
        yield* orchestrationEngine.dispatch({
          type: "thread.message.assistant.delta",
          commandId: providerCommandId(input.event, input.finalDeltaCommandTag),
          threadId: input.threadId,
          messageId: input.messageId,
          delta: text,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          createdAt: input.createdAt,
        });
      }

      if (input.hasProjectedMessage || hasRenderableText) {
        yield* orchestrationEngine.dispatch({
          type: "thread.message.assistant.complete",
          commandId: providerCommandId(input.event, input.commandTag),
          threadId: input.threadId,
          messageId: input.messageId,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          createdAt: input.createdAt,
        });
      }
      yield* clearAssistantMessageState(input.messageId);
    });

  const finalizeActiveAssistantSegmentForTurn = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    turnId: TurnId;
    createdAt: string;
    commandTag: string;
    finalDeltaCommandTag: string;
    hasProjectedMessage: boolean;
    flushedMessageIds?: ReadonlySet<MessageId>;
  }) =>
    Effect.gen(function* () {
      const activeMessageId = yield* getActiveAssistantMessageIdForTurn(
        input.threadId,
        input.turnId,
      );
      if (Option.isNone(activeMessageId)) {
        return;
      }

      yield* finalizeAssistantMessage({
        event: input.event,
        threadId: input.threadId,
        messageId: activeMessageId.value,
        turnId: input.turnId,
        createdAt: input.createdAt,
        commandTag: input.commandTag,
        finalDeltaCommandTag: input.finalDeltaCommandTag,
        hasProjectedMessage:
          input.hasProjectedMessage ||
          (input.flushedMessageIds?.has(activeMessageId.value) ?? false),
      });
      yield* forgetAssistantMessageId(input.threadId, input.turnId, activeMessageId.value);

      const state = yield* getAssistantSegmentStateForTurn(input.threadId, input.turnId);
      if (Option.isSome(state)) {
        yield* setAssistantSegmentStateForTurn(input.threadId, input.turnId, {
          ...state.value,
          activeMessageId: null,
        });
      }
    });

  const upsertProposedPlan = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    planMarkdown: string | undefined;
    createdAt: string;
    updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const planMarkdown = normalizeProposedPlanMarkdown(input.planMarkdown);
      if (!planMarkdown) {
        return;
      }

      const existingPlan = input.threadProposedPlans.find((entry) => entry.id === input.planId);
      yield* orchestrationEngine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: providerCommandId(input.event, "proposed-plan-upsert"),
        threadId: input.threadId,
        proposedPlan: {
          id: input.planId,
          turnId: input.turnId ?? null,
          planMarkdown,
          implementedAt: existingPlan?.implementedAt ?? null,
          implementationThreadId: existingPlan?.implementationThreadId ?? null,
          createdAt: existingPlan?.createdAt ?? input.createdAt,
          updatedAt: input.updatedAt,
        },
        createdAt: input.updatedAt,
      });
    });

  const finalizeBufferedProposedPlan = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    fallbackMarkdown?: string;
    updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const bufferedPlan = yield* takeBufferedProposedPlan(input.planId);
      const bufferedMarkdown = normalizeProposedPlanMarkdown(bufferedPlan?.text);
      const fallbackMarkdown = normalizeProposedPlanMarkdown(input.fallbackMarkdown);
      const planMarkdown = bufferedMarkdown ?? fallbackMarkdown;
      if (!planMarkdown) {
        return;
      }

      yield* upsertProposedPlan({
        event: input.event,
        threadId: input.threadId,
        threadProposedPlans: input.threadProposedPlans,
        planId: input.planId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        planMarkdown,
        createdAt:
          bufferedPlan?.createdAt && bufferedPlan.createdAt.length > 0
            ? bufferedPlan.createdAt
            : input.updatedAt,
        updatedAt: input.updatedAt,
      });
      yield* clearBufferedProposedPlan(input.planId);
    });

  const clearTurnStateForSession = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const prefix = `${threadId}:`;
      const proposedPlanPrefix = `plan:${threadId}:`;
      const turnKeys = Array.from(yield* Cache.keys(turnMessageIdsByTurnKey));
      const assistantSegmentKeys = Array.from(yield* Cache.keys(assistantSegmentStateByTurnKey));
      const proposedPlanKeys = Array.from(yield* Cache.keys(bufferedProposedPlanById));
      yield* Effect.forEach(
        turnKeys,
        (key) =>
          Effect.gen(function* () {
            if (!key.startsWith(prefix)) {
              return;
            }

            const messageIds = yield* Cache.getOption(turnMessageIdsByTurnKey, key);
            if (Option.isSome(messageIds)) {
              yield* Effect.forEach(messageIds.value, clearAssistantMessageState, {
                concurrency: 1,
              }).pipe(Effect.asVoid);
            }

            yield* Cache.invalidate(turnMessageIdsByTurnKey, key);
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        assistantSegmentKeys,
        (key) =>
          key.startsWith(prefix)
            ? Cache.invalidate(assistantSegmentStateByTurnKey, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        proposedPlanKeys,
        (key) =>
          key.startsWith(proposedPlanPrefix)
            ? Cache.invalidate(bufferedProposedPlanById, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
    });

  const getSourceProposedPlanReferenceForPendingTurnStart = Effect.fn(
    "getSourceProposedPlanReferenceForPendingTurnStart",
  )(function* (threadId: ThreadId) {
    const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
      threadId,
    });
    if (Option.isNone(pendingTurnStart)) {
      return null;
    }

    const sourceThreadId = pendingTurnStart.value.sourceProposedPlanThreadId;
    const sourcePlanId = pendingTurnStart.value.sourceProposedPlanId;
    if (sourceThreadId === null || sourcePlanId === null) {
      return null;
    }

    return {
      sourceThreadId,
      sourcePlanId,
    } as const;
  });

  const getExpectedProviderTurnIdForThread = Effect.fn("getExpectedProviderTurnIdForThread")(
    function* (threadId: ThreadId) {
      const sessions = yield* providerService.listSessions();
      const session = sessions.find((entry) => entry.threadId === threadId);
      return session?.activeTurnId;
    },
  );

  const getSourceProposedPlanReferenceForAcceptedTurnStart = Effect.fn(
    "getSourceProposedPlanReferenceForAcceptedTurnStart",
  )(function* (threadId: ThreadId, eventTurnId: TurnId | undefined) {
    if (eventTurnId === undefined) {
      return null;
    }

    const expectedTurnId = yield* getExpectedProviderTurnIdForThread(threadId);
    if (!sameId(expectedTurnId, eventTurnId)) {
      return null;
    }

    return yield* getSourceProposedPlanReferenceForPendingTurnStart(threadId);
  });

  const markSourceProposedPlanImplemented = Effect.fn("markSourceProposedPlanImplemented")(
    function* (
      sourceThreadId: ThreadId,
      sourcePlanId: OrchestrationProposedPlanId,
      implementationThreadId: ThreadId,
      implementedAt: string,
    ) {
      const readModel = yield* orchestrationEngine.getReadModel();
      const sourceThread = readModel.threads.find((entry) => entry.id === sourceThreadId);
      const sourcePlan = sourceThread?.proposedPlans.find((entry) => entry.id === sourcePlanId);
      if (!sourceThread || !sourcePlan || sourcePlan.implementedAt !== null) {
        return;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: CommandId.make(
          `provider:source-proposed-plan-implemented:${implementationThreadId}:${crypto.randomUUID()}`,
        ),
        threadId: sourceThread.id,
        proposedPlan: {
          ...sourcePlan,
          implementedAt,
          implementationThreadId,
          updatedAt: implementedAt,
        },
        createdAt: implementedAt,
      });
    },
  );

  const processRuntimeEvent = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((entry) => entry.id === event.threadId);
      if (!thread) return;

      const now = event.createdAt;
      const eventTurnId = toTurnId(event.turnId);
      const activeTurnId = thread.session?.activeTurnId ?? null;

      const conflictsWithActiveTurn =
        activeTurnId !== null && eventTurnId !== undefined && !sameId(activeTurnId, eventTurnId);
      const missingTurnForActiveTurn = activeTurnId !== null && eventTurnId === undefined;

      const shouldApplyThreadLifecycle = (() => {
        if (!STRICT_PROVIDER_LIFECYCLE_GUARD) {
          return true;
        }
        switch (event.type) {
          case "session.exited":
            return true;
          case "session.started":
          case "thread.started":
            return true;
          case "turn.started":
            return !conflictsWithActiveTurn;
          case "turn.completed":
            if (conflictsWithActiveTurn || missingTurnForActiveTurn) {
              return false;
            }
            // Only the active turn may close the lifecycle state.
            if (activeTurnId !== null && eventTurnId !== undefined) {
              return sameId(activeTurnId, eventTurnId);
            }
            // If no active turn is tracked, accept completion scoped to this thread.
            return true;
          default:
            return true;
        }
      })();
      const acceptedTurnStartedSourcePlan =
        event.type === "turn.started" && shouldApplyThreadLifecycle
          ? yield* getSourceProposedPlanReferenceForAcceptedTurnStart(thread.id, eventTurnId)
          : null;

      if (
        event.type === "session.started" ||
        event.type === "session.state.changed" ||
        event.type === "session.exited" ||
        event.type === "thread.started" ||
        event.type === "turn.started" ||
        event.type === "turn.completed"
      ) {
        const nextActiveTurnId =
          event.type === "turn.started"
            ? (eventTurnId ?? null)
            : event.type === "turn.completed" || event.type === "session.exited"
              ? null
              : activeTurnId;
        const status = (() => {
          switch (event.type) {
            case "session.state.changed":
              return orchestrationSessionStatusFromRuntimeState(event.payload.state);
            case "turn.started":
              return "running";
            case "session.exited":
              return "stopped";
            case "turn.completed":
              return normalizeRuntimeTurnState(event.payload.state) === "failed"
                ? "error"
                : "ready";
            case "session.started":
            case "thread.started":
              // Provider thread/session start notifications can arrive during an
              // active turn; preserve turn-running state in that case.
              return activeTurnId !== null ? "running" : "ready";
          }
        })();
        const lastError =
          event.type === "session.state.changed" && event.payload.state === "error"
            ? (event.payload.reason ?? thread.session?.lastError ?? "Provider session error")
            : event.type === "turn.completed" &&
                normalizeRuntimeTurnState(event.payload.state) === "failed"
              ? (event.payload.errorMessage ?? thread.session?.lastError ?? "Turn failed")
              : status === "ready"
                ? null
                : (thread.session?.lastError ?? null);

        if (shouldApplyThreadLifecycle) {
          if (event.type === "turn.started" && acceptedTurnStartedSourcePlan !== null) {
            yield* markSourceProposedPlanImplemented(
              acceptedTurnStartedSourcePlan.sourceThreadId,
              acceptedTurnStartedSourcePlan.sourcePlanId,
              thread.id,
              now,
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning(
                  "provider runtime ingestion failed to mark source proposed plan",
                  {
                    eventId: event.eventId,
                    eventType: event.type,
                    cause: Cause.pretty(cause),
                  },
                ),
              ),
            );
          }

          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: providerCommandId(event, "thread-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status,
              providerName: event.provider,
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: nextActiveTurnId,
              lastError,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
      }

      const assistantDelta =
        event.type === "content.delta" && event.payload.streamKind === "assistant_text"
          ? event.payload.delta
          : undefined;
      const proposedPlanDelta =
        event.type === "turn.proposed.delta" ? event.payload.delta : undefined;

      if (assistantDelta && assistantDelta.length > 0) {
        const turnId = toTurnId(event.turnId);
        const assistantMessageId = yield* getOrCreateAssistantMessageId({
          threadId: thread.id,
          event,
          ...(turnId ? { turnId } : {}),
        });
        if (turnId) {
          yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
        }

        const assistantDeliveryMode: AssistantDeliveryMode = yield* Effect.map(
          serverSettingsService.getSettings,
          (settings) => (settings.enableAssistantStreaming ? "streaming" : "buffered"),
        );
        if (assistantDeliveryMode === "buffered") {
          const spillChunk = yield* appendBufferedAssistantText(assistantMessageId, assistantDelta);
          if (spillChunk.length > 0) {
            yield* orchestrationEngine.dispatch({
              type: "thread.message.assistant.delta",
              commandId: providerCommandId(event, "assistant-delta-buffer-spill"),
              threadId: thread.id,
              messageId: assistantMessageId,
              delta: spillChunk,
              ...(turnId ? { turnId } : {}),
              createdAt: now,
            });
          }
        } else {
          yield* orchestrationEngine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: providerCommandId(event, "assistant-delta"),
            threadId: thread.id,
            messageId: assistantMessageId,
            delta: assistantDelta,
            ...(turnId ? { turnId } : {}),
            createdAt: now,
          });
        }
      }

      const pauseForUserTurnId =
        event.type === "request.opened" || event.type === "user-input.requested"
          ? toTurnId(event.turnId)
          : undefined;
      if (pauseForUserTurnId) {
        const assistantDeliveryMode: AssistantDeliveryMode = yield* Effect.map(
          serverSettingsService.getSettings,
          (settings) => (settings.enableAssistantStreaming ? "streaming" : "buffered"),
        );
        const flushedMessageIds =
          assistantDeliveryMode === "buffered"
            ? yield* flushBufferedAssistantMessagesForTurn({
                event,
                threadId: thread.id,
                turnId: pauseForUserTurnId,
                createdAt: now,
                commandTag:
                  event.type === "request.opened"
                    ? "assistant-delta-flush-on-request-opened"
                    : "assistant-delta-flush-on-user-input-requested",
              })
            : new Set<MessageId>();
        yield* finalizeActiveAssistantSegmentForTurn({
          event,
          threadId: thread.id,
          turnId: pauseForUserTurnId,
          createdAt: now,
          commandTag:
            event.type === "request.opened"
              ? "assistant-complete-on-request-opened"
              : "assistant-complete-on-user-input-requested",
          finalDeltaCommandTag:
            event.type === "request.opened"
              ? "assistant-delta-finalize-on-request-opened"
              : "assistant-delta-finalize-on-user-input-requested",
          hasProjectedMessage: thread.messages.some(
            (entry) =>
              entry.role === "assistant" && entry.turnId === pauseForUserTurnId && entry.streaming,
          ),
          flushedMessageIds,
        });
      }

      if (proposedPlanDelta && proposedPlanDelta.length > 0) {
        const planId = proposedPlanIdFromEvent(event, thread.id);
        yield* appendBufferedProposedPlan(planId, proposedPlanDelta, now);
      }

      const assistantCompletion =
        event.type === "item.completed" && event.payload.itemType === "assistant_message"
          ? {
              messageId: MessageId.make(
                `assistant:${event.itemId ?? event.turnId ?? event.eventId}`,
              ),
              fallbackText: event.payload.detail,
            }
          : undefined;
      const proposedPlanCompletion =
        event.type === "turn.proposed.completed"
          ? {
              planId: proposedPlanIdFromEvent(event, thread.id),
              turnId: toTurnId(event.turnId),
              planMarkdown: event.payload.planMarkdown,
            }
          : undefined;

      if (assistantCompletion) {
        const turnId = toTurnId(event.turnId);
        const activeAssistantMessageId = turnId
          ? yield* getActiveAssistantMessageIdForTurn(thread.id, turnId)
          : Option.none<MessageId>();
        const hasAssistantMessagesForTurn =
          turnId !== undefined
            ? thread.messages.some((entry) => entry.role === "assistant" && entry.turnId === turnId)
            : false;
        const assistantMessageId = Option.getOrElse(
          activeAssistantMessageId,
          () => assistantCompletion.messageId,
        );
        const existingAssistantMessage = thread.messages.find(
          (entry) => entry.id === assistantMessageId,
        );
        const shouldApplyFallbackCompletionText =
          !existingAssistantMessage || existingAssistantMessage.text.length === 0;

        const shouldSkipRedundantCompletion =
          Option.isNone(activeAssistantMessageId) &&
          turnId !== undefined &&
          hasAssistantMessagesForTurn &&
          (assistantCompletion.fallbackText?.trim().length ?? 0) === 0;

        if (!shouldSkipRedundantCompletion) {
          if (turnId && Option.isNone(activeAssistantMessageId)) {
            yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
          }

          yield* finalizeAssistantMessage({
            event,
            threadId: thread.id,
            messageId: assistantMessageId,
            ...(turnId ? { turnId } : {}),
            createdAt: now,
            commandTag: "assistant-complete",
            finalDeltaCommandTag: "assistant-delta-finalize",
            hasProjectedMessage: existingAssistantMessage !== undefined,
            ...(assistantCompletion.fallbackText !== undefined && shouldApplyFallbackCompletionText
              ? { fallbackText: assistantCompletion.fallbackText }
              : {}),
          });

          if (turnId) {
            yield* forgetAssistantMessageId(thread.id, turnId, assistantMessageId);
          }
        }

        if (turnId) {
          yield* clearAssistantSegmentStateForTurn(thread.id, turnId);
        }
      }

      if (proposedPlanCompletion) {
        yield* finalizeBufferedProposedPlan({
          event,
          threadId: thread.id,
          threadProposedPlans: thread.proposedPlans,
          planId: proposedPlanCompletion.planId,
          ...(proposedPlanCompletion.turnId ? { turnId: proposedPlanCompletion.turnId } : {}),
          fallbackMarkdown: proposedPlanCompletion.planMarkdown,
          updatedAt: now,
        });
      }

      if (event.type === "turn.completed") {
        const turnId = toTurnId(event.turnId);
        if (turnId) {
          const assistantMessageIds = yield* getAssistantMessageIdsForTurn(thread.id, turnId);
          yield* Effect.forEach(
            assistantMessageIds,
            (assistantMessageId) =>
              finalizeAssistantMessage({
                event,
                threadId: thread.id,
                messageId: assistantMessageId,
                turnId,
                createdAt: now,
                commandTag: "assistant-complete-finalize",
                finalDeltaCommandTag: "assistant-delta-finalize-fallback",
                hasProjectedMessage: thread.messages.some(
                  (entry) => entry.id === assistantMessageId,
                ),
              }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          yield* clearAssistantMessageIdsForTurn(thread.id, turnId);
          yield* clearAssistantSegmentStateForTurn(thread.id, turnId);

          yield* finalizeBufferedProposedPlan({
            event,
            threadId: thread.id,
            threadProposedPlans: thread.proposedPlans,
            planId: proposedPlanIdForTurn(thread.id, turnId),
            turnId,
            updatedAt: now,
          });
        }
      }

      if (event.type === "session.exited") {
        yield* clearTurnStateForSession(thread.id);
      }

      if (event.type === "runtime.error") {
        const runtimeErrorMessage = event.payload.message;

        const shouldApplyRuntimeError = !STRICT_PROVIDER_LIFECYCLE_GUARD
          ? true
          : activeTurnId === null || eventTurnId === undefined || sameId(activeTurnId, eventTurnId);

        if (shouldApplyRuntimeError) {
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: providerCommandId(event, "runtime-error-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "error",
              providerName: event.provider,
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: eventTurnId ?? null,
              lastError: runtimeErrorMessage,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
      }

      if (event.type === "thread.metadata.updated" && event.payload.name) {
        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: providerCommandId(event, "thread-meta-update"),
          threadId: thread.id,
          title: event.payload.name,
        });
      }

      if (event.type === "turn.diff.updated") {
        const turnId = toTurnId(event.turnId);
        if (turnId && (yield* isGitRepoForThread(thread.id))) {
          // Skip if a checkpoint already exists for this turn. A real
          // (non-placeholder) capture from CheckpointReactor should not
          // be clobbered, and dispatching a duplicate placeholder for the
          // same turnId would produce an unstable checkpointTurnCount.
          if (thread.checkpoints.some((c) => c.turnId === turnId)) {
            // Already tracked; no-op.
          } else {
            const assistantMessageId = MessageId.make(
              `assistant:${event.itemId ?? event.turnId ?? event.eventId}`,
            );
            const maxTurnCount = thread.checkpoints.reduce(
              (max, c) => Math.max(max, c.checkpointTurnCount),
              0,
            );
            yield* orchestrationEngine.dispatch({
              type: "thread.turn.diff.complete",
              commandId: providerCommandId(event, "thread-turn-diff-complete"),
              threadId: thread.id,
              turnId,
              completedAt: now,
              checkpointRef: CheckpointRef.make(`provider-diff:${event.eventId}`),
              status: "missing",
              files: [],
              assistantMessageId,
              checkpointTurnCount: maxTurnCount + 1,
              createdAt: now,
            });
          }
        }
      }

      // The v1 orchestrator rejects `thread.team-task.upsert-native` for
      // threads that already have a `teamParent`, since child threads cannot
      // delegate to more team agents. Dispatching anyway just produces a
      // stream of `OrchestrationCommandInvariantError` warnings on every
      // task event a child agent emits — skip the dispatch entirely instead.
      const nativeTeamTasks =
        thread.teamParent != null ? [] : nativeTeamTasksFromRuntimeEvent({ event, thread });
      yield* Effect.forEach(nativeTeamTasks, (nativeTeamTask) =>
        orchestrationEngine.dispatch({
          type: "thread.team-task.upsert-native",
          commandId: CommandId.make(
            `provider-native-team-task:${event.eventId}:${nativeTeamTask.id}:upsert`,
          ),
          parentThreadId: thread.id,
          teamTask: nativeTeamTask,
          createdAt: now,
        }),
      ).pipe(Effect.asVoid);

      const nativeTraceTask = findNativeTaskForProviderEvent({
        event,
        thread,
        nativeTeamTasks,
      });
      if (nativeTraceTask) {
        yield* Effect.forEach(
          nativeTraceCommandsFromRuntimeEvent({ event, task: nativeTraceTask }),
          (command) => orchestrationEngine.dispatch(command),
          { concurrency: 1 },
        ).pipe(Effect.asVoid);
      }

      const activities = runtimeEventToActivities(event);
      yield* Effect.forEach(activities, (activity) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: providerCommandId(event, "thread-activity-append"),
          threadId: thread.id,
          activity,
          createdAt: activity.createdAt,
        }),
      ).pipe(Effect.asVoid);
    });

  const processDomainEvent = (_event: TurnStartRequestedDomainEvent) => Effect.void;

  const processInput = (input: RuntimeIngestionInput) =>
    input.source === "runtime" ? processRuntimeEvent(input.event) : processDomainEvent(input.event);

  const processInputSafely = (input: RuntimeIngestionInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider runtime ingestion failed to process event", {
          source: input.source,
          eventId: input.event.eventId,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: ProviderRuntimeIngestionShape["start"] = () =>
    Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(providerService.streamEvents, (event) =>
          worker.enqueue({ source: "runtime", event }),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (event.type !== "thread.turn-start-requested") {
            return Effect.void;
          }
          return worker.enqueue({ source: "domain", event });
        }),
      );
    });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderRuntimeIngestionShape;
});

export const ProviderRuntimeIngestionLive = Layer.effect(
  ProviderRuntimeIngestionService,
  make,
).pipe(Layer.provide(ProjectionTurnRepositoryLive));
