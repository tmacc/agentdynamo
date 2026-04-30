import { Effect, Layer, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ProjectId, ThreadId, type OrchestrationReadModel } from "@t3tools/contracts";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { ProjectSetupScriptRunner } from "../Services/ProjectSetupScriptRunner.ts";
import { WorktreeSetupRuntime } from "../Services/WorktreeSetupRuntime.ts";
import { ProjectSetupScriptRunnerLive } from "./ProjectSetupScriptRunner.ts";

const emptySnapshot = (
  scripts: OrchestrationReadModel["projects"][number]["scripts"],
  worktreeSetup: OrchestrationReadModel["projects"][number]["worktreeSetup"] = null,
): OrchestrationReadModel =>
  ({
    snapshotSequence: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    projects: [
      {
        id: "project-1",
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: null,
        scripts,
        worktreeSetup,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [],
    providerSessions: [],
    providerStatuses: [],
    pendingApprovals: [],
    latestTurnByThreadId: {},
  }) as unknown as OrchestrationReadModel;

describe("ProjectSetupScriptRunner", () => {
  it("returns no-script when no setup script exists", async () => {
    const open = vi.fn();
    const write = vi.fn();
    const runner = await Effect.runPromise(
      Effect.service(ProjectSetupScriptRunner).pipe(
        Effect.provide(
          ProjectSetupScriptRunnerLive.pipe(
            Layer.provideMerge(
              Layer.succeed(WorktreeSetupRuntime, {
                materializeProjectHelpers: () => Effect.die(new Error("unused")),
                prepareWorktreeRuntime: () => Effect.die(new Error("unused")),
                runSetupForThread: () => Effect.die(new Error("unused")),
                runDevForThread: () => Effect.die(new Error("unused")),
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(OrchestrationEngineService, {
                getReadModel: () => Effect.succeed(emptySnapshot([])),
                readEvents: () => Stream.empty,
                getLatestSequence: () => Effect.succeed(0),
                readEventsRange: () => Stream.empty,
                dispatch: () => Effect.die(new Error("unused")),
                streamDomainEvents: Stream.empty,
                subscribeDomainEvents: () => Effect.die(new Error("unused")),
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(TerminalManager, {
                open,
                write,
                resize: () => Effect.void,
                clear: () => Effect.void,
                restart: () => Effect.die(new Error("unused")),
                close: () => Effect.void,
                subscribe: () => Effect.succeed(() => undefined),
              }),
            ),
          ),
        ),
      ),
    );

    const result = await Effect.runPromise(
      runner.runForThread({
        threadId: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        worktreePath: "/repo/worktrees/a",
      }),
    );

    expect(result).toEqual({ status: "no-script" });
    expect(open).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("prefers configured worktree setup over custom setup scripts", async () => {
    const runSetupForThread = vi.fn(() =>
      Effect.succeed({
        status: "started" as const,
        scriptId: "worktree-setup" as const,
        scriptName: "Worktree setup",
        terminalId: "worktree-setup",
        cwd: "/repo/worktrees/a",
      }),
    );
    const runner = await Effect.runPromise(
      Effect.service(ProjectSetupScriptRunner).pipe(
        Effect.provide(
          ProjectSetupScriptRunnerLive.pipe(
            Layer.provideMerge(
              Layer.succeed(WorktreeSetupRuntime, {
                materializeProjectHelpers: () => Effect.die(new Error("unused")),
                prepareWorktreeRuntime: () => Effect.die(new Error("unused")),
                runSetupForThread,
                runDevForThread: () => Effect.die(new Error("unused")),
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(OrchestrationEngineService, {
                getReadModel: () =>
                  Effect.succeed(
                    emptySnapshot(
                      [
                        {
                          id: "setup",
                          name: "Setup",
                          command: "bun install",
                          icon: "configure",
                          runOnWorktreeCreate: true,
                        },
                      ],
                      {
                        version: 1,
                        status: "configured",
                        scanFingerprint: "fingerprint-1",
                        packageManager: "bun",
                        framework: "vite",
                        installCommand: "bun install",
                        devCommand: "bun run dev",
                        envStrategy: "none",
                        envSourcePath: null,
                        portCount: 5,
                        storageMode: "dynamo-managed",
                        autoRunSetupOnWorktreeCreate: true,
                        createdAt: "2026-01-01T00:00:00.000Z",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                      },
                    ),
                  ),
                readEvents: () => Stream.empty,
                getLatestSequence: () => Effect.succeed(0),
                readEventsRange: () => Stream.empty,
                dispatch: () => Effect.die(new Error("unused")),
                streamDomainEvents: Stream.empty,
                subscribeDomainEvents: () => Effect.die(new Error("unused")),
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(TerminalManager, {
                open: () => Effect.die(new Error("unused")),
                write: () => Effect.die(new Error("unused")),
                resize: () => Effect.void,
                clear: () => Effect.void,
                restart: () => Effect.die(new Error("unused")),
                close: () => Effect.void,
                subscribe: () => Effect.succeed(() => undefined),
              }),
            ),
          ),
        ),
      ),
    );

    const result = await Effect.runPromise(
      runner.runForThread({
        threadId: ThreadId.make("thread-1"),
        projectCwd: "/repo/project",
        worktreePath: "/repo/worktrees/a",
      }),
    );

    expect(result).toMatchObject({ status: "started", scriptId: "worktree-setup" });
    expect(runSetupForThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      projectId: "project-1",
      projectCwd: "/repo/project",
      worktreePath: "/repo/worktrees/a",
      profile: expect.objectContaining({ scanFingerprint: "fingerprint-1" }),
    });
  });

  it("opens the deterministic setup terminal with worktree env and an initial command", async () => {
    const open = vi.fn(() =>
      Effect.succeed({
        threadId: "thread-1",
        terminalId: "setup-setup",
        cwd: "/repo/worktrees/a",
        worktreePath: "/repo/worktrees/a",
        status: "running" as const,
        pid: 123,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const write = vi.fn(() => Effect.void);
    const runner = await Effect.runPromise(
      Effect.service(ProjectSetupScriptRunner).pipe(
        Effect.provide(
          ProjectSetupScriptRunnerLive.pipe(
            Layer.provideMerge(
              Layer.succeed(WorktreeSetupRuntime, {
                materializeProjectHelpers: () => Effect.die(new Error("unused")),
                prepareWorktreeRuntime: () => Effect.die(new Error("unused")),
                runSetupForThread: () => Effect.die(new Error("unused")),
                runDevForThread: () => Effect.die(new Error("unused")),
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(OrchestrationEngineService, {
                getReadModel: () =>
                  Effect.succeed(
                    emptySnapshot([
                      {
                        id: "setup",
                        name: "Setup",
                        command: "bun install",
                        icon: "configure",
                        runOnWorktreeCreate: true,
                      },
                    ]),
                  ),
                readEvents: () => Stream.empty,
                getLatestSequence: () => Effect.succeed(0),
                readEventsRange: () => Stream.empty,
                dispatch: () => Effect.die(new Error("unused")),
                streamDomainEvents: Stream.empty,
                subscribeDomainEvents: () => Effect.die(new Error("unused")),
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(TerminalManager, {
                open,
                write,
                resize: () => Effect.void,
                clear: () => Effect.void,
                restart: () => Effect.die(new Error("unused")),
                close: () => Effect.void,
                subscribe: () => Effect.succeed(() => undefined),
              }),
            ),
          ),
        ),
      ),
    );

    const result = await Effect.runPromise(
      runner.runForThread({
        threadId: ThreadId.make("thread-1"),
        projectCwd: "/repo/project",
        worktreePath: "/repo/worktrees/a",
      }),
    );

    expect(result).toEqual({
      status: "started",
      scriptId: "setup",
      scriptName: "Setup",
      terminalId: "setup-setup",
      cwd: "/repo/worktrees/a",
    });
    expect(open).toHaveBeenCalledWith({
      threadId: "thread-1",
      terminalId: "setup-setup",
      cwd: "/repo/worktrees/a",
      worktreePath: "/repo/worktrees/a",
      env: {
        DYNAMO_PROJECT_ROOT: "/repo/project",
        DYNAMO_WORKTREE_PATH: "/repo/worktrees/a",
        T3CODE_PROJECT_ROOT: "/repo/project",
        T3CODE_WORKTREE_PATH: "/repo/worktrees/a",
      },
      initialCommand: "bun install",
    });
    expect(write).not.toHaveBeenCalled();
  });
});
