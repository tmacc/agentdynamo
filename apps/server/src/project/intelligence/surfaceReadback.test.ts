import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ProjectIntelligenceSurfaceId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  PROJECT_INTELLIGENCE_SURFACE_PREVIEW_MAX_BYTES,
  readDiscoveredSurface,
} from "./surfaceReadback.ts";
import type { DiscoveredProjectIntelligenceSurface } from "./types.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dynamo-intel-readback-"));
  tempDirs.push(dir);
  return dir;
}

function surface(input: {
  id: string;
  path?: string;
  content?: string;
  kind?: DiscoveredProjectIntelligenceSurface["summary"]["kind"];
}): DiscoveredProjectIntelligenceSurface {
  const kind = input.kind ?? "instruction";
  return {
    summary: {
      id: input.id as ProjectIntelligenceSurfaceId,
      owner: "shared",
      kind,
      label: input.id,
      path: input.path ?? `virtual://${input.id}`,
      scope: "project",
      activation: "always-loaded",
      enabled: true,
      health: "ok",
      metadata: [],
    },
    readTarget: input.path
      ? { mode: "file", path: input.path, kind, contentType: kind === "settings" ? "json" : "text" }
      : { mode: "virtual", contentType: "markdown", content: input.content ?? "virtual content" },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("surfaceReadback", () => {
  it("reads discovered file and virtual surfaces", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "AGENTS.md");
    fs.writeFileSync(filePath, "file content");

    const fileResult = await readDiscoveredSurface({
      surfaces: [surface({ id: "intel:file", path: filePath })],
      surfaceId: "intel:file" as ProjectIntelligenceSurfaceId,
    });
    const virtualResult = await readDiscoveredSurface({
      surfaces: [surface({ id: "intel:virtual", content: "# Virtual" })],
      surfaceId: "intel:virtual" as ProjectIntelligenceSurfaceId,
    });

    expect(fileResult?.content).toBe("file content");
    expect(virtualResult?.content).toBe("# Virtual");
  });

  it("rejects unknown or stale surface IDs", async () => {
    const result = await readDiscoveredSurface({
      surfaces: [surface({ id: "intel:known" })],
      surfaceId: "intel:crafted" as ProjectIntelligenceSurfaceId,
    });

    expect(result).toBeNull();
  });

  it("redacts settings previews before returning content", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "settings.json");
    fs.writeFileSync(filePath, '{"api_key":"abc","env":{"DEBUG":"true","TOKEN":"secret"}}');

    const result = await readDiscoveredSurface({
      surfaces: [surface({ id: "intel:settings", path: filePath, kind: "settings" })],
      surfaceId: "intel:settings" as ProjectIntelligenceSurfaceId,
    });

    expect(result?.content).toContain('"api_key": "[redacted]"');
    expect(result?.content).toContain('"TOKEN": "[redacted]"');
    expect(result?.content).toContain('"DEBUG": "true"');
  });

  it("truncates previews at the configured cap", async () => {
    const result = await readDiscoveredSurface({
      surfaces: [
        surface({
          id: "intel:large",
          content: "x".repeat(PROJECT_INTELLIGENCE_SURFACE_PREVIEW_MAX_BYTES + 100),
        }),
      ],
      surfaceId: "intel:large" as ProjectIntelligenceSurfaceId,
    });

    expect(result?.truncated).toBe(true);
    expect(Buffer.byteLength(result?.content ?? "", "utf8")).toBe(
      PROJECT_INTELLIGENCE_SURFACE_PREVIEW_MAX_BYTES,
    );
    expect(result?.warning).toContain("truncated");
  });
});
