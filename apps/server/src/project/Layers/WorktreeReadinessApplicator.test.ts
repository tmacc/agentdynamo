import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  ProjectId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";
import { WorktreeReadinessApplicator } from "../Services/WorktreeReadinessApplicator.ts";
import { WorktreeReadinessApplicatorLive } from "./WorktreeReadinessApplicator.ts";
import {
  buildManagedWorktreeScriptFiles,
  computeReadinessAnalysis,
} from "./WorktreeReadinessShared.ts";

const execFileAsync = promisify(execFile);

async function initGitRepo(cwd: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd });
}

function makeReadModel(project: Partial<OrchestrationReadModel["projects"][number]>) {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    projects: [
      {
        id: "project-1",
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: null,
        scripts: [],
        worktreeReadiness: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
        ...project,
      },
    ],
    threads: [],
    providerSessions: [],
    providerStatuses: [],
    pendingApprovals: [],
    latestTurnByThreadId: {},
  } as unknown as OrchestrationReadModel;
}

describe("WorktreeReadinessApplicator", () => {
  it("records a telemetry event when readiness is applied", async () => {
    const projectCwd = await fs.mkdtemp(path.join(os.tmpdir(), "t3-readiness-apply-"));
    const record = vi.fn(() => Effect.void);
    const dispatchedCommands: OrchestrationCommand[] = [];

    try {
      await fs.writeFile(
        path.join(projectCwd, "package.json"),
        JSON.stringify(
          {
            packageManager: "bun@1.3.9",
            scripts: {
              dev: "vite",
            },
            devDependencies: {
              vite: "^7.0.0",
            },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(path.join(projectCwd, ".env.local"), "PORT=3000\n");
      await initGitRepo(projectCwd);

      const analysis = await computeReadinessAnalysis({
        projectCwd,
        profile: null,
      });
      if (analysis.recommendation.devCommand === null) {
        throw new Error("Expected a dev command recommendation for the test fixture.");
      }

      const applicator = await Effect.runPromise(
        Effect.service(WorktreeReadinessApplicator).pipe(
          Effect.provide(
            WorktreeReadinessApplicatorLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () => Effect.succeed(makeReadModel({ workspaceRoot: projectCwd })),
                  readEvents: () => Stream.empty,
                  dispatch: (command) =>
                    Effect.sync(() => {
                      dispatchedCommands.push(command);
                      return { sequence: dispatchedCommands.length };
                    }),
                  streamDomainEvents: Stream.empty,
                }),
              ),
              Layer.provideMerge(
                Layer.succeed(AnalyticsService, {
                  record,
                  flush: Effect.void,
                }),
              ),
            ),
          ),
        ),
      );

      const result = await Effect.runPromise(
        applicator.apply({
          projectId: ProjectId.make("project-1"),
          projectCwd,
          scanFingerprint: analysis.scanFingerprint,
          installCommand: analysis.recommendation.installCommand,
          devCommand: analysis.recommendation.devCommand,
          envStrategy: analysis.recommendation.envStrategy,
          envSourcePath: analysis.recommendation.envSourcePath,
          portCount: analysis.recommendation.portCount,
          overwriteManagedFiles: false,
        }),
      );

      expect(result.profile.status).toBe("configured");
      expect(result.writtenFiles).toEqual(
        expect.arrayContaining([".t3code/worktree/setup.sh", ".t3code/worktree/dev.sh"]),
      );
      expect(result.warnings).toEqual([]);
      await expect(fs.readFile(path.join(projectCwd, ".gitignore"), "utf8")).resolves.toContain(
        ".t3code/worktree.local.env",
      );
      expect(dispatchedCommands.at(-1)?.type).toBe("project.meta.update");
      expect(record).toHaveBeenCalledWith(
        "project.worktree_readiness.applied",
        expect.objectContaining({
          packageManager: "bun",
          framework: "vite",
          envStrategy: "symlink_root",
          overwriteManagedFiles: false,
          writtenFileCount: 2,
        }),
      );
    } finally {
      await fs.rm(projectCwd, { recursive: true, force: true });
    }
  });

  it("records a telemetry failure event when apply fails", async () => {
    const record = vi.fn(() => Effect.void);
    const applicator = await Effect.runPromise(
      Effect.service(WorktreeReadinessApplicator).pipe(
        Effect.provide(
          WorktreeReadinessApplicatorLive.pipe(
            Layer.provideMerge(
              Layer.succeed(OrchestrationEngineService, {
                getReadModel: () =>
                  Effect.succeed(makeReadModel({ id: ProjectId.make("different-project") })),
                readEvents: () => Stream.empty,
                dispatch: () => Effect.die(new Error("unused")),
                streamDomainEvents: Stream.empty,
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(AnalyticsService, {
                record,
                flush: Effect.void,
              }),
            ),
          ),
        ),
      ),
    );

    await expect(
      Effect.runPromise(
        applicator.apply({
          projectId: ProjectId.make("project-1"),
          projectCwd: "/repo/project",
          scanFingerprint: "scan-fingerprint",
          installCommand: "bun install",
          devCommand: "bun run dev",
          envStrategy: "none",
          envSourcePath: null,
          portCount: 5,
          overwriteManagedFiles: false,
        }),
      ),
    ).rejects.toThrow("Project project-1 was not found.");

    expect(record).toHaveBeenCalledWith("project.worktree_readiness.apply_failed", {
      overwriteManagedFiles: false,
      envStrategy: "none",
      portCount: 5,
      failureKind: "project_not_found",
    });
  });

  it("records a telemetry failure when git tracked-status check cannot run", async () => {
    const projectCwd = await fs.mkdtemp(path.join(os.tmpdir(), "t3-readiness-apply-non-git-"));
    const record = vi.fn(() => Effect.void);

    try {
      await fs.writeFile(
        path.join(projectCwd, "package.json"),
        JSON.stringify(
          {
            packageManager: "bun@1.3.9",
            scripts: {
              dev: "vite",
            },
            devDependencies: {
              vite: "^7.0.0",
            },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(path.join(projectCwd, ".env.local"), "PORT=3000\n");

      const analysis = await computeReadinessAnalysis({
        projectCwd,
        profile: null,
      });
      if (analysis.recommendation.devCommand === null) {
        throw new Error("Expected a dev command recommendation for the test fixture.");
      }

      const applicator = await Effect.runPromise(
        Effect.service(WorktreeReadinessApplicator).pipe(
          Effect.provide(
            WorktreeReadinessApplicatorLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () => Effect.succeed(makeReadModel({ workspaceRoot: projectCwd })),
                  readEvents: () => Stream.empty,
                  dispatch: () => Effect.succeed({ sequence: 1 }),
                  streamDomainEvents: Stream.empty,
                }),
              ),
              Layer.provideMerge(
                Layer.succeed(AnalyticsService, {
                  record,
                  flush: Effect.void,
                }),
              ),
            ),
          ),
        ),
      );

      await expect(
        Effect.runPromise(
          applicator.apply({
            projectId: ProjectId.make("project-1"),
            projectCwd,
            scanFingerprint: analysis.scanFingerprint,
            installCommand: analysis.recommendation.installCommand,
            devCommand: analysis.recommendation.devCommand,
            envStrategy: analysis.recommendation.envStrategy,
            envSourcePath: analysis.recommendation.envSourcePath,
            portCount: analysis.recommendation.portCount,
            overwriteManagedFiles: false,
          }),
        ),
      ).rejects.toThrow(
        `Failed to determine whether .t3code/worktree.local.env is tracked by git in ${projectCwd}.`,
      );

      expect(record).toHaveBeenCalledWith("project.worktree_readiness.apply_failed", {
        overwriteManagedFiles: false,
        envStrategy: analysis.recommendation.envStrategy,
        portCount: analysis.recommendation.portCount,
        failureKind: "git_tracking_check_failed",
      });
    } finally {
      await fs.rm(projectCwd, { recursive: true, force: true });
    }
  });

  it("requires overwrite confirmation when a managed helper has drifted", async () => {
    const projectCwd = await fs.mkdtemp(path.join(os.tmpdir(), "t3-readiness-apply-drift-"));
    const record = vi.fn(() => Effect.void);

    try {
      await fs.writeFile(
        path.join(projectCwd, "package.json"),
        JSON.stringify(
          {
            packageManager: "bun@1.3.9",
            scripts: {
              dev: "vite",
            },
            devDependencies: {
              vite: "^7.0.0",
            },
          },
          null,
          2,
        ),
      );

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
      const setupPath = path.join(projectCwd, setupFile[0]);
      await fs.mkdir(path.dirname(setupPath), { recursive: true });
      await fs.writeFile(setupPath, "#!/usr/bin/env zsh\necho drift\n", "utf8");
      const analysis = await computeReadinessAnalysis({
        projectCwd,
        profile: null,
      });
      if (analysis.recommendation.devCommand === null) {
        throw new Error("Expected a dev command recommendation for the test fixture.");
      }

      const applicator = await Effect.runPromise(
        Effect.service(WorktreeReadinessApplicator).pipe(
          Effect.provide(
            WorktreeReadinessApplicatorLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () => Effect.succeed(makeReadModel({ workspaceRoot: projectCwd })),
                  readEvents: () => Stream.empty,
                  dispatch: () => Effect.die(new Error("unused")),
                  streamDomainEvents: Stream.empty,
                }),
              ),
              Layer.provideMerge(
                Layer.succeed(AnalyticsService, {
                  record,
                  flush: Effect.void,
                }),
              ),
            ),
          ),
        ),
      );

      await expect(
        Effect.runPromise(
          applicator.apply({
            projectId: ProjectId.make("project-1"),
            projectCwd,
            scanFingerprint: analysis.scanFingerprint,
            installCommand: analysis.recommendation.installCommand,
            devCommand: analysis.recommendation.devCommand,
            envStrategy: analysis.recommendation.envStrategy,
            envSourcePath: analysis.recommendation.envSourcePath,
            portCount: analysis.recommendation.portCount,
            overwriteManagedFiles: false,
          }),
        ),
      ).rejects.toThrow(
        "Worktree helper already exists and requires overwrite confirmation: .t3code/worktree/setup.sh",
      );
    } finally {
      await fs.rm(projectCwd, { recursive: true, force: true });
    }
  });

  it("overwrites drifted managed helpers when overwriteManagedFiles is true", async () => {
    const projectCwd = await fs.mkdtemp(path.join(os.tmpdir(), "t3-readiness-apply-overwrite-"));
    const record = vi.fn(() => Effect.void);
    const dispatchedCommands: OrchestrationCommand[] = [];

    try {
      await initGitRepo(projectCwd);
      await fs.writeFile(
        path.join(projectCwd, "package.json"),
        JSON.stringify(
          {
            packageManager: "bun@1.3.9",
            scripts: {
              dev: "vite",
            },
            devDependencies: {
              vite: "^7.0.0",
            },
          },
          null,
          2,
        ),
      );

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
      const setupPath = path.join(projectCwd, setupFile[0]);
      await fs.mkdir(path.dirname(setupPath), { recursive: true });
      await fs.writeFile(
        setupPath,
        "#!/usr/bin/env zsh\n# T3 Code managed file. Reapply Worktree Readiness to regenerate this file.\necho drift\n",
        "utf8",
      );
      const analysis = await computeReadinessAnalysis({
        projectCwd,
        profile: null,
      });
      if (analysis.recommendation.devCommand === null) {
        throw new Error("Expected a dev command recommendation for the test fixture.");
      }

      const applicator = await Effect.runPromise(
        Effect.service(WorktreeReadinessApplicator).pipe(
          Effect.provide(
            WorktreeReadinessApplicatorLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () => Effect.succeed(makeReadModel({ workspaceRoot: projectCwd })),
                  readEvents: () => Stream.empty,
                  dispatch: (command) =>
                    Effect.sync(() => {
                      dispatchedCommands.push(command);
                      return { sequence: dispatchedCommands.length };
                    }),
                  streamDomainEvents: Stream.empty,
                }),
              ),
              Layer.provideMerge(
                Layer.succeed(AnalyticsService, {
                  record,
                  flush: Effect.void,
                }),
              ),
            ),
          ),
        ),
      );

      const result = await Effect.runPromise(
        applicator.apply({
          projectId: ProjectId.make("project-1"),
          projectCwd,
          scanFingerprint: analysis.scanFingerprint,
          installCommand: analysis.recommendation.installCommand,
          devCommand: analysis.recommendation.devCommand,
          envStrategy: analysis.recommendation.envStrategy,
          envSourcePath: analysis.recommendation.envSourcePath,
          portCount: analysis.recommendation.portCount,
          overwriteManagedFiles: true,
        }),
      );

      expect(result.writtenFiles).toContain(".t3code/worktree/setup.sh");
      await expect(fs.readFile(setupPath, "utf8")).resolves.toContain("bun install");
      expect(dispatchedCommands.at(-1)?.type).toBe("project.meta.update");
    } finally {
      await fs.rm(projectCwd, { recursive: true, force: true });
    }
  });

  it("returns a warning when the worktree runtime env file is already tracked by git", async () => {
    const projectCwd = await fs.mkdtemp(path.join(os.tmpdir(), "t3-readiness-apply-tracked-env-"));
    const record = vi.fn(() => Effect.void);

    try {
      await execFileAsync("git", ["init"], { cwd: projectCwd });
      await fs.writeFile(
        path.join(projectCwd, "package.json"),
        JSON.stringify(
          {
            packageManager: "bun@1.3.9",
            scripts: {
              dev: "vite",
            },
            devDependencies: {
              vite: "^7.0.0",
            },
          },
          null,
          2,
        ),
      );
      await fs.mkdir(path.join(projectCwd, ".t3code"), { recursive: true });
      await fs.writeFile(
        path.join(projectCwd, ".t3code", "worktree.local.env"),
        "T3CODE_PRIMARY_PORT=47805\n",
      );
      await execFileAsync("git", ["add", ".t3code/worktree.local.env"], { cwd: projectCwd });

      const analysis = await computeReadinessAnalysis({
        projectCwd,
        profile: null,
      });
      if (analysis.recommendation.devCommand === null) {
        throw new Error("Expected a dev command recommendation for the test fixture.");
      }

      const applicator = await Effect.runPromise(
        Effect.service(WorktreeReadinessApplicator).pipe(
          Effect.provide(
            WorktreeReadinessApplicatorLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () => Effect.succeed(makeReadModel({ workspaceRoot: projectCwd })),
                  readEvents: () => Stream.empty,
                  dispatch: () => Effect.succeed({ sequence: 1 }),
                  streamDomainEvents: Stream.empty,
                }),
              ),
              Layer.provideMerge(
                Layer.succeed(AnalyticsService, {
                  record,
                  flush: Effect.void,
                }),
              ),
            ),
          ),
        ),
      );

      const result = await Effect.runPromise(
        applicator.apply({
          projectId: ProjectId.make("project-1"),
          projectCwd,
          scanFingerprint: analysis.scanFingerprint,
          installCommand: analysis.recommendation.installCommand,
          devCommand: analysis.recommendation.devCommand,
          envStrategy: analysis.recommendation.envStrategy,
          envSourcePath: analysis.recommendation.envSourcePath,
          portCount: analysis.recommendation.portCount,
          overwriteManagedFiles: false,
        }),
      );

      expect(result.warnings).toEqual([
        expect.objectContaining({
          id: "tracked-worktree-runtime-env",
          severity: "warning",
        }),
      ]);
      expect(record).toHaveBeenCalledWith(
        "project.worktree_readiness.applied",
        expect.objectContaining({
          warningCount: 1,
        }),
      );
    } finally {
      await fs.rm(projectCwd, { recursive: true, force: true });
    }
  });
});
