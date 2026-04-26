import { describe, expect, it } from "vitest";

import {
  buildProjectIntelligenceRouteSearch,
  clearProjectIntelligenceRouteSearchParams,
  parseProjectIntelligenceRouteSearch,
  stripProjectIntelligenceRouteSearchParams,
} from "./projectIntelligenceRouteSearch";

describe("parseProjectIntelligenceRouteSearch", () => {
  it("returns empty when intel mode is missing or invalid", () => {
    expect(parseProjectIntelligenceRouteSearch({})).toEqual({});
    expect(parseProjectIntelligenceRouteSearch({ intel: "bogus" })).toEqual({});
    expect(parseProjectIntelligenceRouteSearch({ intel: "" })).toEqual({});
  });

  it("parses a project-mode entry without thread workspace", () => {
    const parsed = parseProjectIntelligenceRouteSearch({
      intel: "project",
      intelEnvironmentId: "env-1",
      intelProjectCwd: "/Users/me/Projects/foo",
      intelSection: "tools",
      intelSurfaceId: "surface:abc",
      intelEffectiveCwd: "  ",
    });

    expect(parsed).toEqual({
      intel: "project",
      intelEnvironmentId: "env-1",
      intelProjectCwd: "/Users/me/Projects/foo",
      intelSection: "tools",
      intelSurfaceId: "surface:abc",
    });
  });

  it("parses a thread-mode entry with effective workspace", () => {
    const parsed = parseProjectIntelligenceRouteSearch({
      intel: "thread",
      intelEnvironmentId: "env-1",
      intelProjectCwd: "/proj",
      intelEffectiveCwd: "/worktree",
      intelSection: "loaded-context",
    });
    expect(parsed.intel).toBe("thread");
    expect(parsed.intelEffectiveCwd).toBe("/worktree");
  });

  it("ignores unknown sections", () => {
    const parsed = parseProjectIntelligenceRouteSearch({
      intel: "project",
      intelProjectCwd: "/proj",
      intelSection: "bogus",
    });
    expect(parsed.intelSection).toBeUndefined();
  });
});

describe("stripProjectIntelligenceRouteSearchParams", () => {
  it("removes only intelligence keys", () => {
    const stripped = stripProjectIntelligenceRouteSearchParams({
      intel: "project",
      intelEnvironmentId: "env-1",
      intelProjectCwd: "/proj",
      intelEffectiveCwd: "/wt",
      intelSection: "tools",
      intelSurfaceId: "id",
      view: "board",
      diff: "1",
    } as Record<string, unknown>);
    expect(stripped).toEqual({ view: "board", diff: "1" });
  });
});

describe("clearProjectIntelligenceRouteSearchParams", () => {
  it("sets intelligence keys to undefined to fully clear them", () => {
    const cleared = clearProjectIntelligenceRouteSearchParams({
      intel: "project",
      intelEnvironmentId: "env-1",
      intelProjectCwd: "/proj",
      intelSection: "tools",
      intelSurfaceId: "id",
      keep: "me",
    } as Record<string, unknown>);
    expect(cleared.intel).toBeUndefined();
    expect(cleared.intelEnvironmentId).toBeUndefined();
    expect(cleared.intelProjectCwd).toBeUndefined();
    expect(cleared.intelEffectiveCwd).toBeUndefined();
    expect(cleared.intelSection).toBeUndefined();
    expect(cleared.intelSurfaceId).toBeUndefined();
    expect((cleared as { keep?: string }).keep).toBe("me");
  });
});

describe("buildProjectIntelligenceRouteSearch", () => {
  it("returns empty when projectCwd is missing", () => {
    expect(
      buildProjectIntelligenceRouteSearch({
        viewMode: "project",
        environmentId: "env-1" as never,
        projectCwd: "",
      }),
    ).toEqual({});
  });

  it("includes environment, effective cwd, section, and surface", () => {
    const built = buildProjectIntelligenceRouteSearch({
      viewMode: "thread",
      environmentId: "env-1" as never,
      projectCwd: "/proj",
      effectiveCwd: "/worktree",
      section: "tools",
      surfaceId: "surface-1" as never,
    });
    expect(built).toEqual({
      intel: "thread",
      intelEnvironmentId: "env-1",
      intelProjectCwd: "/proj",
      intelEffectiveCwd: "/worktree",
      intelSection: "tools",
      intelSurfaceId: "surface-1",
    });
  });

  it("omits effectiveCwd when it is whitespace", () => {
    const built = buildProjectIntelligenceRouteSearch({
      viewMode: "project",
      environmentId: null,
      projectCwd: "/proj",
      effectiveCwd: "   ",
    });
    expect(built.intelEffectiveCwd).toBeUndefined();
    expect(built.intelEnvironmentId).toBeUndefined();
  });
});
