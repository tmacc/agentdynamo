import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ProjectGetIntelligenceInput,
  ProjectGetIntelligenceResult,
  ProjectIntelligenceSurfaceKind,
  ProjectReadIntelligenceSurfaceInput,
  ProjectReadIntelligenceSurfaceResult,
} from "./project.ts";

const decodeGetResult = Schema.decodeUnknownSync(ProjectGetIntelligenceResult);
const decodeGetInput = Schema.decodeUnknownSync(ProjectGetIntelligenceInput);
const decodeReadInput = Schema.decodeUnknownSync(ProjectReadIntelligenceSurfaceInput);
const decodeReadResult = Schema.decodeUnknownSync(ProjectReadIntelligenceSurfaceResult);

const allSurfaceKinds = ProjectIntelligenceSurfaceKind.literals;

describe("Project Intelligence schemas", () => {
  it("decodes a full result with every surface kind", () => {
    const parsed = decodeGetResult({
      resolvedAt: "2026-04-25T00:00:00.000Z",
      viewMode: "thread",
      projectCwd: "/repo",
      effectiveCwd: "/repo-worktree",
      surfaces: allSurfaceKinds.map((kind, index) => ({
        id: `intel:${kind}`,
        owner: index % 2 === 0 ? "shared" : "codex",
        provider: index % 2 === 0 ? undefined : "codex",
        kind,
        label: `${kind} surface`,
        path: `virtual://${kind}`,
        openPath: index === 0 ? "/repo/AGENTS.md" : undefined,
        scope: index % 2 === 0 ? "project" : "provider-runtime",
        activation: index % 2 === 0 ? "always-loaded" : "runtime-config",
        enabled: true,
        health: "ok",
        description: "A discovered surface.",
        triggerLabel: "trigger",
        sourceLabel: "source",
        excerpt: "preview",
        lineCount: 1,
        approxTokenCount: 3,
        metadata: [{ label: "Kind", value: kind }],
      })),
      providers: [
        {
          provider: "codex",
          enabled: true,
          installed: true,
          status: "ready",
          auth: { status: "authenticated", type: "api-key", label: "Codex" },
          version: "1.0.0",
          message: "Ready",
          modelCount: 2,
          skillCount: 1,
          slashCommandCount: 1,
          supportsCoordinatorTools: true,
          supportsWorker: true,
          health: "ok",
        },
      ],
      codeStats: {
        basis: "authored-source-cross-stack-v1",
        fileCount: 1,
        loc: 10,
        approxTokenCount: 20,
        partial: false,
      },
      warnings: [
        {
          id: "warning-1",
          severity: "warning",
          message: "A warning",
          surfaceId: "intel:instruction",
          provider: "codex",
          path: "/repo/AGENTS.md",
        },
      ],
    });

    expect(parsed.surfaces.map((surface) => surface.kind)).toEqual(allSurfaceKinds);
    expect(parsed.providers[0]?.provider).toBe("codex");
    expect(parsed.codeStats?.loc).toBe(10);
  });

  it("defaults optional metadata and warnings arrays", () => {
    const parsed = decodeGetResult({
      resolvedAt: "2026-04-25T00:00:00.000Z",
      viewMode: "project",
      projectCwd: "/repo",
      surfaces: [
        {
          id: "intel:surface",
          owner: "dynamo",
          kind: "runtime-config",
          label: "Runtime",
          path: "dynamo://runtime",
          scope: "project",
          activation: "runtime-config",
          enabled: true,
          health: "info",
        },
      ],
      providers: [],
    });

    expect(parsed.surfaces[0]?.metadata).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it("rejects empty roots and surface IDs", () => {
    expect(() =>
      decodeGetInput({
        projectCwd: " ",
        viewMode: "project",
      }),
    ).toThrow();

    expect(() =>
      decodeReadInput({
        projectCwd: "/repo",
        viewMode: "project",
        surfaceId: "",
      }),
    ).toThrow();
  });

  it("decodes surface readback results", () => {
    const parsed = decodeReadResult({
      surfaceId: "intel:surface",
      contentType: "markdown",
      content: "# Surface",
      truncated: false,
      maxBytes: 65536,
    });

    expect(parsed.contentType).toBe("markdown");
  });
});
