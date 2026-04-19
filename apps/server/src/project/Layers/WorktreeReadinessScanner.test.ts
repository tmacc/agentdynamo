import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ProjectId, type OrchestrationReadModel } from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";
import { WorktreeReadinessScanner } from "../Services/WorktreeReadinessScanner.ts";
import { WorktreeReadinessScannerLive } from "./WorktreeReadinessScanner.ts";

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

describe("WorktreeReadinessScanner", () => {
  it("records a telemetry event when a readiness scan succeeds", async () => {
    const projectCwd = await fs.mkdtemp(path.join(os.tmpdir(), "t3-readiness-scan-"));
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

      const scanner = await Effect.runPromise(
        Effect.service(WorktreeReadinessScanner).pipe(
          Effect.provide(
            WorktreeReadinessScannerLive.pipe(
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

      const result = await Effect.runPromise(
        scanner.scan({
          projectId: ProjectId.make("project-1"),
          projectCwd,
          trigger: "thread_worktree",
        }),
      );

      expect(result.recommendation.packageManager).toBe("bun");
      expect(result.recommendation.framework).toBe("vite");
      expect(record).toHaveBeenCalledWith(
        "project.worktree_readiness.scanned",
        expect.objectContaining({
          trigger: "thread_worktree",
          configured: false,
          promptRequired: true,
          packageManager: "bun",
          framework: "vite",
          devCommandDetected: true,
          hasEnvSourcePath: true,
        }),
      );
    } finally {
      await fs.rm(projectCwd, { recursive: true, force: true });
    }
  });

  it("records a telemetry failure event when scanning fails", async () => {
    const record = vi.fn(() => Effect.void);
    const scanner = await Effect.runPromise(
      Effect.service(WorktreeReadinessScanner).pipe(
        Effect.provide(
          WorktreeReadinessScannerLive.pipe(
            Layer.provideMerge(
              Layer.succeed(OrchestrationEngineService, {
                getReadModel: () => Effect.fail(new Error("read model offline")),
                readEvents: () => Stream.empty,
                dispatch: () => Effect.die(new Error("unused")),
                streamDomainEvents: Stream.empty,
              } as never),
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
        scanner.scan({
          projectId: ProjectId.make("project-1"),
          projectCwd: "/repo/project",
          trigger: "thread_worktree",
        }),
      ),
    ).rejects.toThrow("read model offline");

    expect(record).toHaveBeenCalledWith("project.worktree_readiness.scan_failed", {
      trigger: "thread_worktree",
      hasProjectId: true,
      failureKind: "unknown",
    });
  });

  it("does not treat unchanged configured profiles as stale", async () => {
    const projectCwd = await fs.mkdtemp(path.join(os.tmpdir(), "t3-readiness-scan-stable-"));
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

      const initialScanner = await Effect.runPromise(
        Effect.service(WorktreeReadinessScanner).pipe(
          Effect.provide(
            WorktreeReadinessScannerLive.pipe(
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

      const initialResult = await Effect.runPromise(
        initialScanner.scan({
          projectId: ProjectId.make("project-1"),
          projectCwd,
          trigger: "thread_worktree",
        }),
      );

      const scannerWithProfile = await Effect.runPromise(
        Effect.service(WorktreeReadinessScanner).pipe(
          Effect.provide(
            WorktreeReadinessScannerLive.pipe(
              Layer.provideMerge(
                Layer.succeed(OrchestrationEngineService, {
                  getReadModel: () =>
                    Effect.succeed(
                      makeReadModel({
                        workspaceRoot: projectCwd,
                        worktreeReadiness: {
                          version: 1,
                          status: "configured",
                          scanFingerprint: initialResult.scanFingerprint,
                          lastScannedAt: "2026-01-01T00:00:00.000Z",
                          lastAppliedAt: "2026-01-01T00:00:00.000Z",
                          packageManager: initialResult.recommendation.packageManager,
                          framework: initialResult.recommendation.framework,
                          installCommand: initialResult.recommendation.installCommand,
                          devCommand: initialResult.recommendation.devCommand,
                          envStrategy: initialResult.recommendation.envStrategy,
                          envSourcePath: initialResult.recommendation.envSourcePath,
                          portCount: initialResult.recommendation.portCount,
                          generatedFiles: [".t3code/worktree/setup.sh", ".t3code/worktree/dev.sh"],
                          setupScriptCommand: ".t3code/worktree/setup.sh",
                          devScriptCommand: ".t3code/worktree/dev.sh",
                        },
                      }),
                    ),
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

      const rescanned = await Effect.runPromise(
        scannerWithProfile.scan({
          projectId: ProjectId.make("project-1"),
          projectCwd,
          trigger: "thread_worktree",
        }),
      );

      expect(rescanned.warnings.some((warning) => warning.id === "stale-readiness-profile")).toBe(
        false,
      );
    } finally {
      await fs.rm(projectCwd, { recursive: true, force: true });
    }
  });

  it("ignores example env files when recommending env handling", async () => {
    const projectCwd = await fs.mkdtemp(path.join(os.tmpdir(), "t3-readiness-scan-env-example-"));
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
      await fs.writeFile(path.join(projectCwd, ".env.example"), "PORT=3000\n");

      const scanner = await Effect.runPromise(
        Effect.service(WorktreeReadinessScanner).pipe(
          Effect.provide(
            WorktreeReadinessScannerLive.pipe(
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

      const result = await Effect.runPromise(
        scanner.scan({
          projectId: ProjectId.make("project-1"),
          projectCwd,
          trigger: "thread_worktree",
        }),
      );

      expect(result.recommendation.envStrategy).toBe("none");
      expect(result.recommendation.envSourcePath).toBeNull();
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "missing-env-source",
          }),
        ]),
      );
    } finally {
      await fs.rm(projectCwd, { recursive: true, force: true });
    }
  });
});
