import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProjectScript, type ProjectIntelligenceWarning } from "@t3tools/contracts";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { discoverProjectSurfaces } from "./surfaceDiscovery.ts";

const tempDirs: string[] = [];
const decodeProjectScript = Schema.decodeUnknownSync(ProjectScript);

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dynamo-intel-discovery-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("surfaceDiscovery", () => {
  it("discovers project instructions, provider files, settings-derived hooks, and Dynamo runtime surfaces", async () => {
    const projectCwd = makeTempDir();
    const codexHome = makeTempDir();
    const warnings: ProjectIntelligenceWarning[] = [];

    writeFile(projectCwd, "AGENTS.md", "# Shared instructions");
    writeFile(projectCwd, ".codex/skills/review/SKILL.md", "---\nname: Review\n---\nReview skill");
    writeFile(projectCwd, ".claude/agents/planner.md", "---\nname: Planner\n---\nPlan work");
    writeFile(projectCwd, ".claude/commands/ship.md", "# Ship");
    writeFile(
      projectCwd,
      ".claude/settings.json",
      JSON.stringify({ hooks: { PreToolUse: [{ command: "echo hi" }] } }),
    );

    const surfaces = await discoverProjectSurfaces({
      projectCwd,
      codexHome,
      warnings,
      project: {
        scripts: [
          decodeProjectScript({
            id: "script-1",
            name: "Dev",
            command: "bun dev",
            icon: "play",
            runOnWorktreeCreate: true,
          }),
        ],
        worktreeSetup: {
          version: 1,
          status: "configured",
          scanFingerprint: "fingerprint",
          packageManager: "bun",
          framework: "vite",
          installCommand: "bun install",
          devCommand: "bun dev",
          envStrategy: "none",
          envSourcePath: null,
          portCount: 1,
          storageMode: "dynamo-managed",
          autoRunSetupOnWorktreeCreate: true,
          createdAt: "2026-04-25T00:00:00.000Z",
          updatedAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    const byKind = new Set(surfaces.map((surface) => surface.summary.kind));
    expect(byKind.has("instruction")).toBe(true);
    expect(byKind.has("skill")).toBe(true);
    expect(byKind.has("custom-agent")).toBe(true);
    expect(byKind.has("slash-command")).toBe(true);
    expect(byKind.has("hook")).toBe(true);
    expect(byKind.has("settings")).toBe(true);
    expect(byKind.has("project-script")).toBe(true);
    expect(byKind.has("worktree-setup")).toBe(true);
  });
});
