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
import {
  buildManagedWorktreeScriptFiles,
  resolveWorktreeRuntimeEnvFilePath,
  LEGACY_WORKTREE_LOCAL_ENV_PATH,
  WORKTREE_MANAGED_HEADER,
} from "./WorktreeReadinessShared.ts";

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

function configuredWorktreeReadiness() {
  return {
    version: 1 as const,
    status: "configured" as const,
    scanFingerprint: "scan-1",
    lastScannedAt: "2026-01-01T00:00:00.000Z",
    lastAppliedAt: "2026-01-01T00:00:01.000Z",
    packageManager: "bun" as const,
    framework: "vite" as const,
    installCommand: "bun install",
    devCommand: "bun run dev",
    envStrategy: "none" as const,
    envSourcePath: null,
    portCount: 2,
    generatedFiles: [".t3code/worktree/setup.sh", ".t3code/worktree/dev.sh"],
    setupScriptCommand: ".t3code/worktree/setup.sh",
    devScriptCommand: ".t3code/worktree/dev.sh",
  };
}

function setupWorktreeScripts(): OrchestrationReadModel["projects"][number]["scripts"] {
  return [
    {
      id: "setup-worktree",
      name: "Setup worktree",
      command: ".t3code/worktree/setup.sh",
      icon: "configure",
      runOnWorktreeCreate: true,
    },
  ];
}

async function initializeGitWorktree(worktreePath: string): Promise<void> {
  await fs.mkdir(path.join(worktreePath, ".git"), { recursive: true });
}

async function writeManagedWorktreeScripts(
  worktreePath: string,
  runtimeEnvPathMode: "git-admin" | "legacy-worktree" = "git-admin",
): Promise<void> {
  const managedFiles = buildManagedWorktreeScriptFiles({
    installCommand: "bun install",
    envStrategy: "none",
    envSourcePath: null,
    framework: "vite",
    packageManager: "bun",
    devCommand: "bun run dev",
    runtimeEnvPathMode,
  });
  for (const [relativePath, contents] of managedFiles) {
    const absolutePath = path.join(worktreePath, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents, "utf8");
  }
}

async function writeLegacyRuntimeEnvFile(
  worktreePath: string,
  contents = "HOST=127.0.0.1\nPORT=45000\nT3CODE_PRIMARY_PORT=45000\nT3CODE_PORT_1=45000\n",
): Promise<string> {
  const legacyEnvPath = path.join(worktreePath, LEGACY_WORKTREE_LOCAL_ENV_PATH);
  await fs.mkdir(path.dirname(legacyEnvPath), { recursive: true });
  await fs.writeFile(legacyEnvPath, contents, "utf8");
  return legacyEnvPath;
}

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
      await initializeGitWorktree(worktreePath);
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
        fs.readFile(path.join(worktreePath, ".t3code/worktree/setup.sh"), "utf8"),
      ).resolves.toContain('git -C "$WORKTREE_ROOT" rev-parse --absolute-git-dir');
      const runtimeEnvPath = await resolveWorktreeRuntimeEnvFilePath(worktreePath);
      await expect(fs.readFile(runtimeEnvPath, "utf8")).resolves.toContain("T3CODE_PRIMARY_PORT=");
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

  it("preserves identical managed worktree scripts before launch", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t3-project-root-identical-"));
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-worktree-identical-"));
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
      await initializeGitWorktree(worktreePath);
      const managedFiles = buildManagedWorktreeScriptFiles({
        installCommand: "bun install",
        envStrategy: "none",
        envSourcePath: null,
        framework: "vite",
        packageManager: "bun",
        devCommand: "bun run dev",
      });
      for (const [relativePath, contents] of managedFiles) {
        const absolutePath = path.join(worktreePath, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, contents, "utf8");
      }

      const runner = await Effect.runPromise(
        Effect.service(ProjectSetupScriptRunner).pipe(
          Effect.provide(
            ProjectSetupScriptRunnerLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () =>
                    Effect.succeed(
                      emptySnapshot(setupWorktreeScripts(), {
                        workspaceRoot: projectRoot,
                        worktreeReadiness: configuredWorktreeReadiness(),
                      }),
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

      expect(result.status).toBe("started");
      expect(open).toHaveBeenCalledOnce();
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

  it("auto-refreshes legacy generated helpers before migrating the legacy env file", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t3-project-root-legacy-"));
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-worktree-legacy-"));
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
      await initializeGitWorktree(worktreePath);
      await writeManagedWorktreeScripts(worktreePath, "legacy-worktree");
      const legacyEnvPath = await writeLegacyRuntimeEnvFile(worktreePath);

      const runner = await Effect.runPromise(
        Effect.service(ProjectSetupScriptRunner).pipe(
          Effect.provide(
            ProjectSetupScriptRunnerLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () =>
                    Effect.succeed(
                      emptySnapshot(setupWorktreeScripts(), {
                        workspaceRoot: projectRoot,
                        worktreeReadiness: configuredWorktreeReadiness(),
                      }),
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

      expect(result.status).toBe("started");
      await expect(
        fs.readFile(path.join(worktreePath, ".t3code/worktree/setup.sh"), "utf8"),
      ).resolves.toContain('git -C "$WORKTREE_ROOT" rev-parse --absolute-git-dir');
      await expect(
        fs.readFile(path.join(worktreePath, ".t3code/worktree/dev.sh"), "utf8"),
      ).resolves.toContain('git -C "$WORKTREE_ROOT" rev-parse --absolute-git-dir');
      const runtimeEnvPath = await resolveWorktreeRuntimeEnvFilePath(worktreePath);
      await expect(fs.readFile(runtimeEnvPath, "utf8")).resolves.toContain("T3CODE_PRIMARY_PORT=");
      await expect(fs.access(legacyEnvPath)).rejects.toThrow();
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

  it("fails before env migration when setup.sh is unmanaged drift", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "t3-project-root-unmanaged-legacy-drift-"),
    );
    const worktreePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "t3-worktree-unmanaged-legacy-drift-"),
    );
    const open = vi.fn(() => Effect.die(new Error("should not open terminal")));
    const write = vi.fn(() => Effect.void);

    try {
      await initializeGitWorktree(worktreePath);
      await writeManagedWorktreeScripts(worktreePath);
      await fs.writeFile(
        path.join(worktreePath, ".t3code/worktree/setup.sh"),
        "#!/usr/bin/env zsh\necho unmanaged drift\n",
        "utf8",
      );
      const legacyEnvPath = await writeLegacyRuntimeEnvFile(worktreePath);

      const runner = await Effect.runPromise(
        Effect.service(ProjectSetupScriptRunner).pipe(
          Effect.provide(
            ProjectSetupScriptRunnerLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () =>
                    Effect.succeed(
                      emptySnapshot(setupWorktreeScripts(), {
                        workspaceRoot: projectRoot,
                        worktreeReadiness: configuredWorktreeReadiness(),
                      }),
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

      await expect(
        Effect.runPromise(
          runner.runForThread({
            threadId: "thread-1",
            projectCwd: projectRoot,
            worktreePath,
          }),
        ),
      ).rejects.toThrow("Worktree helper drift detected at .t3code/worktree/setup.sh");
      await expect(fs.access(legacyEnvPath)).resolves.toBeUndefined();
      await expect(
        fs.access(await resolveWorktreeRuntimeEnvFilePath(worktreePath)),
      ).rejects.toThrow();
      expect(open).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("fails before env migration when dev.sh is arbitrary managed drift", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t3-project-root-managed-drift-"));
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-worktree-managed-drift-"));
    const open = vi.fn(() => Effect.die(new Error("should not open terminal")));
    const write = vi.fn(() => Effect.void);

    try {
      await initializeGitWorktree(worktreePath);
      await writeManagedWorktreeScripts(worktreePath);
      await fs.writeFile(
        path.join(worktreePath, ".t3code/worktree/dev.sh"),
        `#!/usr/bin/env zsh\n${WORKTREE_MANAGED_HEADER}\necho managed drift\n`,
        "utf8",
      );
      const legacyEnvPath = await writeLegacyRuntimeEnvFile(worktreePath);

      const runner = await Effect.runPromise(
        Effect.service(ProjectSetupScriptRunner).pipe(
          Effect.provide(
            ProjectSetupScriptRunnerLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () =>
                    Effect.succeed(
                      emptySnapshot(setupWorktreeScripts(), {
                        workspaceRoot: projectRoot,
                        worktreeReadiness: configuredWorktreeReadiness(),
                      }),
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

      await expect(
        Effect.runPromise(
          runner.runForThread({
            threadId: "thread-1",
            projectCwd: projectRoot,
            worktreePath,
          }),
        ),
      ).rejects.toThrow("Worktree helper drift detected at .t3code/worktree/dev.sh");
      await expect(fs.access(legacyEnvPath)).resolves.toBeUndefined();
      await expect(
        fs.access(await resolveWorktreeRuntimeEnvFilePath(worktreePath)),
      ).rejects.toThrow();
      expect(open).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("fails before launch when setup.sh drifts from the configured readiness profile", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t3-project-root-drift-"));
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-worktree-drift-"));
    const open = vi.fn(() => Effect.die(new Error("should not open terminal")));
    const write = vi.fn(() => Effect.void);

    try {
      await initializeGitWorktree(worktreePath);
      const managedFiles = buildManagedWorktreeScriptFiles({
        installCommand: "bun install",
        envStrategy: "none",
        envSourcePath: null,
        framework: "vite",
        packageManager: "bun",
        devCommand: "bun run dev",
      });
      const setupFile = managedFiles.find(([relativePath]) => relativePath.endsWith("setup.sh"));
      if (!setupFile) {
        throw new Error("Expected setup.sh in managed worktree scripts.");
      }
      const setupAbsolutePath = path.join(worktreePath, setupFile[0]);
      await fs.mkdir(path.dirname(setupAbsolutePath), { recursive: true });
      await fs.writeFile(setupAbsolutePath, "#!/usr/bin/env zsh\necho drift\n", "utf8");

      const runner = await Effect.runPromise(
        Effect.service(ProjectSetupScriptRunner).pipe(
          Effect.provide(
            ProjectSetupScriptRunnerLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () =>
                    Effect.succeed(
                      emptySnapshot(setupWorktreeScripts(), {
                        workspaceRoot: projectRoot,
                        worktreeReadiness: configuredWorktreeReadiness(),
                      }),
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

      await expect(
        Effect.runPromise(
          runner.runForThread({
            threadId: "thread-1",
            projectCwd: projectRoot,
            worktreePath,
          }),
        ),
      ).rejects.toThrow("Worktree helper drift detected at .t3code/worktree/setup.sh");
      expect(open).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("fails before launch when dev.sh drifts from the configured readiness profile", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t3-project-root-dev-drift-"));
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-worktree-dev-drift-"));
    const open = vi.fn(() => Effect.die(new Error("should not open terminal")));
    const write = vi.fn(() => Effect.void);

    try {
      await initializeGitWorktree(worktreePath);
      const managedFiles = buildManagedWorktreeScriptFiles({
        installCommand: "bun install",
        envStrategy: "none",
        envSourcePath: null,
        framework: "vite",
        packageManager: "bun",
        devCommand: "bun run dev",
      });
      const devFile = managedFiles.find(([relativePath]) => relativePath.endsWith("dev.sh"));
      if (!devFile) {
        throw new Error("Expected dev.sh in managed worktree scripts.");
      }
      const devAbsolutePath = path.join(worktreePath, devFile[0]);
      await fs.mkdir(path.dirname(devAbsolutePath), { recursive: true });
      await fs.writeFile(devAbsolutePath, "#!/usr/bin/env zsh\necho drift\n", "utf8");

      const runner = await Effect.runPromise(
        Effect.service(ProjectSetupScriptRunner).pipe(
          Effect.provide(
            ProjectSetupScriptRunnerLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () =>
                    Effect.succeed(
                      emptySnapshot(setupWorktreeScripts(), {
                        workspaceRoot: projectRoot,
                        worktreeReadiness: configuredWorktreeReadiness(),
                      }),
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

      await expect(
        Effect.runPromise(
          runner.runForThread({
            threadId: "thread-1",
            projectCwd: projectRoot,
            worktreePath,
          }),
        ),
      ).rejects.toThrow("Worktree helper drift detected at .t3code/worktree/dev.sh");
      expect(open).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });
});
