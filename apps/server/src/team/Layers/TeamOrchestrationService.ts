import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationTeamTask,
  type TeamTaskId,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  resolveThreadWorkspaceContext,
  shouldSyncThreadBranchFromLiveGit,
} from "../../orchestration/threadWorkspaceContext.ts";
import { ProjectSetupScriptRunner } from "../../project/Services/ProjectSetupScriptRunner.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { renderTeamChildPrompt } from "../teamContext.ts";
import { isMaterializedDynamoTeamTask } from "../teamTaskGuards.ts";
import { selectTeamWorkerModel } from "../teamModelSelection.ts";
import {
  TeamOrchestrationService,
  type CloseTeamChildInput,
  type SendTeamChildMessageInput,
  type SpawnTeamChildInput,
  type TeamOrchestrationServiceShape,
} from "../Services/TeamOrchestrationService.ts";

const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting"]);

class TeamOrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamOrchestrationError";
  }
}

const commandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);
const messageId = (): MessageId => MessageId.make(`team-msg:${crypto.randomUUID()}`);
const threadId = (): ThreadId => ThreadId.make(`team-thread:${crypto.randomUUID()}`);
const taskId = (): TeamTaskId => `team-task:${crypto.randomUUID()}` as TeamTaskId;

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

function hasActiveStatus(task: OrchestrationTeamTask): boolean {
  return ACTIVE_STATUSES.has(task.status);
}

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const makeTeamOrchestrationService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerRegistry = yield* ProviderRegistry;
  const serverSettings = yield* ServerSettingsService;
  const git = yield* GitCore;
  const gitStatusBroadcaster = yield* GitStatusBroadcaster;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;

  const resolveParent = Effect.fn("team.resolveParent")(function* (parentThreadId: ThreadId) {
    const settings = yield* serverSettings.getSettings;
    if (!settings.teamAgents.enabled) {
      return yield* Effect.fail(new TeamOrchestrationError("Team agents are disabled."));
    }
    const readModel = yield* orchestrationEngine.getReadModel();
    const parentThread = readModel.threads.find((thread) => thread.id === parentThreadId);
    if (!parentThread || parentThread.deletedAt !== null) {
      return yield* Effect.fail(
        new TeamOrchestrationError(`Unknown parent thread '${parentThreadId}'.`),
      );
    }
    if (parentThread.archivedAt !== null) {
      return yield* Effect.fail(
        new TeamOrchestrationError(`Parent thread '${parentThreadId}' is archived.`),
      );
    }
    if (parentThread.teamParent != null) {
      return yield* Effect.fail(
        new TeamOrchestrationError("Child threads cannot delegate further in v1."),
      );
    }
    const project = readModel.projects.find((entry) => entry.id === parentThread.projectId);
    if (!project || project.deletedAt !== null) {
      return yield* Effect.fail(
        new TeamOrchestrationError(`Project '${parentThread.projectId}' was not found.`),
      );
    }
    return { readModel, settings, parentThread, project };
  });

  const resolveMaterializedChild = Effect.fn("team.resolveMaterializedChild")(function* (
    parentThreadId: ThreadId,
    taskId: TeamTaskId,
  ) {
    const { readModel, parentThread } = yield* resolveParent(parentThreadId);
    const task = (parentThread.teamTasks ?? []).find((entry) => entry.id === taskId);
    if (!task) {
      return yield* Effect.fail(new TeamOrchestrationError(`Unknown team task '${taskId}'.`));
    }
    if (!isMaterializedDynamoTeamTask(task)) {
      return yield* Effect.fail(
        new TeamOrchestrationError(
          `Team task '${taskId}' is provider-native and cannot receive direct child thread commands.`,
        ),
      );
    }
    const childThread = readModel.threads.find(
      (thread) => thread.id === task.childThreadId && thread.deletedAt === null,
    );
    if (!childThread) {
      return yield* Effect.fail(
        new TeamOrchestrationError(`Child thread '${task.childThreadId}' was not found.`),
      );
    }
    return { task, childThread };
  });

  const listChildren: TeamOrchestrationServiceShape["listChildren"] = (input) =>
    Effect.gen(function* () {
      const { parentThread } = yield* resolveParent(input.parentThreadId);
      const statuses = new Set(input.statusFilter ?? []);
      return statuses.size === 0
        ? (parentThread.teamTasks ?? [])
        : (parentThread.teamTasks ?? []).filter((task) => statuses.has(task.status));
    });

  const spawnChild: TeamOrchestrationServiceShape["spawnChild"] = (input: SpawnTeamChildInput) =>
    Effect.gen(function* () {
      const { readModel, settings, parentThread, project } = yield* resolveParent(
        input.parentThreadId,
      );
      const activeCount = (parentThread.teamTasks ?? []).filter(hasActiveStatus).length;
      if (activeCount >= settings.teamAgents.maxActiveChildren) {
        return yield* Effect.fail(
          new TeamOrchestrationError(
            `This thread already has ${activeCount} active child agents. The limit is ${settings.teamAgents.maxActiveChildren}.`,
          ),
        );
      }

      const workspace = yield* resolveThreadWorkspaceContext({
        thread: parentThread,
        projects: readModel.projects,
      }).pipe(Effect.provideService(GitCore, git));
      const cwd = workspace.cwd ?? project.workspaceRoot;
      if (
        shouldSyncThreadBranchFromLiveGit({
          storedBranch: parentThread.branch,
          liveBranch: workspace.liveBranch,
          hasWorktreePath: parentThread.worktreePath !== null,
        })
      ) {
        yield* orchestrationEngine
          .dispatch({
            type: "thread.meta.update",
            commandId: commandId("team-parent-branch-sync"),
            threadId: parentThread.id,
            branch: workspace.liveBranch,
            worktreePath: parentThread.worktreePath,
          })
          .pipe(Effect.ignoreCause({ log: true }));
      }
      const providers = yield* providerRegistry.getProviders;
      const taskKind =
        input.taskKind ??
        (input.task.match(/\b(review|audit)\b/i)
          ? "review"
          : input.task.match(/\b(test|verify)\b/i)
            ? "test"
            : input.task.match(/\b(ui|ux|frontend)\b/i)
              ? "ui"
              : input.task.match(/\b(research|explore|investigate)\b/i)
                ? "exploration"
                : "coding");
      const selected = selectTeamWorkerModel({
        taskKind,
        ...(input.provider !== undefined ? { requestedProvider: input.provider } : {}),
        ...(input.model !== undefined ? { requestedModel: input.model } : {}),
        parentThread,
        project,
        providers,
        settings,
      });
      const isGitProject = workspace.isGitRepo;
      const parentThreadForPrompt = {
        ...parentThread,
        branch: workspace.effectiveBranch,
      };
      const rendered = renderTeamChildPrompt({
        parentThread: parentThreadForPrompt,
        title: input.title,
        task: input.task,
        roleLabel: input.roleLabel ?? null,
        contextBrief: input.contextBrief ?? null,
        relevantFiles: input.relevantFiles ?? [],
        taskKind,
        modelSelection: selected.modelSelection,
        modelSelectionReason: selected.reason,
        workspaceMode: input.workspaceMode ?? "auto",
        setupMode: input.setupMode ?? "auto",
        projectHasWorktreeSetup: project.worktreeSetup?.status === "configured",
        isGitProject,
      });
      const now = new Date().toISOString();
      const nextTaskId = taskId();
      const childThreadId = threadId();
      const branch = `agent/${sanitizeBranchSegment(input.roleLabel ?? input.title)}-${String(nextTaskId).slice(-6)}`;
      const teamTask: OrchestrationTeamTask = {
        id: nextTaskId,
        parentThreadId: input.parentThreadId,
        childThreadId,
        title: input.title,
        task: input.task,
        roleLabel: input.roleLabel ?? null,
        kind: rendered.taskKind,
        modelSelection: selected.modelSelection,
        modelSelectionMode: selected.mode,
        modelSelectionReason: selected.reason,
        workspaceMode: input.workspaceMode ?? "auto",
        resolvedWorkspaceMode: rendered.policy.resolvedWorkspaceMode,
        setupMode: input.setupMode ?? "auto",
        resolvedSetupMode: rendered.policy.resolvedSetupMode,
        source: "dynamo",
        childThreadMaterialized: true,
        nativeProviderRef: null,
        status: "queued",
        latestSummary: null,
        errorText: null,
        promptStats: rendered.stats,
        createdAt: now,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
      };

      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.spawn",
        commandId: commandId("team-task-spawn"),
        teamTask,
        createdAt: now,
      });

      let childBranch: string | null =
        rendered.policy.resolvedWorkspaceMode === "shared" ? workspace.effectiveBranch : null;
      let childWorktreePath: string | null =
        rendered.policy.resolvedWorkspaceMode === "shared" ? parentThread.worktreePath : null;
      let createdDedicatedWorktree = false;
      let childThreadCreated = false;

      yield* Effect.gen(function* () {
        if (rendered.policy.resolvedWorkspaceMode === "worktree" && isGitProject) {
          const worktree = yield* git.createWorktree({
            cwd,
            branch: workspace.worktreeBaseRef,
            newBranch: branch,
            path: null,
          });
          childBranch = worktree.worktree.branch;
          childWorktreePath = worktree.worktree.path;
          createdDedicatedWorktree = true;
          yield* gitStatusBroadcaster
            .refreshStatus(childWorktreePath)
            .pipe(Effect.ignoreCause({ log: true }));
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: commandId("team-child-thread-create"),
          threadId: childThreadId,
          projectId: project.id,
          title: input.title,
          modelSelection: selected.modelSelection,
          runtimeMode: parentThread.runtimeMode,
          interactionMode: parentThread.interactionMode,
          branch: childBranch,
          worktreePath: childWorktreePath,
          createdAt: now,
        });
        childThreadCreated = true;

        yield* orchestrationEngine.dispatch({
          type: "thread.team-task.mark-starting",
          commandId: commandId("team-task-starting"),
          parentThreadId: input.parentThreadId,
          taskId: nextTaskId,
          createdAt: new Date().toISOString(),
        });

        if (rendered.policy.resolvedSetupMode === "run" && createdDedicatedWorktree) {
          yield* projectSetupScriptRunner
            .runForThread({
              threadId: childThreadId,
              projectId: project.id,
              projectCwd: project.workspaceRoot,
              worktreePath: childWorktreePath as string,
            })
            .pipe(Effect.ignoreCause({ log: true }));
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: commandId("team-child-turn-start"),
          threadId: childThreadId,
          message: {
            messageId: messageId(),
            role: "user",
            text: rendered.prompt,
            attachments: [],
          },
          modelSelection: selected.modelSelection,
          runtimeMode: parentThread.runtimeMode,
          interactionMode: parentThread.interactionMode,
          createdAt: new Date().toISOString(),
        });
      }).pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            if (createdDedicatedWorktree && childWorktreePath !== null && !childThreadCreated) {
              yield* git
                .removeWorktree({ cwd, path: childWorktreePath, force: true })
                .pipe(Effect.ignoreCause({ log: true }));
            }
            yield* orchestrationEngine
              .dispatch({
                type: "thread.team-task.mark-failed",
                commandId: commandId("team-task-spawn-failed"),
                parentThreadId: input.parentThreadId,
                taskId: nextTaskId,
                detail: `Failed to spawn child task: ${errorDetail(cause)}`,
                createdAt: new Date().toISOString(),
              })
              .pipe(Effect.ignoreCause({ log: true }));
            return yield* Effect.fail(new TeamOrchestrationError(errorDetail(cause)));
          }),
        ),
      );

      return {
        task: teamTask,
        modelSelection: selected.modelSelection,
        childThreadId,
      };
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  const waitForChildren: TeamOrchestrationServiceShape["waitForChildren"] = (input) =>
    Effect.gen(function* () {
      const deadline = Date.now() + (input.timeoutSeconds ?? 30) * 1000;
      const wanted = new Set(input.taskIds ?? []);
      while (Date.now() < deadline) {
        const children = yield* listChildren(input);
        const filtered =
          wanted.size === 0 ? children : children.filter((task) => wanted.has(task.id));
        if (filtered.every((task) => !hasActiveStatus(task))) return filtered;
        yield* Effect.sleep("250 millis");
      }
      const children = yield* listChildren(input);
      return wanted.size === 0 ? children : children.filter((task) => wanted.has(task.id));
    });

  const sendChildMessage: TeamOrchestrationServiceShape["sendChildMessage"] = (
    input: SendTeamChildMessageInput,
  ) =>
    Effect.gen(function* () {
      const { task, childThread } = yield* resolveMaterializedChild(
        input.parentThreadId,
        input.taskId,
      );
      const createdAt = new Date().toISOString();
      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.send-message",
        commandId: commandId("team-task-message"),
        parentThreadId: input.parentThreadId,
        taskId: input.taskId,
        message: input.message,
        createdAt,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: commandId("team-child-follow-up"),
        threadId: task.childThreadId,
        message: { messageId: messageId(), role: "user", text: input.message, attachments: [] },
        modelSelection: task.modelSelection,
        runtimeMode: childThread.runtimeMode,
        interactionMode: childThread.interactionMode,
        createdAt,
      });
      return { task, modelSelection: task.modelSelection, childThreadId: task.childThreadId };
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  const closeChild: TeamOrchestrationServiceShape["closeChild"] = (input: CloseTeamChildInput) =>
    Effect.gen(function* () {
      const { task } = yield* resolveMaterializedChild(input.parentThreadId, input.taskId);
      const createdAt = new Date().toISOString();
      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.close",
        commandId: commandId("team-task-close"),
        parentThreadId: input.parentThreadId,
        taskId: input.taskId,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        createdAt,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.session.stop",
        commandId: commandId("team-child-session-stop"),
        threadId: task.childThreadId,
        createdAt,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.mark-cancelled",
        commandId: commandId("team-task-cancelled"),
        parentThreadId: input.parentThreadId,
        taskId: input.taskId,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        createdAt,
      });
      return { task, modelSelection: task.modelSelection, childThreadId: task.childThreadId };
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  return {
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
