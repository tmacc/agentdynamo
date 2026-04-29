import {
  type ChatAttachment,
  CommandId,
  ContextHandoffId,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationEvent,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderKind,
  type OrchestrationSession,
  type OrchestrationThread,
  ThreadId,
  type ProviderSession,
  type RuntimeMode,
  type TurnId,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch, WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";
import { Cache, Cause, Duration, Effect, Equal, Exit, Layer, Option, Schema, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster.ts";
import { increment, orchestrationEventsProcessedTotal } from "../../observability/Metrics.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import type { ProviderServiceError } from "../../provider/Errors.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProviderCommandReactor,
  type ProviderCommandReactorShape,
} from "../Services/ProviderCommandReactor.ts";
import { renderContextHandoff, type ContextHandoffRenderResult } from "../contextHandoff.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ServerConfig } from "../../config.ts";
import { TeamCoordinatorAccess } from "../../team/Services/TeamCoordinatorAccess.ts";
import { isDedicatedDynamoTeamWorktreeTask } from "../../team/teamTaskGuards.ts";

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.runtime-mode-set"
      | "thread.turn-start-requested"
      | "thread.turn-interrupt-requested"
      | "thread.approval-response-requested"
      | "thread.user-input-response-requested"
      | "thread.session-stop-requested";
  }
>;

function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function mapProviderSessionStatusToOrchestrationStatus(
  status: "connecting" | "ready" | "running" | "error" | "closed",
): OrchestrationSession["status"] {
  switch (status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    default:
      return "ready";
  }
}

const turnStartKeyForEvent = (event: ProviderIntentEvent): string =>
  event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;

const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

const HANDLED_TURN_START_KEY_MAX = 10_000;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);
const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
const DEFAULT_THREAD_TITLE = "New thread";
const CONTEXT_HANDOFF_RESERVE_CHARS = 2_000;

function defaultForkThreadTitle(sourceTitle: string): string {
  return `Fork of ${sourceTitle}`;
}

function canReplaceThreadTitle(
  currentTitle: string,
  titleSeed?: string,
  forkOrigin?: { readonly sourceThreadTitle: string } | undefined,
): boolean {
  const trimmedCurrentTitle = currentTitle.trim();
  if (trimmedCurrentTitle === DEFAULT_THREAD_TITLE) {
    return true;
  }
  if (
    forkOrigin !== undefined &&
    trimmedCurrentTitle === defaultForkThreadTitle(forkOrigin.sourceThreadTitle).trim()
  ) {
    return true;
  }

  const trimmedTitleSeed = titleSeed?.trim();
  return trimmedTitleSeed !== undefined && trimmedTitleSeed.length > 0
    ? trimmedCurrentTitle === trimmedTitleSeed
    : false;
}

function isFirstLiveUserMessageTurn(input: {
  readonly thread: Pick<OrchestrationThread, "messages" | "forkOrigin">;
  readonly messageId: MessageId;
}): boolean {
  if (input.thread.forkOrigin === undefined) {
    return input.thread.messages.filter((entry) => entry.role === "user").length === 1;
  }

  const liveUserMessages = input.thread.messages
    .filter(
      (entry) =>
        entry.role === "user" &&
        entry.createdAt.localeCompare(input.thread.forkOrigin!.importedUntilAt) > 0,
    )
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );

  return liveUserMessages.length > 0 && liveUserMessages[0]?.id === input.messageId;
}

function hasPendingProviderInteraction(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
): boolean {
  const pendingApprovals = new Set<string>();
  const pendingUserInputs = new Set<string>();

  for (const activity of activities) {
    const payload =
      activity.payload !== null &&
      typeof activity.payload === "object" &&
      !Array.isArray(activity.payload)
        ? (activity.payload as Record<string, unknown>)
        : {};
    const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
    if (!requestId) {
      continue;
    }

    if (activity.kind === "approval.requested") {
      pendingApprovals.add(requestId);
    } else if (
      activity.kind === "approval.resolved" ||
      activity.kind === "provider.approval.respond.failed"
    ) {
      pendingApprovals.delete(requestId);
    } else if (activity.kind === "user-input.requested") {
      pendingUserInputs.add(requestId);
    } else if (
      activity.kind === "user-input.resolved" ||
      activity.kind === "provider.user-input.respond.failed"
    ) {
      pendingUserInputs.delete(requestId);
    }
  }

  return pendingApprovals.size > 0 || pendingUserInputs.size > 0;
}

function latestImportedContextTimestamp(input: {
  readonly thread: OrchestrationThread;
  readonly liveMessageId: MessageId;
}): string | null {
  const timestamps = [
    ...input.thread.messages
      .filter((message) => message.id !== input.liveMessageId)
      .map((message) => message.createdAt),
    ...input.thread.proposedPlans.map((plan) => plan.createdAt),
  ].toSorted();

  return timestamps.at(-1) ?? null;
}

function findPendingContextHandoffForTurn(input: {
  readonly thread: OrchestrationThread;
  readonly messageId: MessageId;
  readonly targetProvider: ProviderKind;
  readonly isFirstUserMessageTurn: boolean;
}) {
  return input.thread.contextHandoffs.find((handoff) => {
    if (handoff.status !== "pending") {
      return false;
    }
    if (handoff.targetProvider !== undefined && handoff.targetProvider !== input.targetProvider) {
      return false;
    }
    if (handoff.reason === "fork") {
      return input.isFirstUserMessageTurn;
    }
    return handoff.reason === "provider-switch";
  });
}

function findProviderAdapterRequestError(
  cause: Cause.Cause<ProviderServiceError>,
): ProviderAdapterRequestError | undefined {
  const failReason = cause.reasons.find(Cause.isFailReason);
  return Schema.is(ProviderAdapterRequestError)(failReason?.error) ? failReason.error : undefined;
}

function isUnknownPendingApprovalRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }
  const message = Cause.pretty(cause);
  return (
    message.includes("unknown pending approval request") ||
    message.includes("unknown pending permission request")
  );
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    return error.detail.toLowerCase().includes("unknown pending user-input request");
  }
  return Cause.pretty(cause).toLowerCase().includes("unknown pending user-input request");
}

function stalePendingRequestDetail(
  requestKind: "approval" | "user-input",
  requestId: string,
): string {
  return `Stale pending ${requestKind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`;
}

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "");

  const withoutPrefix = normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)
    ? normalized.slice(`${WORKTREE_BRANCH_PREFIX}/`.length)
    : normalized;

  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  const safeFragment = branchFragment.length > 0 ? branchFragment : "update";
  return `${WORKTREE_BRANCH_PREFIX}/${safeFragment}`;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const git = yield* GitCore;
  const gitStatusBroadcaster = yield* GitStatusBroadcaster;
  const textGeneration = yield* TextGeneration;
  const serverSettingsService = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;
  const teamCoordinatorAccess = yield* TeamCoordinatorAccess;
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const threadModelSelections = new Map<string, ModelSelection>();

  const appendProviderFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind:
      | "provider.turn.start.failed"
      | "provider.turn.interrupt.failed"
      | "provider.approval.respond.failed"
      | "provider.user-input.respond.failed"
      | "provider.session.stop.failed";
    readonly summary: string;
    readonly detail: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly requestId?: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("provider-failure-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.make(crypto.randomUUID()),
        tone: "error",
        kind: input.kind,
        summary: input.summary,
        payload: {
          detail: input.detail,
          ...(input.requestId ? { requestId: input.requestId } : {}),
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const formatFailureDetail = (cause: Cause.Cause<unknown>): string => {
    const failReason = cause.reasons.find(Cause.isFailReason);
    const providerError = Schema.is(ProviderAdapterRequestError)(failReason?.error)
      ? failReason.error
      : undefined;
    if (providerError) {
      return providerError.detail;
    }
    return Cause.pretty(cause);
  };

  const setThreadSession = (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: serverCommandId("provider-session-set"),
      threadId: input.threadId,
      session: input.session,
      createdAt: input.createdAt,
    });

  const setThreadSessionErrorOnTurnStartFailure = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly detail: string;
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    const session = thread?.session;
    if (!session) {
      return;
    }
    yield* setThreadSession({
      threadId: input.threadId,
      session: {
        ...session,
        status: session.status === "stopped" ? "stopped" : "ready",
        activeTurnId: null,
        lastError: input.detail,
        updatedAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    return readModel.threads.find((entry) => entry.id === threadId);
  });

  const ensureSessionForThread = Effect.fn("ensureSessionForThread")(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection;
    },
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (!thread) {
      return yield* Effect.die(new Error(`Thread '${threadId}' was not found in read model.`));
    }

    const desiredRuntimeMode = thread.runtimeMode;
    const currentProvider: ProviderKind | undefined = Schema.is(ProviderKind)(
      thread.session?.providerName,
    )
      ? thread.session.providerName
      : undefined;
    const requestedModelSelection = options?.modelSelection;
    const desiredModelSelection = requestedModelSelection ?? thread.modelSelection;
    const desiredProvider = desiredModelSelection.provider;
    const effectiveCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: readModel.projects,
    });

    const resolveActiveSession = (threadId: ThreadId) =>
      providerService
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));

    const resolveTeamCoordinator = Effect.fnUntraced(function* (provider: ProviderKind) {
      if (thread.teamParent != null) {
        return undefined;
      }
      const settings = yield* serverSettingsService.getSettings;
      if (!settings.teamAgents.enabled || !settings.teamAgents.coordinatorToolsOnTopLevelThreads) {
        return undefined;
      }
      const capabilities = yield* providerService.getCapabilities(provider);
      if (capabilities.teamCoordinatorTools !== "mcp-http") {
        return undefined;
      }
      const grant = yield* teamCoordinatorAccess.issueGrant({
        parentThreadId: thread.id,
        provider,
      });
      const host =
        serverConfig.host && serverConfig.host.length > 0 ? serverConfig.host : "127.0.0.1";
      return {
        parentThreadId: thread.id,
        grantId: grant.grantId,
        mcpServerName: "dynamo_team",
        mcpServerUrl: `http://${host}:${serverConfig.port}/api/team-mcp`,
        accessToken: grant.accessToken,
      };
    });

    const startProviderSession = (input?: {
      readonly resumeCursor?: unknown;
      readonly provider?: ProviderKind;
    }) => {
      const provider = input?.provider ?? desiredProvider;
      return Effect.gen(function* () {
        const teamCoordinator = yield* resolveTeamCoordinator(provider);
        const started = yield* Effect.exit(
          providerService.startSession(threadId, {
            threadId,
            provider,
            ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
            modelSelection: desiredModelSelection,
            ...(input?.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
            runtimeMode: desiredRuntimeMode,
            ...(teamCoordinator !== undefined
              ? {
                  teamCoordinator: {
                    parentThreadId: teamCoordinator.parentThreadId,
                    mcpServerName: teamCoordinator.mcpServerName,
                    mcpServerUrl: teamCoordinator.mcpServerUrl,
                    accessToken: teamCoordinator.accessToken,
                  },
                }
              : {}),
          }),
        );
        if (teamCoordinator !== undefined) {
          if (Exit.isSuccess(started)) {
            yield* teamCoordinatorAccess
              .revokeOtherGrantsForThread({
                parentThreadId: teamCoordinator.parentThreadId,
                keepGrantId: teamCoordinator.grantId,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to revoke stale team coordinator grants", {
                    threadId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              );
          } else {
            yield* teamCoordinatorAccess.revokeGrant({ grantId: teamCoordinator.grantId }).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to revoke unused team coordinator grant", {
                  threadId,
                  cause: Cause.pretty(cause),
                }),
              ),
            );
          }
        }
        if (Exit.isFailure(started)) {
          return yield* Effect.failCause(started.cause);
        }
        return started.value;
      });
    };

    const bindSessionToThread = (session: ProviderSession) =>
      setThreadSession({
        threadId,
        session: {
          threadId,
          status: mapProviderSessionStatusToOrchestrationStatus(session.status),
          providerName: session.provider,
          runtimeMode: desiredRuntimeMode,
          // Provider turn ids are not orchestration turn ids.
          activeTurnId: null,
          lastError: session.lastError ?? null,
          updatedAt: session.updatedAt,
        },
        createdAt,
      });

    const activeSession = yield* resolveActiveSession(threadId);
    const providerChanged = currentProvider !== undefined && currentProvider !== desiredProvider;
    const turnIsRunning =
      thread.latestTurn?.state === "running" ||
      thread.session?.status === "running" ||
      (thread.session?.activeTurnId ?? null) !== null;
    const hasPendingInteraction = hasPendingProviderInteraction(thread.activities);

    if (providerChanged) {
      if (turnIsRunning || hasPendingInteraction) {
        const blockedBy: string[] = [];
        if (turnIsRunning) {
          blockedBy.push("a turn is still running");
        }
        if (hasPendingInteraction) {
          blockedBy.push("provider approvals or user-input are still pending");
        }
        return yield* new ProviderAdapterRequestError({
          provider: currentProvider,
          method: "thread.turn.start",
          detail: `Thread '${threadId}' can only switch providers between turns; ${blockedBy.join(" and ")}.`,
        });
      }

      yield* Effect.logInfo("provider command reactor switching provider session", {
        threadId,
        fromProvider: currentProvider,
        toProvider: desiredProvider,
        hasLiveRuntime: activeSession !== undefined,
      });
      const switchedSession = yield* startProviderSession({ provider: desiredProvider });
      yield* bindSessionToThread(switchedSession);
      return switchedSession.threadId;
    }

    const existingSessionThreadId =
      thread.session && thread.session.status !== "stopped" && activeSession ? thread.id : null;
    if (existingSessionThreadId) {
      const runtimeModeChanged = thread.runtimeMode !== thread.session?.runtimeMode;
      const sessionModelSwitch =
        currentProvider === undefined
          ? "in-session"
          : (yield* providerService.getCapabilities(currentProvider)).sessionModelSwitch;
      const modelChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.model !== activeSession?.model;
      const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "unsupported";
      const previousModelSelection = threadModelSelections.get(threadId);
      const shouldRestartForModelSelectionChange =
        currentProvider === "claudeAgent" &&
        requestedModelSelection !== undefined &&
        !Equal.equals(previousModelSelection, requestedModelSelection);

      if (
        !runtimeModeChanged &&
        !shouldRestartForModelChange &&
        !shouldRestartForModelSelectionChange
      ) {
        return existingSessionThreadId;
      }

      const resumeCursor = shouldRestartForModelChange
        ? undefined
        : (activeSession?.resumeCursor ?? undefined);
      yield* Effect.logInfo("provider command reactor restarting provider session", {
        threadId,
        existingSessionThreadId,
        currentProvider,
        desiredProvider: desiredModelSelection.provider,
        currentRuntimeMode: thread.session?.runtimeMode,
        desiredRuntimeMode: thread.runtimeMode,
        runtimeModeChanged,
        modelChanged,
        shouldRestartForModelChange,
        shouldRestartForModelSelectionChange,
        hasResumeCursor: resumeCursor !== undefined,
      });
      const restartedSession = yield* startProviderSession(
        resumeCursor !== undefined ? { resumeCursor } : undefined,
      );
      yield* Effect.logInfo("provider command reactor restarted provider session", {
        threadId,
        previousSessionId: existingSessionThreadId,
        restartedSessionThreadId: restartedSession.threadId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
      });
      yield* bindSessionToThread(restartedSession);
      return restartedSession.threadId;
    }

    const startedSession = yield* startProviderSession(undefined);
    yield* bindSessionToThread(startedSession);
    return startedSession.threadId;
  });

  const buildSendTurnRequestForThread = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly interactionMode?: "default" | "plan";
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return yield* Effect.die(
        new Error(`Thread '${input.threadId}' was not found in read model.`),
      );
    }
    yield* ensureSessionForThread(
      input.threadId,
      input.createdAt,
      input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {},
    );
    if (input.modelSelection !== undefined) {
      threadModelSelections.set(input.threadId, input.modelSelection);
    }
    const normalizedInput = toNonEmptyProviderInput(input.messageText);
    const normalizedAttachments = input.attachments ?? [];
    const activeSession = yield* providerService
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)),
      );
    const sessionModelSwitch =
      activeSession === undefined
        ? "in-session"
        : (yield* providerService.getCapabilities(activeSession.provider)).sessionModelSwitch;
    const requestedModelSelection =
      input.modelSelection ?? threadModelSelections.get(input.threadId) ?? thread.modelSelection;
    const modelForTurn =
      sessionModelSwitch === "unsupported" && input.modelSelection === undefined
        ? activeSession?.model !== undefined
          ? {
              ...requestedModelSelection,
              model: activeSession.model,
            }
          : requestedModelSelection
        : input.modelSelection;

    return {
      threadId: input.threadId,
      ...(normalizedInput ? { input: normalizedInput } : {}),
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    };
  });

  const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fn(
    "maybeGenerateAndRenameWorktreeBranchForFirstTurn",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
  }) {
    if (!input.branch || !input.worktreePath) {
      return;
    }
    if (!isTemporaryWorktreeBranch(input.branch)) {
      return;
    }

    const oldBranch = input.branch;
    const cwd = input.worktreePath;
    const attachments = input.attachments ?? [];
    yield* Effect.gen(function* () {
      const { textGenerationModelSelection: modelSelection } =
        yield* serverSettingsService.getSettings;

      const generated = yield* textGeneration.generateBranchName({
        cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      });
      if (!generated) return;

      const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
      if (targetBranch === oldBranch) return;

      const renamed = yield* git.renameBranch({ cwd, oldBranch, newBranch: targetBranch });
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: serverCommandId("worktree-branch-rename"),
        threadId: input.threadId,
        branch: renamed.branch,
        worktreePath: cwd,
      });
      yield* gitStatusBroadcaster.refreshStatus(cwd).pipe(Effect.ignoreCause({ log: true }));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
          threadId: input.threadId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const shouldAutoRenameWorktreeBranchForFirstTurn = Effect.fn(
    "shouldAutoRenameWorktreeBranchForFirstTurn",
  )(function* (input: { readonly thread: OrchestrationThread }) {
    if (!input.thread.branch || !input.thread.worktreePath) {
      return false;
    }
    if (!isTemporaryWorktreeBranch(input.thread.branch)) {
      return false;
    }
    if (!input.thread.teamParent) {
      return true;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const parentThread = readModel.threads.find(
      (candidate) => candidate.id === input.thread.teamParent?.parentThreadId,
    );
    const task = parentThread?.teamTasks?.find(
      (candidate) => candidate.id === input.thread.teamParent?.taskId,
    );

    return task ? isDedicatedDynamoTeamWorktreeTask(task) : false;
  });

  const maybeGenerateThreadTitleForFirstTurn = Effect.fn("maybeGenerateThreadTitleForFirstTurn")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly cwd: string;
      readonly messageText: string;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
      readonly titleSeed?: string;
    }) {
      const attachments = input.attachments ?? [];
      yield* Effect.gen(function* () {
        const { textGenerationModelSelection: modelSelection } =
          yield* serverSettingsService.getSettings;

        const generated = yield* textGeneration.generateThreadTitle({
          cwd: input.cwd,
          message: input.messageText,
          ...(attachments.length > 0 ? { attachments } : {}),
          modelSelection,
        });
        if (!generated) return;

        const thread = yield* resolveThread(input.threadId);
        if (!thread) return;
        if (!canReplaceThreadTitle(thread.title, input.titleSeed, thread.forkOrigin)) {
          return;
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: serverCommandId("thread-title-rename"),
          threadId: input.threadId,
          title: generated.title,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to generate or rename thread title", {
            threadId: input.threadId,
            cwd: input.cwd,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    },
  );

  const processTurnStartRequested = Effect.fn("processTurnStartRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
  ) {
    const key = turnStartKeyForEvent(event);
    if (yield* hasHandledTurnStartRecently(key)) {
      return;
    }

    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const message = thread.messages.find((entry) => entry.id === event.payload.messageId);
    if (!message || message.role !== "user") {
      yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
        turnId: null,
        createdAt: event.payload.createdAt,
      });
      return;
    }

    const isFirstUserMessageTurn = isFirstLiveUserMessageTurn({
      thread,
      messageId: event.payload.messageId,
    });
    if (isFirstUserMessageTurn) {
      const generationCwd =
        resolveThreadWorkspaceCwd({
          thread,
          projects: (yield* orchestrationEngine.getReadModel()).projects,
        }) ?? process.cwd();
      const generationInput = {
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.titleSeed !== undefined ? { titleSeed: event.payload.titleSeed } : {}),
      };

      if (yield* shouldAutoRenameWorktreeBranchForFirstTurn({ thread })) {
        yield* maybeGenerateAndRenameWorktreeBranchForFirstTurn({
          threadId: event.payload.threadId,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          ...generationInput,
        }).pipe(Effect.forkScoped);
      }

      if (canReplaceThreadTitle(thread.title, event.payload.titleSeed, thread.forkOrigin)) {
        yield* maybeGenerateThreadTitleForFirstTurn({
          threadId: event.payload.threadId,
          cwd: generationCwd,
          ...generationInput,
        }).pipe(Effect.forkScoped);
      }
    }

    const handleTurnStartFailure = (cause: Cause.Cause<unknown>) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.void;
      }
      const detail = formatFailureDetail(cause);
      return setThreadSessionErrorOnTurnStartFailure({
        threadId: event.payload.threadId,
        detail,
        createdAt: event.payload.createdAt,
      }).pipe(
        Effect.flatMap(() =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.turn.start.failed",
            summary: "Provider turn start failed",
            detail,
            turnId: null,
            createdAt: event.payload.createdAt,
          }),
        ),
        Effect.asVoid,
      );
    };

    const recoverTurnStartFailure = (cause: Cause.Cause<unknown>) =>
      handleTurnStartFailure(cause).pipe(
        Effect.catchCause((recoveryCause) =>
          Effect.logWarning("provider command reactor failed to recover turn start failure", {
            eventType: event.type,
            threadId: event.payload.threadId,
            cause: Cause.pretty(recoveryCause),
            originalCause: Cause.pretty(cause),
          }),
        ),
      );

    const sessionProvider = Schema.is(ProviderKind)(thread.session?.providerName)
      ? thread.session?.providerName
      : undefined;
    const targetProvider: ProviderKind =
      event.payload.modelSelection?.provider ?? sessionProvider ?? thread.modelSelection.provider;
    const currentProvider = sessionProvider ?? thread.modelSelection.provider;
    const providerChanged = currentProvider !== targetProvider;
    if (providerChanged) {
      const turnIsRunning =
        thread.latestTurn?.state === "running" ||
        thread.session?.status === "running" ||
        (thread.session?.activeTurnId ?? null) !== null;
      const pendingInteraction = hasPendingProviderInteraction(thread.activities);
      if (turnIsRunning || pendingInteraction) {
        const blockedBy: string[] = [];
        if (turnIsRunning) {
          blockedBy.push("a turn is still running");
        }
        if (pendingInteraction) {
          blockedBy.push("provider approvals or user-input are still pending");
        }
        yield* recoverTurnStartFailure(
          Cause.fail(
            new ProviderAdapterRequestError({
              provider: currentProvider,
              method: "thread.turn.start",
              detail: `Thread '${event.payload.threadId}' can only switch providers between turns; ${blockedBy.join(" and ")}.`,
            }),
          ),
        );
        return;
      }
    }
    const existingPendingProviderSwitchHandoff = thread.contextHandoffs.find(
      (handoff) =>
        handoff.status === "pending" &&
        handoff.reason === "provider-switch" &&
        (handoff.targetProvider === undefined || handoff.targetProvider === targetProvider),
    );
    const importedUntilAt = latestImportedContextTimestamp({
      thread,
      liveMessageId: message.id,
    });
    const shouldPrepareProviderSwitchHandoff =
      providerChanged &&
      importedUntilAt !== null &&
      existingPendingProviderSwitchHandoff === undefined;

    let threadForHandoff = thread;
    if (shouldPrepareProviderSwitchHandoff) {
      const latestSourceUserMessage = thread.messages
        .filter((entry) => entry.id !== message.id && entry.role === "user")
        .toSorted(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        )
        .at(-1);
      const preparedAt = new Date().toISOString();
      const prepareResult = yield* orchestrationEngine
        .dispatch({
          type: "thread.context-handoff.prepare",
          commandId: serverCommandId("context-handoff-prepare"),
          threadId: event.payload.threadId,
          handoffId: ContextHandoffId.make(`handoff:${crypto.randomUUID()}`),
          reason: "provider-switch",
          sourceThreadId: thread.id,
          sourceThreadTitle: thread.title,
          sourceUserMessageId: latestSourceUserMessage?.id ?? null,
          sourceProvider: currentProvider,
          targetProvider,
          importedUntilAt,
          createdAt: preparedAt,
        })
        .pipe(Effect.exit);
      if (Exit.isFailure(prepareResult)) {
        yield* recoverTurnStartFailure(prepareResult.cause);
        return;
      }
      threadForHandoff = (yield* resolveThread(event.payload.threadId)) ?? thread;
    }

    const pendingHandoff = findPendingContextHandoffForTurn({
      thread: threadForHandoff,
      messageId: message.id,
      targetProvider,
      isFirstUserMessageTurn,
    });
    const handoffRender =
      pendingHandoff === undefined
        ? undefined
        : renderContextHandoff({
            thread: threadForHandoff,
            handoff: pendingHandoff,
            liveMessage: message,
            targetProvider,
            maxInputChars: PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
            reserveChars: CONTEXT_HANDOFF_RESERVE_CHARS,
          });

    const providerMessageText = handoffRender?.input ?? message.text;
    const deliveredModelSelection = event.payload.modelSelection ?? threadForHandoff.modelSelection;

    const sendTurnRequest = yield* buildSendTurnRequestForThread({
      threadId: event.payload.threadId,
      messageText: providerMessageText,
      ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
      ...(event.payload.modelSelection !== undefined
        ? { modelSelection: event.payload.modelSelection }
        : {}),
      interactionMode: event.payload.interactionMode,
      createdAt: event.payload.createdAt,
    }).pipe(
      Effect.map(Option.some),
      Effect.catchCause((cause) => handleTurnStartFailure(cause).pipe(Effect.as(Option.none()))),
    );

    if (Option.isNone(sendTurnRequest)) {
      return;
    }

    const markContextHandoffDeliveryFailed = (
      cause: Cause.Cause<unknown>,
      render: ContextHandoffRenderResult,
    ) =>
      pendingHandoff === undefined
        ? Effect.void
        : orchestrationEngine
            .dispatch({
              type: "thread.context-handoff.mark-delivery-failed",
              commandId: serverCommandId("context-handoff-delivery-failed"),
              threadId: event.payload.threadId,
              handoffId: pendingHandoff.id,
              liveMessageId: message.id,
              provider: targetProvider,
              detail: formatFailureDetail(cause) || "Provider turn start failed.",
              renderStats: render.stats,
              createdAt: new Date().toISOString(),
            })
            .pipe(Effect.asVoid);

    const sendTurnEffect = providerService.sendTurn(sendTurnRequest.value).pipe(
      Effect.tap((turn) =>
        pendingHandoff === undefined || handoffRender === undefined
          ? Effect.void
          : orchestrationEngine
              .dispatch({
                type: "thread.context-handoff.mark-delivered",
                commandId: serverCommandId("context-handoff-delivered"),
                threadId: event.payload.threadId,
                handoffId: pendingHandoff.id,
                liveMessageId: message.id,
                provider: targetProvider,
                turnId: turn.turnId,
                modelSelection: deliveredModelSelection,
                renderStats: handoffRender.stats,
                createdAt: new Date().toISOString(),
              })
              .pipe(Effect.asVoid),
      ),
      Effect.catchCause((cause) =>
        handoffRender === undefined
          ? recoverTurnStartFailure(cause)
          : markContextHandoffDeliveryFailed(cause, handoffRender).pipe(
              Effect.catchCause((handoffCause) =>
                Effect.logWarning("failed to record context handoff delivery failure", {
                  eventType: event.type,
                  threadId: event.payload.threadId,
                  handoffId: pendingHandoff?.id,
                  cause: Cause.pretty(handoffCause),
                  originalCause: Cause.pretty(cause),
                }),
              ),
              Effect.flatMap(() => recoverTurnStartFailure(cause)),
            ),
      ),
    );

    yield* sendTurnEffect.pipe(Effect.forkScoped);
  });

  const processTurnInterruptRequested = Effect.fn("processTurnInterruptRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-interrupt-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        detail: "No active provider session is bound to this thread.",
        turnId: event.payload.turnId ?? null,
        createdAt: event.payload.createdAt,
      });
    }

    // Orchestration turn ids are not provider turn ids, so interrupt by session.
    yield* providerService.interruptTurn({ threadId: event.payload.threadId });
  });

  const processApprovalResponseRequested = Effect.fn("processApprovalResponseRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.approval-response-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }

    yield* providerService
      .respondToRequest({
        threadId: event.payload.threadId,
        requestId: event.payload.requestId,
        decision: event.payload.decision,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* appendProviderFailureActivity({
              threadId: event.payload.threadId,
              kind: "provider.approval.respond.failed",
              summary: "Provider approval response failed",
              detail: isUnknownPendingApprovalRequestError(cause)
                ? stalePendingRequestDetail("approval", event.payload.requestId)
                : Cause.pretty(cause),
              turnId: null,
              createdAt: event.payload.createdAt,
              requestId: event.payload.requestId,
            });

            if (!isUnknownPendingApprovalRequestError(cause)) return;
          }),
        ),
      );
  });

  const processUserInputResponseRequested = Effect.fn("processUserInputResponseRequested")(
    function* (
      event: Extract<ProviderIntentEvent, { type: "thread.user-input-response-requested" }>,
    ) {
      const thread = yield* resolveThread(event.payload.threadId);
      if (!thread) {
        return;
      }
      const hasSession = thread.session && thread.session.status !== "stopped";
      if (!hasSession) {
        return yield* appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.user-input.respond.failed",
          summary: "Provider user input response failed",
          detail: "No active provider session is bound to this thread.",
          turnId: null,
          createdAt: event.payload.createdAt,
          requestId: event.payload.requestId,
        });
      }

      yield* providerService
        .respondToUserInput({
          threadId: event.payload.threadId,
          requestId: event.payload.requestId,
          answers: event.payload.answers,
        })
        .pipe(
          Effect.catchCause((cause) =>
            appendProviderFailureActivity({
              threadId: event.payload.threadId,
              kind: "provider.user-input.respond.failed",
              summary: "Provider user input response failed",
              detail: isUnknownPendingUserInputRequestError(cause)
                ? stalePendingRequestDetail("user-input", event.payload.requestId)
                : Cause.pretty(cause),
              turnId: null,
              createdAt: event.payload.createdAt,
              requestId: event.payload.requestId,
            }),
          ),
        );
    },
  );

  const processSessionStopRequested = Effect.fn("processSessionStopRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.session-stop-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const now = event.payload.createdAt;
    if (thread.session && thread.session.status !== "stopped") {
      yield* providerService.stopSession({ threadId: thread.id });
    }

    yield* setThreadSession({
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: "stopped",
        providerName: thread.session?.providerName ?? null,
        runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: thread.session?.lastError ?? null,
        updatedAt: now,
      },
      createdAt: now,
    });
  });

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (
    event: ProviderIntentEvent,
  ) {
    yield* Effect.annotateCurrentSpan({
      "orchestration.event_type": event.type,
      "orchestration.thread_id": event.payload.threadId,
      ...(event.commandId ? { "orchestration.command_id": event.commandId } : {}),
    });
    yield* increment(orchestrationEventsProcessedTotal, {
      eventType: event.type,
    });
    switch (event.type) {
      case "thread.runtime-mode-set": {
        const thread = yield* resolveThread(event.payload.threadId);
        if (!thread?.session || thread.session.status === "stopped") {
          return;
        }
        const cachedModelSelection = threadModelSelections.get(event.payload.threadId);
        yield* ensureSessionForThread(
          event.payload.threadId,
          event.occurredAt,
          cachedModelSelection !== undefined ? { modelSelection: cachedModelSelection } : {},
        );
        return;
      }
      case "thread.turn-start-requested":
        yield* processTurnStartRequested(event);
        return;
      case "thread.turn-interrupt-requested":
        yield* processTurnInterruptRequested(event);
        return;
      case "thread.approval-response-requested":
        yield* processApprovalResponseRequested(event);
        return;
      case "thread.user-input-response-requested":
        yield* processUserInputResponseRequested(event);
        return;
      case "thread.session-stop-requested":
        yield* processSessionStopRequested(event);
        return;
    }
  });

  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: ProviderCommandReactorShape["start"] = Effect.fn("start")(function* () {
    const processEvent = Effect.fn("processEvent")(function* (event: OrchestrationEvent) {
      if (
        event.type === "thread.runtime-mode-set" ||
        event.type === "thread.turn-start-requested" ||
        event.type === "thread.turn-interrupt-requested" ||
        event.type === "thread.approval-response-requested" ||
        event.type === "thread.user-input-response-requested" ||
        event.type === "thread.session-stop-requested"
      ) {
        return yield* worker.enqueue(event);
      }
    });

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderCommandReactorShape;
});

export const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make);
