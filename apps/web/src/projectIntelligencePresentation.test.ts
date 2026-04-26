import type {
  ProjectIntelligenceProviderSummary,
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceSurfaceSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  applySurfaceFilter,
  getProviderLabel,
  groupSurfacesBySection,
  sortProvidersByHealth,
  sortSurfacesByHealth,
  summarizeOverview,
} from "./projectIntelligencePresentation";

function surface(
  id: string,
  overrides: Partial<ProjectIntelligenceSurfaceSummary>,
): ProjectIntelligenceSurfaceSummary {
  return {
    id: id as ProjectIntelligenceSurfaceId,
    owner: "shared",
    kind: "instruction",
    label: id,
    path: `/repo/${id}`,
    scope: "project",
    activation: "always-loaded",
    enabled: true,
    health: "ok",
    metadata: [],
    ...overrides,
  };
}

function provider(
  providerName: ProjectIntelligenceProviderSummary["provider"],
  overrides: Partial<ProjectIntelligenceProviderSummary> = {},
): ProjectIntelligenceProviderSummary {
  return {
    provider: providerName,
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    version: null,
    modelCount: 0,
    skillCount: 0,
    slashCommandCount: 0,
    supportsCoordinatorTools: false,
    supportsWorker: true,
    health: "ok",
    ...overrides,
  };
}

describe("projectIntelligencePresentation", () => {
  it("groups surfaces into v2 sections and summarizes counts", () => {
    const surfaces = [
      surface("instruction", { kind: "instruction" }),
      surface("skill", { kind: "skill", activation: "on-skill-match" }),
      surface("memory", { kind: "memory", activation: "separate-memory" }),
      surface("runtime", { kind: "worktree-setup", activation: "runtime-config" }),
    ];

    const grouped = groupSurfacesBySection(surfaces);
    const overview = summarizeOverview({
      surfaces,
      providers: [provider("codex")],
      warnings: [{ id: "warn", severity: "warning", message: "Warning" }],
    });

    expect(grouped.loadedContext).toHaveLength(1);
    expect(grouped.tools).toHaveLength(1);
    expect(grouped.memory).toHaveLength(1);
    expect(grouped.runtime).toHaveLength(1);
    expect(overview.totalSurfaces).toBe(4);
    expect(overview.warningCount).toBe(1);
    expect(overview.worstHealth).toBe("warning");
  });

  it("keeps provider-neutral labels and health sorting", () => {
    const sorted = sortProvidersByHealth([
      provider("cursor", { health: "ok" }),
      provider("opencode", { health: "warning" }),
      provider("claudeAgent", { health: "error" }),
    ]);

    expect(getProviderLabel("cursor")).toBe("Cursor");
    expect(getProviderLabel("opencode")).toBe("OpenCode");
    expect(sorted.map((entry) => entry.provider)).toEqual(["claudeAgent", "opencode", "cursor"]);
  });

  it("filters by provider, kind, scope, health, and search text", () => {
    const surfaces = [
      surface("codex-skill", {
        owner: "codex",
        provider: "codex",
        kind: "skill",
        scope: "user",
        activation: "on-skill-match",
        description: "Review TypeScript changes",
      }),
      surface("dynamo-runtime", {
        owner: "dynamo",
        kind: "project-script",
        scope: "project",
        activation: "runtime-config",
        health: "warning",
      }),
    ];

    expect(
      applySurfaceFilter(surfaces, {
        searchText: "typescript",
        owners: ["codex"],
        kinds: ["skill"],
        scopes: ["user"],
        healths: ["ok"],
      }).map((entry) => entry.id),
    ).toEqual(["codex-skill"]);
  });

  it("sorts unhealthy surfaces first", () => {
    const sorted = sortSurfacesByHealth([
      surface("ok", { health: "ok" }),
      surface("warning", { health: "warning" }),
      surface("error", { health: "error" }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["error", "warning", "ok"]);
  });
});
