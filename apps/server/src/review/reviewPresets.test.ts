import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { pickReviewPreset } from "./reviewPresets.ts";

function provider(input: {
  readonly provider: "claudeAgent" | "codex";
  readonly models: ReadonlyArray<string>;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.provider),
    driver: ProviderDriverKind.make(input.provider),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-05-01T00:00:00.000Z",
    models: input.models.map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: null,
    })),
    teamCapabilities: {
      supportsCoordinatorTools: true,
      supportsWorker: true,
    },
    slashCommands: [],
    skills: [],
  };
}

describe("pickReviewPreset", () => {
  it("uses Claude for bug hunting and Codex for verification in multi-provider mode", () => {
    const preset = pickReviewPreset("multi", [
      provider({ provider: "claudeAgent", models: ["claude-opus-4-7", "claude-sonnet-4-6"] }),
      provider({ provider: "codex", models: ["gpt-5.4", "gpt-5.4-mini"] }),
    ]);

    expect(preset?.tier).toBe("multi");
    expect(preset?.steps.find((step) => step.kind === "bug-hunt")?.primary).toMatchObject({
      provider: "claudeAgent",
      model: "claude-opus-4-7",
    });
    expect(preset?.verifier).toMatchObject({
      provider: "codex",
      model: "gpt-5.4-mini",
    });
  });

  it("falls back to fresh-context sibling models for single-provider Claude", () => {
    const preset = pickReviewPreset("single-claude", [
      provider({ provider: "claudeAgent", models: ["claude-opus-4-7", "claude-sonnet-4-6"] }),
    ]);

    expect(preset?.steps.every((step) => step.primary.provider === "claudeAgent")).toBe(true);
    expect(preset?.steps.find((step) => step.kind === "bug-hunt")?.primary.model).toBe(
      "claude-opus-4-7",
    );
    expect(preset?.verifier.model).toBe("claude-sonnet-4-6");
  });

  it("falls back to Codex mini-class verifier for single-provider Codex", () => {
    const preset = pickReviewPreset("single-codex", [
      provider({ provider: "codex", models: ["gpt-5.4", "gpt-5.4-mini"] }),
    ]);

    expect(preset?.steps.every((step) => step.primary.provider === "codex")).toBe(true);
    expect(preset?.steps.find((step) => step.kind === "bug-hunt")?.primary.model).toBe("gpt-5.4");
    expect(preset?.verifier.model).toBe("gpt-5.4-mini");
  });

  it("returns null when no review provider is available", () => {
    expect(pickReviewPreset("none", [])).toBeNull();
  });
});
