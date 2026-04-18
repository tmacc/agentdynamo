import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Effect, Layer, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { OrchestrationReadModel } from "@t3tools/contracts";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { ProjectSetupScriptRunner } from "../Services/ProjectSetupScriptRunner.ts";
import { ProjectSetupScriptRunnerLive } from "./ProjectSetupScriptRunner.ts";

const emptySnapshot = (
  scripts: OrchestrationReadModel["projects"][number]["scripts"],
  overrides?: Partial<OrchestrationReadModel["projects"][number]>,
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
        worktreeReadiness: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
        ...overrides,
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
              Layer.succeed(OrchestrationEngineService, {
                getReadModel: () => Effect.succeed(emptySnapshot([])),
                readEvents: () => Stream.empty,
                dispatch: () => Effect.die(new Error("unused")),
                streamDomainEvents: Stream.empty,
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
        threadId: "thread-1",
        projectId: "project-1",
        worktreePath: "/repo/worktrees/a",
      }),
    );

    expect(result).toEqual({ status: "no-script" });
    expect(open).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("opens the deterministic setup terminal with worktree env and writes the command", async () => {
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
                dispatch: () => Effect.die(new Error("unused")),
                streamDomainEvents: Stream.empty,
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
        threadId: "thread-1",
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
        T3CODE_PROJECT_ROOT: "/repo/project",
        T3CODE_WORKTREE_PATH: "/repo/worktrees/a",
      },
    });
    expect(write).toHaveBeenCalledWith({
      threadId: "thread-1",
      terminalId: "setup-setup",
      data: "bun install\r",
    });
  });

  it("materializes managed worktree scripts into the target worktree before launch", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t3-project-root-"));
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-worktree-"));
    const open = vi.fn(() =>
      Effect.succeed({
        threadId: "thread-1",
        terminalId: "setup-setup",
        cwd: worktreePath,
        worktreePath,
        status: "running" as const,
        pid: 123,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const write = vi.fn(() => Effect.void);

    try {
      const runner = await Effect.runPromise(
        Effect.service(ProjectSetupScriptRunner).pipe(
          Effect.provide(
            ProjectSetupScriptRunnerLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () =>
                    Effect.succeed(
                      emptySnapshot(
                        [
                          {
                            id: "setup-worktree",
                            name: "Setup worktree",
                            command: ".t3code/worktree/setup.sh",
                            icon: "configure",
                            runOnWorktreeCreate: true,
                          },
                        ],
                        {
                          workspaceRoot: projectRoot,
                          worktreeReadiness: {
                            version: 1,
                            status: "configured",
                            scanFingerprint: "scan-1",
                            lastScannedAt: "2026-01-01T00:00:00.000Z",
                            lastAppliedAt: "2026-01-01T00:00:01.000Z",
                            packageManager: "bun",
                            framework: "vite",
                            installCommand: "bun install",
                            devCommand: "bun run dev",
                            envStrategy: "none",
                            envSourcePath: null,
                            portCount: 2,
                            generatedFiles: [
                              ".t3code/worktree/setup.sh",
                              ".t3code/worktree/dev.sh",
                            ],
                            setupScriptCommand: ".t3code/worktree/setup.sh",
                            devScriptCommand: ".t3code/worktree/dev.sh",
                          },
                        },
                      ),
                    ),
                  readEvents: () => Stream.empty,
                  dispatch: () => Effect.die(new Error("unused")),
                  streamDomainEvents: Stream.empty,
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
          threadId: "thread-1",
          projectCwd: projectRoot,
          worktreePath,
        }),
      );

      expect(result).toEqual({
        status: "started",
        scriptId: "setup-worktree",
        scriptName: "Setup worktree",
        terminalId: "setup-setup-worktree",
        cwd: worktreePath,
      });
      await expect(
        fs.readFile(path.join(worktreePath, ".t3code/worktree/setup.sh"), "utf8"),
      ).resolves.toContain("bun install");
      await expect(
        fs.readFile(path.join(worktreePath, ".t3code/worktree/dev.sh"), "utf8"),
      ).resolves.toContain("bun run dev");
      await expect(
        fs.readFile(path.join(worktreePath, ".t3code/worktree.local.env"), "utf8"),
      ).resolves.toContain("T3CODE_PRIMARY_PORT=");
      expect(write).toHaveBeenCalledWith({
        threadId: "thread-1",
        terminalId: "setup-setup-worktree",
        data: ".t3code/worktree/setup.sh\r",
      });
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });
});
