import {
  CommandId,
  MessageId,
  ThreadId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationTeamTask,
  type OrchestrationTeamTaskId,
} from "@t3tools/contracts";
import { Cause, Effect, Layer, Option } from "effect";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadBootstrapDispatcher } from "../../orchestration/Services/ThreadBootstrapDispatcher.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  latestAssistantOutputText,
  latestAssistantSummary,
  latestDiffSummary,
  truncateTeamText,
} from "../teamTaskPresentation.ts";
import { TeamCoordinatorSessionRegistry } from "../Services/TeamCoordinatorSessionRegistry.ts";
import {
  TeamOrchestrationService,
  type CloseTeamChildInput,
  type SpawnTeamChildInput,
  type TeamChildResult,
  type TeamOrchestrationServiceShape,
} from "../Services/TeamOrchestrationService.ts";

const ACTIVE_TEAM_TASK_STATUSES = new Set(["queued", "starting", "running", "waiting"]);
const FINAL_TEAM_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_ACTIVE_CHILDREN = 3;
const DEFAULT_WAIT_TIMEOUT_SECONDS = 30;

class TeamOrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamOrchestrationError";
  }
}

const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

function sanitizeBranchSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/\/+/g, "/")
      .replace(/^[./_-]+|[./_-]+$/g, "")
      .slice(0, 48) || "task"
  );
}

function isActiveTask(task: Pick<OrchestrationTeamTask, "status">): boolean {
  return ACTIVE_TEAM_TASK_STATUSES.has(task.status);
}

function isFinalTask(task: Pick<OrchestrationTeamTask, "status">): boolean {
  return FINAL_TEAM_TASK_STATUSES.has(task.status);
}

function toStoredTask(task: TeamChildResult): OrchestrationTeamTask {
  return {
    id: task.id,
    parentThreadId: task.parentThreadId,
    childThreadId: task.childThreadId,
    title: task.title,
    roleLabel: task.roleLabel,
    modelSelection: task.modelSelection,
    workspaceMode: task.workspaceMode,
    status: task.status,
    latestSummary: task.latestSummary,
    errorText: task.errorText,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
  };
}

export function selectChildTranscriptMessages(input: {
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  readonly latestGoal: string | null;
}): ReadonlyArray<{ readonly role: string; readonly text: string }> {
  const selected: Array<{ readonly role: string; readonly text: string }> = [];
  const latestGoal = input.latestGoal?.trim() ?? null;
  let remainingChars = 20_000;

  for (const message of input.messages.toReversed()) {
    if (message.role !== "user") {
      continue;
    }
    const text = message.text.trim();
    if (text.length === 0 || (latestGoal !== null && text === latestGoal)) {
      continue;
    }
    const boundedText = truncateTeamText(text, Math.min(remainingChars, 6_000));
    if (boundedText.length === 0) {
      continue;
    }
    selected.push({ role: "user", text: boundedText });
    remainingChars -= boundedText.length;
    if (selected.length >= 6 || remainingChars <= 0) {
      break;
    }
  }

  return selected.toReversed();
}

export function buildChildPrompt(input: {
  readonly parentTitle: string;
  readonly latestGoal: string | null;
  readonly latestPlanMarkdown: string | null;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly roleLabel: string | null;
  readonly contextBrief: string | null;
  readonly relevantFiles: ReadonlyArray<string>;
  readonly task: string;
  readonly transcript: ReadonlyArray<{ readonly role: string; readonly text: string }>;
}): string {
  const transcriptBlocks: string[] = [];
  let remainingChars = 20_000;
  for (const message of input.transcript.toReversed()) {
    const label = message.role.toUpperCase();
    const block = `${label}:\n${message.text.trim()}`.trim();
    if (block.length === 0) {
      continue;
    }
    if (block.length > remainingChars) {
      transcriptBlocks.push(truncateTeamText(block, remainingChars));
      break;
    }
    transcriptBlocks.push(block);
    remainingChars -= block.length;
    if (remainingChars <= 0) {
      break;
    }
  }

  const relevantFilesSection =
    input.relevantFiles.length > 0
      ? `Relevant files:\n${input.relevantFiles.map((file) => `- ${file}`).join("\n")}`
      : "Relevant files:\n- None provided";

  return [
    "You are a child agent working for a coordinator thread.",
    "Do not delegate, spawn subagents, or use native collaboration tools.",
    "Deliver your changes in your own branch/worktree. Do not merge or apply changes back into the coordinator workspace.",
    `Coordinator thread: ${input.parentTitle}`,
    input.roleLabel ? `Assigned role: ${input.roleLabel}` : null,
    input.latestGoal ? `Latest user goal:\n${input.latestGoal}` : null,
    input.latestPlanMarkdown ? `Latest proposed plan:\n${input.latestPlanMarkdown}` : null,
    `Coordinator branch/worktree:\n- Branch: ${input.branch ?? "n/a"}\n- Worktree: ${input.worktreePath ?? "project workspace root"}`,
    input.contextBrief ? `Context brief:\n${input.contextBrief}` : null,
    relevantFilesSection,
    `Assigned task:\n${input.task}`,
    transcriptBlocks.length > 0
      ? `Recent user context:\n${transcriptBlocks.toReversed().join("\n\n")}`
      : null,
    "Return the requested deliverable directly.",
    "Only include branch/worktree handoff details if you actually made code changes in your own workspace.",
  ]
    .filter((section): section is string => section !== null && section.trim().length > 0)
    .join("\n\n");
}

const makeTeamOrchestrationService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const threadBootstrapDispatcher = yield* ThreadBootstrapDispatcher;
  const providerRegistry = yield* ProviderRegistry;
  const serverSettingsService = yield* ServerSettingsService;
  const git = yield* GitCore;
  const teamCoordinatorSessionRegistry = yield* TeamCoordinatorSessionRegistry;
  const ensureFeatureEnabled = serverSettingsService.getSettings.pipe(
    Effect.flatMap((settings) =>
      settings.teamAgents
        ? Effect.void
        : Effect.fail(new TeamOrchestrationError("Team agents are disabled on this server.")),
    ),
  );

  const resolveParentThread = Effect.fn("resolveParentThread")(function* (
    parentThreadId: ThreadId,
  ) {
    yield* ensureFeatureEnabled;
    const readModel = yield* orchestrationEngine.getReadModel();
    const parentThread = readModel.threads.find((thread) => thread.id === parentThreadId);
    if (!parentThread) {
      return yield* Effect.fail(new TeamOrchestrationError(`Unknown thread '${parentThreadId}'.`));
    }
    if (parentThread.teamParentThreadId !== null) {
      return yield* Effect.fail(
        new TeamOrchestrationError("Child threads cannot delegate further in v1."),
      );
    }
    const project = readModel.projects.find((entry) => entry.id === parentThread.projectId);
    if (!project) {
      return yield* Effect.fail(
        new TeamOrchestrationError(`Project '${parentThread.projectId}' was not found.`),
      );
    }

    return { readModel, parentThread, project } as const;
  });

  const resolveModelSelection = Effect.fn("resolveModelSelection")(function* (
    input: Pick<SpawnTeamChildInput, "provider" | "model">,
  ) {
    const providers = yield* providerRegistry.getProviders;
    const provider = providers.find((entry) => entry.provider === input.provider);
    const availableModels = providers
      .filter(
        (entry) =>
          entry.provider === input.provider &&
          entry.enabled &&
          entry.installed &&
          entry.supportsTeamWorker === true,
      )
      .flatMap((entry) => entry.models.map((model) => model.slug));

    if (
      !provider ||
      !provider.enabled ||
      !provider.installed ||
      provider.supportsTeamWorker !== true
    ) {
      return yield* Effect.fail(
        new TeamOrchestrationError(`Provider '${input.provider}' is unavailable for team workers.`),
      );
    }
    if (!provider.models.some((model) => model.slug === input.model)) {
      return yield* Effect.fail(
        new TeamOrchestrationError(
          [
            `Model '${input.model}' is not available on provider '${input.provider}'.`,
            availableModels.length > 0
              ? `Available models: ${availableModels.join(", ")}.`
              : "No worker models are currently available for that provider.",
          ].join(" "),
        ),
      );
    }
    const modelSelection: ModelSelection =
      input.provider === "claudeAgent"
        ? { provider: "claudeAgent", model: input.model }
        : { provider: "codex", model: input.model };
    return modelSelection;
  });

  const loadTeamChildResult = Effect.fn("loadTeamChildResult")(function* (
    parentThreadId: ThreadId,
    taskId: OrchestrationTeamTaskId,
  ) {
    const parentThread = yield* projectionSnapshotQuery
      .getThreadDetailById(parentThreadId)
      .pipe(
        Effect.flatMap((thread) =>
          Option.isSome(thread)
            ? Effect.succeed(thread.value)
            : Effect.fail(new TeamOrchestrationError(`Unknown thread '${parentThreadId}'.`)),
        ),
      );
    const task = (parentThread.teamTasks ?? []).find((entry) => entry.id === taskId);
    if (!task) {
      return yield* Effect.fail(
        new TeamOrchestrationError(`Unknown team task '${taskId}' on thread '${parentThreadId}'.`),
      );
    }
    const childThreadOption = yield* projectionSnapshotQuery.getThreadDetailById(
      task.childThreadId,
    );
    const childThread = Option.isSome(childThreadOption) ? childThreadOption.value : null;
    return {
      ...task,
      branch: childThread?.branch ?? null,
      worktreePath: childThread?.worktreePath ?? null,
      diffSummary: childThread ? latestDiffSummary(childThread) : null,
      latestOutputText: childThread ? latestAssistantOutputText(childThread) : null,
      latestSummary:
        (childThread ? latestAssistantSummary(childThread) : null) ?? task.latestSummary,
    } satisfies TeamChildResult;
  });

  const listChildrenInternal = Effect.fn("listChildrenInternal")(function* (input: {
    readonly parentThreadId: ThreadId;
    readonly statusFilter?: ReadonlyArray<OrchestrationTeamTask["status"]>;
  }) {
    const parentThread = yield* projectionSnapshotQuery
      .getThreadDetailById(input.parentThreadId)
      .pipe(
        Effect.flatMap((thread) =>
          Option.isSome(thread)
            ? Effect.succeed(thread.value)
            : Effect.fail(new TeamOrchestrationError(`Unknown thread '${input.parentThreadId}'.`)),
        ),
      );
    const allowedStatuses = input.statusFilter ? new Set(input.statusFilter) : null;
    return yield* Effect.forEach(
      (parentThread.teamTasks ?? []).filter((task) =>
        allowedStatuses === null ? true : allowedStatuses.has(task.status),
      ),
      (task) => loadTeamChildResult(input.parentThreadId, task.id),
      { concurrency: 4 },
    );
  });

  const getCoordinatorSessionConfig: TeamOrchestrationServiceShape["getCoordinatorSessionConfig"] =
    (threadId) => teamCoordinatorSessionRegistry.getCoordinatorSessionConfig(threadId);

  const authenticateCoordinatorAccessToken: TeamOrchestrationServiceShape["authenticateCoordinatorAccessToken"] =
    (accessToken) => teamCoordinatorSessionRegistry.authenticateCoordinatorAccessToken(accessToken);

  const spawnChild: TeamOrchestrationServiceShape["spawnChild"] = (input) =>
    Effect.gen(function* () {
      const { readModel, parentThread, project } = yield* resolveParentThread(input.parentThreadId);
      if ((parentThread.teamTasks ?? []).filter(isActiveTask).length >= MAX_ACTIVE_CHILDREN) {
        return yield* Effect.fail(
          new TeamOrchestrationError(
            `Thread '${input.parentThreadId}' already has ${MAX_ACTIVE_CHILDREN} active child tasks.`,
          ),
        );
      }

      const modelSelection = yield* resolveModelSelection(input);
      const childThreadId = ThreadId.make(crypto.randomUUID());
      const taskId = `team-task:${crypto.randomUUID()}` as OrchestrationTeamTaskId;
      const now = new Date().toISOString();
      const parentCwd =
        resolveThreadWorkspaceCwd({
          thread: parentThread,
          projects: readModel.projects,
        }) ?? project.workspaceRoot;
      const useWorktree =
        (yield* git.isInsideWorkTree(parentCwd).pipe(Effect.catch(() => Effect.succeed(false)))) &&
        parentThread.projectId === project.id;
      const effectiveBaseBranch =
        parentThread.branch ??
        (yield* git.status({ cwd: parentCwd }).pipe(
          Effect.map((status) => status.branch),
          Effect.catch(() => Effect.succeed(null)),
        ));
      const workspaceMode = useWorktree && effectiveBaseBranch ? "worktree" : ("shared" as const);
      const childBranch =
        workspaceMode === "worktree"
          ? `agent/${sanitizeBranchSegment(input.roleLabel ?? input.title)}-${taskId.slice(-6)}`
          : null;

      const task: OrchestrationTeamTask = {
        id: taskId,
        parentThreadId: input.parentThreadId,
        childThreadId,
        title: input.title,
        roleLabel: input.roleLabel ?? null,
        modelSelection,
        workspaceMode,
        status: "queued",
        latestSummary: null,
        errorText: null,
        createdAt: now,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
      };

      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.spawn",
        commandId: serverCommandId("team-task-spawn"),
        parentThreadId: input.parentThreadId,
        teamTask: task,
        createdAt: now,
      });

      const latestGoal =
        parentThread.messages
          .toReversed()
          .find((message) => message.role === "user" && message.text.trim().length > 0)?.text ??
        null;
      const latestPlanMarkdown =
        parentThread.proposedPlans.toReversed().find((plan) => plan.planMarkdown.trim().length > 0)
          ?.planMarkdown ?? null;
      const transcript = selectChildTranscriptMessages({
        messages: parentThread.messages,
        latestGoal,
      });

      const prompt = buildChildPrompt({
        parentTitle: parentThread.title,
        latestGoal,
        latestPlanMarkdown,
        branch: parentThread.branch,
        worktreePath: parentThread.worktreePath,
        roleLabel: input.roleLabel ?? null,
        contextBrief: input.contextBrief ?? null,
        relevantFiles: input.relevantFiles ?? [],
        task: input.task,
        transcript,
      });

      const childCreateAt = now;
      const childCreateWorktreePath = workspaceMode === "shared" ? parentThread.worktreePath : null;

      const bootstrapCommand: Extract<OrchestrationCommand, { type: "thread.turn.start" }> = {
        type: "thread.turn.start",
        commandId: serverCommandId("team-child-bootstrap"),
        threadId: childThreadId,
        message: {
          messageId: MessageId.make(`message:${crypto.randomUUID()}`),
          role: "user",
          text: prompt,
          attachments: [],
        },
        modelSelection,
        runtimeMode: parentThread.runtimeMode,
        interactionMode: "default",
        bootstrap: {
          createThread: {
            projectId: project.id,
            title: input.title,
            modelSelection,
            runtimeMode: parentThread.runtimeMode,
            interactionMode: "default",
            branch: workspaceMode === "shared" ? parentThread.branch : null,
            worktreePath: childCreateWorktreePath,
            createdAt: childCreateAt,
          },
          ...(workspaceMode === "worktree" && effectiveBaseBranch
            ? {
                prepareWorktree: {
                  projectCwd: parentCwd,
                  baseBranch: effectiveBaseBranch,
                  branch: childBranch ?? undefined,
                },
              }
            : {}),
          // Team child worktrees are ephemeral scratch spaces. They should not
          // inherit the coordinator's setup-on-worktree-create behavior.
          runSetupScript: false,
        },
        createdAt: now,
      };

      const bootstrapExit = yield* threadBootstrapDispatcher
        .dispatch(bootstrapCommand)
        .pipe(Effect.exit);
      if (bootstrapExit._tag === "Failure") {
        const detail = Cause.pretty(bootstrapExit.cause);
        const failedAt = new Date().toISOString();
        yield* orchestrationEngine.dispatch({
          type: "thread.team-task.upsert",
          commandId: serverCommandId("team-task-spawn-failed"),
          parentThreadId: input.parentThreadId,
          teamTask: {
            ...task,
            status: "failed",
            errorText: detail,
            completedAt: failedAt,
            updatedAt: failedAt,
          },
          createdAt: failedAt,
        });
        return yield* Effect.fail(new TeamOrchestrationError(`Failed to spawn child: ${detail}`));
      }

      const startedAt = new Date().toISOString();
      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.upsert",
        commandId: serverCommandId("team-task-starting"),
        parentThreadId: input.parentThreadId,
        teamTask: {
          ...task,
          status: "starting",
          startedAt,
          updatedAt: startedAt,
        },
        createdAt: startedAt,
      });

      return yield* loadTeamChildResult(input.parentThreadId, taskId);
    });

  const listChildren: TeamOrchestrationServiceShape["listChildren"] = (input) =>
    resolveParentThread(input.parentThreadId).pipe(
      Effect.flatMap(() => listChildrenInternal(input)),
    );

  const waitForChildren: TeamOrchestrationServiceShape["waitForChildren"] = (input) =>
    Effect.gen(function* () {
      yield* resolveParentThread(input.parentThreadId);
      const timeoutSeconds = Math.max(1, input.timeoutSeconds ?? DEFAULT_WAIT_TIMEOUT_SECONDS);
      const deadline = Date.now() + timeoutSeconds * 1000;
      const poll = (): Effect.Effect<ReadonlyArray<TeamChildResult>, TeamOrchestrationError> =>
        Effect.gen(function* () {
          const tasks = yield* listChildrenInternal({
            parentThreadId: input.parentThreadId,
          });
          const taskIds = input.taskIds ?? [];
          const filtered = input.taskIds
            ? tasks.filter((task) => taskIds.includes(task.id))
            : tasks;
          if (filtered.every(isFinalTask) || Date.now() >= deadline) {
            return filtered;
          }
          yield* Effect.sleep("250 millis");
          return yield* poll();
        });

      return yield* poll();
    });

  const sendChildMessage: TeamOrchestrationServiceShape["sendChildMessage"] = (input) =>
    Effect.gen(function* () {
      const result = yield* loadTeamChildResult(input.parentThreadId, input.taskId);
      if (result.status === "cancelled") {
        return yield* Effect.fail(
          new TeamOrchestrationError("Cancelled child tasks cannot receive messages."),
        );
      }
      const childThreadOption = yield* projectionSnapshotQuery.getThreadDetailById(
        result.childThreadId,
      );
      const childThread = Option.isSome(childThreadOption) ? childThreadOption.value : null;
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: serverCommandId("team-child-message"),
        threadId: result.childThreadId,
        message: {
          messageId: MessageId.make(`message:${crypto.randomUUID()}`),
          role: "user",
          text: input.message,
          attachments: [],
        },
        modelSelection: result.modelSelection,
        runtimeMode: childThread?.runtimeMode ?? "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });
      const updatedAt = new Date().toISOString();
      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.upsert",
        commandId: serverCommandId("team-task-reopened"),
        parentThreadId: input.parentThreadId,
        teamTask: {
          ...toStoredTask(result),
          status: "running",
          errorText: null,
          startedAt: result.startedAt ?? updatedAt,
          completedAt: null,
          updatedAt,
        },
        createdAt: updatedAt,
      });
      return yield* loadTeamChildResult(input.parentThreadId, input.taskId);
    });

  const closeChild: TeamOrchestrationServiceShape["closeChild"] = (input: CloseTeamChildInput) =>
    Effect.gen(function* () {
      const result = yield* loadTeamChildResult(input.parentThreadId, input.taskId);
      const now = new Date().toISOString();
      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.cancel",
        commandId: serverCommandId("team-task-cancel"),
        parentThreadId: input.parentThreadId,
        taskId: input.taskId,
        createdAt: now,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.session.stop",
        commandId: serverCommandId("team-child-session-stop"),
        threadId: result.childThreadId,
        createdAt: now,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.upsert",
        commandId: serverCommandId("team-task-cancelled"),
        parentThreadId: input.parentThreadId,
        teamTask: {
          ...toStoredTask(result),
          status: "cancelled",
          errorText: input.reason ?? null,
          completedAt: now,
          updatedAt: now,
        },
        createdAt: now,
      });
      return yield* loadTeamChildResult(input.parentThreadId, input.taskId);
    });

  return {
    getCoordinatorSessionConfig,
    authenticateCoordinatorAccessToken,
    spawnChild,
    listChildren,
    waitForChildren,
    sendChildMessage,
    closeChild,
  } satisfies TeamOrchestrationServiceShape;
});

export const TeamOrchestrationServiceLive = Layer.effect(
  TeamOrchestrationService,
  makeTeamOrchestrationService,
);
