import {
  CommandId,
  EventId,
  ProjectId,
  TeamTaskId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationTeamTask,
  type ServerProvider,
  type GitStatusResult,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import {
  GitStatusBroadcaster,
  type GitStatusBroadcasterShape,
} from "../../git/Services/GitStatusBroadcaster.ts";
import { OrchestrationCommandInvariantError } from "../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { createEmptyReadModel, projectEvent } from "../../orchestration/projector.ts";
import {
  ProjectSetupScriptRunner,
  type ProjectSetupScriptRunnerShape,
} from "../../project/Services/ProjectSetupScriptRunner.ts";
import {
  ProviderRegistry,
  type ProviderRegistryShape,
} from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TeamOrchestrationService } from "../Services/TeamOrchestrationService.ts";
import { TeamOrchestrationServiceLive } from "./TeamOrchestrationService.ts";

const now = "2026-01-01T00:00:00.000Z";
const parentWorktreePath = "/repo/.dynamo/worktrees/project/t3code-411b93f1";

const gitStatus = (overrides: Partial<GitStatusResult> = {}): GitStatusResult => ({
  isRepo: false,
  hasOriginRemote: false,
  isDefaultBranch: false,
  branch: null,
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
  ...overrides,
});

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-parent"),
    occurredAt: now,
    commandId: CommandId.make(`cmd-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

function provider(): ServerProvider {
  return {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "test",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: now,
    models: [
      {
        slug: "gpt-5.5",
        name: "GPT 5.5",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
  };
}

function teamTask(overrides: Partial<OrchestrationTeamTask> = {}): OrchestrationTeamTask {
  return {
    id: TeamTaskId.make("team-task:dynamo:abc123"),
    parentThreadId: ThreadId.make("thread-parent"),
    childThreadId: ThreadId.make("thread-child"),
    title: "Dynamo child",
    task: "Implement a child task",
    roleLabel: "Worker",
    kind: "coding",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.5",
    },
    modelSelectionMode: "coordinator-selected",
    modelSelectionReason: "Selected for test.",
    workspaceMode: "shared",
    resolvedWorkspaceMode: "shared",
    setupMode: "skip",
    resolvedSetupMode: "skip",
    source: "dynamo",
    childThreadMaterialized: true,
    nativeProviderRef: null,
    status: "running",
    latestSummary: null,
    errorText: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

async function baseReadModel(
  options: {
    readonly parentBranch?: string | null;
    readonly parentWorktreePath?: string | null;
  } = {},
) {
  let readModel = createEmptyReadModel(now);
  for (const event of [
    makeEvent({
      sequence: 1,
      type: "project.created",
      payload: {
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5.5",
        },
        scripts: [],
        worktreeSetup: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
    makeEvent({
      sequence: 2,
      type: "thread.created",
      payload: {
        threadId: ThreadId.make("thread-parent"),
        projectId: ProjectId.make("project-1"),
        title: "Parent",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.5",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: options.parentBranch ?? null,
        worktreePath: options.parentWorktreePath ?? null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  ]) {
    readModel = await Effect.runPromise(projectEvent(readModel, event));
  }
  return readModel;
}

async function readModelWithTask(task: OrchestrationTeamTask) {
  let readModel = await baseReadModel();
  if (task.childThreadMaterialized) {
    readModel = await Effect.runPromise(
      projectEvent(
        readModel,
        makeEvent({
          sequence: 3,
          type: "thread.created",
          payload: {
            threadId: task.childThreadId,
            projectId: ProjectId.make("project-1"),
            title: "Child",
            modelSelection: task.modelSelection,
            runtimeMode: "approval-required",
            interactionMode: "plan",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    );
  }
  return Effect.runPromise(
    projectEvent(
      readModel,
      makeEvent({
        sequence: 4,
        type: "thread.team-task-created",
        payload: {
          parentThreadId: ThreadId.make("thread-parent"),
          teamTask: task,
        },
      }),
    ),
  );
}

async function makeRuntime(input: {
  readonly readModel: OrchestrationReadModel;
  readonly commands: OrchestrationCommand[];
  readonly failCommandType?: OrchestrationCommand["type"];
  readonly git?: Partial<GitCoreShape>;
  readonly setup?: Partial<ProjectSetupScriptRunnerShape>;
}) {
  const engine = {
    getReadModel: () => Effect.succeed(input.readModel),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    dispatch: (command: OrchestrationCommand) =>
      Effect.sync(() => {
        input.commands.push(command);
      }).pipe(
        Effect.flatMap(() =>
          command.type === input.failCommandType
            ? Effect.fail(
                new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "test dispatch failure",
                }),
              )
            : Effect.succeed({ sequence: input.commands.length }),
        ),
      ),
  };
  const registry = {
    getProviders: Effect.succeed([provider()]),
    refresh: () => Effect.succeed([provider()]),
    streamChanges: Stream.empty,
  } satisfies ProviderRegistryShape;
  const git = {
    status: () => Effect.succeed(gitStatus()),
    removeWorktree: () => Effect.void,
    ...input.git,
  } as unknown as GitCoreShape;
  const gitStatusBroadcaster = {
    refreshStatus: () =>
      Effect.succeed({
        isRepo: false,
        hasOriginRemote: false,
        isDefaultBranch: false,
        branch: null,
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      }),
  } as unknown as GitStatusBroadcasterShape;
  const setup = {
    runForThread: () => Effect.succeed({ status: "no-script" as const }),
    ...input.setup,
  } satisfies ProjectSetupScriptRunnerShape;
  const layer = TeamOrchestrationServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(OrchestrationEngineService, engine),
        Layer.succeed(ProviderRegistry, registry),
        ServerSettingsService.layerTest({
          teamAgents: {
            enabled: true,
            maxActiveChildren: 3,
          },
        }),
        Layer.succeed(GitCore, git),
        Layer.succeed(GitStatusBroadcaster, gitStatusBroadcaster),
        Layer.succeed(ProjectSetupScriptRunner, setup),
      ),
    ),
  );
  const runtime = ManagedRuntime.make(layer);
  const service = await runtime.runPromise(Effect.service(TeamOrchestrationService));
  return { runtime, service };
}

describe("TeamOrchestrationService", () => {
  it("rejects native follow-up and close requests before dispatching commands", async () => {
    const commands: OrchestrationCommand[] = [];
    const nativeTask = teamTask({
      id: TeamTaskId.make("team-task:native:codex:abc123"),
      childThreadId: ThreadId.make("native-child:codex:abc123"),
      source: "native-provider",
      childThreadMaterialized: false,
      nativeProviderRef: {
        provider: "codex",
        providerItemId: "item-1",
      },
    });
    const { runtime, service } = await makeRuntime({
      readModel: await readModelWithTask(nativeTask),
      commands,
    });
    try {
      const messageResult = await runtime.runPromiseExit(
        service.sendChildMessage({
          parentThreadId: ThreadId.make("thread-parent"),
          taskId: nativeTask.id,
          message: "Continue.",
        }),
      );
      const closeResult = await runtime.runPromiseExit(
        service.closeChild({
          parentThreadId: ThreadId.make("thread-parent"),
          taskId: nativeTask.id,
          reason: "Stop.",
        }),
      );

      expect(Exit.isFailure(messageResult)).toBe(true);
      expect(Exit.isFailure(closeResult)).toBe(true);
      expect(commands).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("preserves the child thread runtime and interaction modes for follow-up turns", async () => {
    const commands: OrchestrationCommand[] = [];
    const task = teamTask();
    const { runtime, service } = await makeRuntime({
      readModel: await readModelWithTask(task),
      commands,
    });
    try {
      await runtime.runPromise(
        service.sendChildMessage({
          parentThreadId: ThreadId.make("thread-parent"),
          taskId: task.id,
          message: "Continue.",
        }),
      );

      const followUp = commands.find((command) => command.type === "thread.turn.start");
      expect(followUp).toMatchObject({
        type: "thread.turn.start",
        threadId: ThreadId.make("thread-child"),
        runtimeMode: "approval-required",
        interactionMode: "plan",
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("marks a spawned task failed when a post-spawn dispatch fails", async () => {
    const commands: OrchestrationCommand[] = [];
    const { runtime, service } = await makeRuntime({
      readModel: await baseReadModel(),
      commands,
      failCommandType: "thread.turn.start",
    });
    try {
      const result = await runtime.runPromiseExit(
        service.spawnChild({
          parentThreadId: ThreadId.make("thread-parent"),
          title: "Child",
          task: "Do the work",
          workspaceMode: "shared",
          setupMode: "skip",
        }),
      );

      expect(Exit.isFailure(result)).toBe(true);
      expect(commands.map((command) => command.type)).toEqual([
        "thread.team-task.spawn",
        "thread.create",
        "thread.team-task.mark-starting",
        "thread.turn.start",
        "thread.team-task.mark-failed",
      ]);
      const failed = commands.at(-1);
      expect(failed).toMatchObject({
        type: "thread.team-task.mark-failed",
        detail: expect.stringContaining("test dispatch failure"),
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("inherits the coordinator worktree for shared child agents", async () => {
    const commands: OrchestrationCommand[] = [];
    const createWorktree = vi.fn();
    const runForThread = vi.fn((_: Parameters<ProjectSetupScriptRunnerShape["runForThread"]>[0]) =>
      Effect.succeed({ status: "no-script" as const }),
    );
    const { runtime, service } = await makeRuntime({
      readModel: await baseReadModel({
        parentBranch: "main",
        parentWorktreePath,
      }),
      commands,
      git: {
        status: () => Effect.succeed(gitStatus({ isRepo: true, branch: "t3code/411b93f1" })),
        createWorktree,
      },
      setup: { runForThread },
    });
    try {
      await runtime.runPromise(
        service.spawnChild({
          parentThreadId: ThreadId.make("thread-parent"),
          title: "Shared child",
          task: "Do shared work",
          workspaceMode: "shared",
          setupMode: "run",
        }),
      );

      const childCreate = commands.find((command) => command.type === "thread.create");
      expect(childCreate).toMatchObject({
        type: "thread.create",
        branch: "t3code/411b93f1",
        worktreePath: parentWorktreePath,
      });
      const turnStart = commands.find((command) => command.type === "thread.turn.start");
      expect(turnStart).toMatchObject({
        type: "thread.turn.start",
        message: expect.objectContaining({
          text: expect.stringContaining("Coordinator branch: t3code/411b93f1"),
        }),
      });
      expect(createWorktree).not.toHaveBeenCalled();
      expect(runForThread).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it("creates worktree child agents from the coordinator HEAD", async () => {
    const commands: OrchestrationCommand[] = [];
    const createWorktree = vi.fn((_: Parameters<GitCoreShape["createWorktree"]>[0]) =>
      Effect.succeed({
        worktree: {
          branch: "agent/worker-123456",
          path: "/repo/.dynamo/worktrees/project/agent-worker-123456",
        },
      }),
    );
    const { runtime, service } = await makeRuntime({
      readModel: await baseReadModel({
        parentBranch: "main",
        parentWorktreePath,
      }),
      commands,
      git: {
        status: () => Effect.succeed(gitStatus({ isRepo: true, branch: "t3code/411b93f1" })),
        createWorktree,
      },
    });
    try {
      await runtime.runPromise(
        service.spawnChild({
          parentThreadId: ThreadId.make("thread-parent"),
          title: "Worktree child",
          task: "Do isolated work",
          workspaceMode: "worktree",
          setupMode: "skip",
        }),
      );

      expect(createWorktree).toHaveBeenCalledTimes(1);
      expect(createWorktree.mock.calls[0]?.[0]).toMatchObject({
        cwd: parentWorktreePath,
        branch: "HEAD",
        path: null,
      });
      expect(createWorktree.mock.calls[0]?.[0].newBranch).toMatch(/^agent\//);

      const childCreate = commands.find((command) => command.type === "thread.create");
      expect(childCreate).toMatchObject({
        type: "thread.create",
        branch: "agent/worker-123456",
        worktreePath: "/repo/.dynamo/worktrees/project/agent-worker-123456",
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("syncs stale parent branch metadata from live git before spawning", async () => {
    const commands: OrchestrationCommand[] = [];
    const { runtime, service } = await makeRuntime({
      readModel: await baseReadModel({
        parentBranch: "main",
        parentWorktreePath,
      }),
      commands,
      git: {
        status: () => Effect.succeed(gitStatus({ isRepo: true, branch: "t3code/411b93f1" })),
      },
    });
    try {
      await runtime.runPromise(
        service.spawnChild({
          parentThreadId: ThreadId.make("thread-parent"),
          title: "Child",
          task: "Do the work",
          workspaceMode: "shared",
          setupMode: "skip",
        }),
      );

      expect(commands[0]).toMatchObject({
        type: "thread.meta.update",
        threadId: ThreadId.make("thread-parent"),
        branch: "t3code/411b93f1",
        worktreePath: parentWorktreePath,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("continues spawning when best-effort parent branch sync fails", async () => {
    const commands: OrchestrationCommand[] = [];
    const { runtime, service } = await makeRuntime({
      readModel: await baseReadModel({
        parentBranch: "main",
        parentWorktreePath,
      }),
      commands,
      failCommandType: "thread.meta.update",
      git: {
        status: () => Effect.succeed(gitStatus({ isRepo: true, branch: "t3code/411b93f1" })),
      },
    });
    try {
      await runtime.runPromise(
        service.spawnChild({
          parentThreadId: ThreadId.make("thread-parent"),
          title: "Child",
          task: "Do the work",
          workspaceMode: "shared",
          setupMode: "skip",
        }),
      );

      expect(commands.map((command) => command.type)).toContain("thread.create");
      const childCreate = commands.find((command) => command.type === "thread.create");
      expect(childCreate).toMatchObject({
        type: "thread.create",
        branch: "t3code/411b93f1",
        worktreePath: parentWorktreePath,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("does not sync parent branch metadata for project-root threads", async () => {
    const commands: OrchestrationCommand[] = [];
    const { runtime, service } = await makeRuntime({
      readModel: await baseReadModel({
        parentBranch: null,
        parentWorktreePath: null,
      }),
      commands,
      git: {
        status: () => Effect.succeed(gitStatus({ isRepo: true, branch: "feature/live" })),
      },
    });
    try {
      await runtime.runPromise(
        service.spawnChild({
          parentThreadId: ThreadId.make("thread-parent"),
          title: "Child",
          task: "Do the work",
          workspaceMode: "shared",
          setupMode: "skip",
        }),
      );

      expect(commands.some((command) => command.type === "thread.meta.update")).toBe(false);
      expect(commands.map((command) => command.type)).toContain("thread.create");
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps auto children shared for non-git projects", async () => {
    const commands: OrchestrationCommand[] = [];
    const createWorktree = vi.fn();
    const { runtime, service } = await makeRuntime({
      readModel: await baseReadModel(),
      commands,
      git: {
        status: () => Effect.succeed(gitStatus({ isRepo: false })),
        createWorktree,
      },
    });
    try {
      await runtime.runPromise(
        service.spawnChild({
          parentThreadId: ThreadId.make("thread-parent"),
          title: "Non-git child",
          task: "Do the work",
          workspaceMode: "auto",
          setupMode: "skip",
        }),
      );

      const taskSpawn = commands.find((command) => command.type === "thread.team-task.spawn");
      expect(taskSpawn).toMatchObject({
        type: "thread.team-task.spawn",
        teamTask: expect.objectContaining({
          resolvedWorkspaceMode: "shared",
        }),
      });
      const childCreate = commands.find((command) => command.type === "thread.create");
      expect(childCreate).toMatchObject({
        type: "thread.create",
        branch: null,
        worktreePath: null,
      });
      expect(createWorktree).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });
});
