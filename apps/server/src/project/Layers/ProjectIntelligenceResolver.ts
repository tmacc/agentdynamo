import * as OS from "node:os";
import path from "node:path";

import type {
  ProjectGetIntelligenceInput,
  ProjectGetIntelligenceResult,
  ProjectIntelligenceSurfaceSummary,
  ProjectIntelligenceWarning,
  ProjectReadIntelligenceSurfaceResult,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { WorkspacePaths } from "../../workspace/Services/WorkspacePaths.ts";
import { collectProjectCodeStats } from "../intelligence/codeStats.ts";
import {
  applySurfaceOverrides,
  readProjectContextOverrides,
  setSurfaceEnabledOverride,
} from "../intelligence/projectContextOverrides.ts";
import { discoverProviderSurfaces, summarizeProviders } from "../intelligence/providerDiscovery.ts";
import { discoverProjectSurfaces } from "../intelligence/surfaceDiscovery.ts";
import { readDiscoveredSurface } from "../intelligence/surfaceReadback.ts";
import type { DiscoveredProjectIntelligenceSurface } from "../intelligence/types.ts";
import {
  ProjectIntelligenceResolver,
  ProjectIntelligenceResolverError,
  type ProjectIntelligenceResolverShape,
} from "../Services/ProjectIntelligenceResolver.ts";

const CACHE_TTL_MS = 30_000;

interface CachedIntelligence {
  readonly result: ProjectGetIntelligenceResult;
  readonly cachedAt: number;
}

interface CollectedIntelligence {
  readonly result: ProjectGetIntelligenceResult;
  readonly discoveredSurfaces: ReadonlyArray<DiscoveredProjectIntelligenceSurface>;
}

function toResolverError(
  operation: string,
  detail: string,
  cause?: unknown,
): ProjectIntelligenceResolverError {
  return new ProjectIntelligenceResolverError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function cacheKey(input: {
  readonly projectCwd: string;
  readonly effectiveCwd?: string;
  readonly viewMode: string;
}): string {
  return [input.viewMode, input.projectCwd, input.effectiveCwd ?? ""].join("\0");
}

function sortSurfaces(
  left: ProjectIntelligenceSurfaceSummary,
  right: ProjectIntelligenceSurfaceSummary,
): number {
  const healthRank = { error: 0, warning: 1, info: 2, ok: 3 } as const;
  return (
    healthRank[left.health] - healthRank[right.health] ||
    left.scope.localeCompare(right.scope) ||
    left.owner.localeCompare(right.owner) ||
    left.kind.localeCompare(right.kind) ||
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
  );
}

function dedupeSurfaces(
  surfaces: ReadonlyArray<DiscoveredProjectIntelligenceSurface>,
): ReadonlyArray<DiscoveredProjectIntelligenceSurface> {
  const byId = new Map<string, DiscoveredProjectIntelligenceSurface>();
  for (const surface of surfaces) {
    if (!byId.has(surface.summary.id)) {
      byId.set(surface.summary.id, surface);
    }
  }
  return [...byId.values()];
}

export const makeProjectIntelligenceResolver = Effect.gen(function* () {
  const workspacePaths = yield* WorkspacePaths;
  const git = yield* GitCore;
  const providerRegistry = yield* ProviderRegistry;
  const serverSettings = yield* ServerSettingsService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const runtimeContext = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(runtimeContext);
  const cache = new Map<string, CachedIntelligence>();

  const normalizeRoots = async (
    input: ProjectGetIntelligenceInput,
  ): Promise<{
    readonly projectCwd: string;
    readonly effectiveCwd?: string;
    readonly warnings: ProjectIntelligenceWarning[];
  }> => {
    const warnings: ProjectIntelligenceWarning[] = [];
    const projectCwd = await runPromise(workspacePaths.normalizeWorkspaceRoot(input.projectCwd));
    const requestedEffectiveCwd =
      input.viewMode === "thread" && input.effectiveCwd && input.effectiveCwd.trim().length > 0
        ? input.effectiveCwd
        : undefined;

    if (!requestedEffectiveCwd) {
      return { projectCwd, warnings };
    }

    try {
      const effectiveCwd = await runPromise(
        workspacePaths.normalizeWorkspaceRoot(requestedEffectiveCwd),
      );
      return { projectCwd, effectiveCwd, warnings };
    } catch {
      warnings.push({
        id: `effective-root:${requestedEffectiveCwd}`,
        severity: "warning",
        message: "Thread workspace is unavailable. Showing base project context.",
        path: requestedEffectiveCwd,
      });
      return { projectCwd, warnings };
    }
  };

  const collect = async (
    input: ProjectGetIntelligenceInput,
    options: { readonly useCache: boolean },
  ): Promise<CollectedIntelligence> => {
    const normalized = await normalizeRoots(input);
    const key = cacheKey({
      projectCwd: normalized.projectCwd,
      ...(normalized.effectiveCwd ? { effectiveCwd: normalized.effectiveCwd } : {}),
      viewMode: input.viewMode,
    });
    const now = Date.now();
    const cached = cache.get(key);
    if (options.useCache && !input.refresh && cached && now - cached.cachedAt < CACHE_TTL_MS) {
      return {
        result: cached.result,
        discoveredSurfaces: [],
      };
    }

    const settings = await runPromise(serverSettings.getSettings);
    const configuredCodexHome = settings.providers.codex.homePath.trim();
    const codexHome = path.resolve(
      configuredCodexHome.length > 0
        ? configuredCodexHome
        : process.env.CODEX_HOME || path.join(OS.homedir(), ".codex"),
    );

    const readModel = await runPromise(orchestrationEngine.getReadModel());
    const project =
      (input.projectId
        ? readModel.projects.find((candidate) => candidate.id === input.projectId)
        : null) ??
      readModel.projects.find((candidate) => candidate.workspaceRoot === normalized.projectCwd) ??
      null;

    const warnings = [...normalized.warnings];
    const providers = await runPromise(providerRegistry.getProviders);
    const discoveredSurfaces = dedupeSurfaces([
      ...(await discoverProjectSurfaces({
        projectCwd: normalized.projectCwd,
        ...(normalized.effectiveCwd ? { effectiveCwd: normalized.effectiveCwd } : {}),
        codexHome,
        project,
        warnings,
      })),
      ...discoverProviderSurfaces(providers),
    ]);

    const codeStats = await collectProjectCodeStats({
      cwd: normalized.effectiveCwd ?? normalized.projectCwd,
      git,
      runPromise,
    });
    if (codeStats.partial) {
      warnings.push({
        id: `code-stats:${normalized.effectiveCwd ?? normalized.projectCwd}`,
        severity: "info",
        message: "Code stats are partial because the file set exceeded the scan limit.",
        path: normalized.effectiveCwd ?? normalized.projectCwd,
      });
    }

    const overrides = await readProjectContextOverrides(normalized.projectCwd);
    const summarizedSurfaces = applySurfaceOverrides(
      discoveredSurfaces.map((surface) => surface.summary),
      overrides,
    );

    const result: ProjectGetIntelligenceResult = {
      resolvedAt: new Date().toISOString(),
      viewMode: input.viewMode,
      projectCwd: normalized.projectCwd,
      ...(normalized.effectiveCwd ? { effectiveCwd: normalized.effectiveCwd } : {}),
      surfaces: [...summarizedSurfaces].toSorted(sortSurfaces),
      providers: summarizeProviders(providers),
      codeStats,
      warnings,
    };
    cache.set(key, {
      result,
      cachedAt: now,
    });
    return { result, discoveredSurfaces };
  };

  const getIntelligence: ProjectIntelligenceResolverShape["getIntelligence"] = (input) =>
    Effect.tryPromise({
      try: () => collect(input, { useCache: true }).then((collected) => collected.result),
      catch: (cause) =>
        Schema.is(ProjectIntelligenceResolverError)(cause)
          ? cause
          : toResolverError(
              "projectIntelligence.getIntelligence",
              "Unable to resolve project intelligence.",
              cause,
            ),
    });

  const readSurface: ProjectIntelligenceResolverShape["readSurface"] = (input) =>
    Effect.tryPromise({
      try: async (): Promise<ProjectReadIntelligenceSurfaceResult> => {
        const collected = await collect(
          {
            projectCwd: input.projectCwd,
            ...(input.effectiveCwd ? { effectiveCwd: input.effectiveCwd } : {}),
            viewMode: input.viewMode,
            refresh: true,
          },
          { useCache: false },
        );
        const result = await readDiscoveredSurface({
          surfaces: collected.discoveredSurfaces,
          surfaceId: input.surfaceId,
        });
        if (!result) {
          throw toResolverError(
            "projectIntelligence.readSurface",
            "Project intelligence surface is unavailable or no longer authorized.",
          );
        }
        return result;
      },
      catch: (cause) =>
        Schema.is(ProjectIntelligenceResolverError)(cause)
          ? cause
          : toResolverError(
              "projectIntelligence.readSurface",
              "Unable to read project intelligence surface.",
              cause,
            ),
    });

  const getSurfaceOverrides: ProjectIntelligenceResolverShape["getSurfaceOverrides"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const projectCwd = await runPromise(
          workspacePaths.normalizeWorkspaceRoot(input.projectCwd),
        );
        const enabledOverrides = await readProjectContextOverrides(projectCwd);
        return { projectCwd, enabledOverrides };
      },
      catch: (cause) =>
        Schema.is(ProjectIntelligenceResolverError)(cause)
          ? cause
          : toResolverError(
              "projectIntelligence.getSurfaceOverrides",
              "Unable to read project context overrides.",
              cause,
            ),
    });

  const setSurfaceEnabled: ProjectIntelligenceResolverShape["setSurfaceEnabled"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const projectCwd = await runPromise(
          workspacePaths.normalizeWorkspaceRoot(input.projectCwd),
        );
        const enabledOverrides = await setSurfaceEnabledOverride(
          projectCwd,
          input.surfaceId,
          input.enabled,
        );
        // Bust the cache for both view modes so the next get-intelligence
        // reflects the new override on either the project or thread surface list.
        // Snapshot keys first since we mutate the map during iteration.
        const cacheKeys = Array.from(cache.keys());
        for (const key of cacheKeys) {
          if (key.includes(projectCwd)) cache.delete(key);
        }
        return { projectCwd, enabledOverrides };
      },
      catch: (cause) =>
        Schema.is(ProjectIntelligenceResolverError)(cause)
          ? cause
          : toResolverError(
              "projectIntelligence.setSurfaceEnabled",
              "Unable to update project context override.",
              cause,
            ),
    });

  return {
    getIntelligence,
    readSurface,
    getSurfaceOverrides,
    setSurfaceEnabled,
  } satisfies ProjectIntelligenceResolverShape;
});

export const ProjectIntelligenceResolverLive = Layer.effect(
  ProjectIntelligenceResolver,
  makeProjectIntelligenceResolver,
);
