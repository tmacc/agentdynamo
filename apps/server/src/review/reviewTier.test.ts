import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { detectReviewTier } from "./reviewTier.ts";

function provider(input: {
  readonly provider: "claudeAgent" | "codex" | "cursor" | "opencode";
  readonly authStatus?: ServerProvider["auth"]["status"];
  readonly enabled?: boolean;
  readonly supportsWorker?: boolean;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.provider),
    driver: ProviderDriverKind.make(input.provider),
    enabled: input.enabled ?? true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: input.authStatus ?? "authenticated" },
    checkedAt: "2026-05-01T00:00:00.000Z",
    models: [
      {
        slug: "model",
        name: "Model",
        isCustom: false,
        capabilities: null,
      },
    ],
    teamCapabilities: {
      supportsCoordinatorTools: input.provider === "codex" || input.provider === "claudeAgent",
      supportsWorker: input.supportsWorker ?? true,
    },
    slashCommands: [],
    skills: [],
  };
}

describe("detectReviewTier", () => {
  it("detects multi-provider when Claude and Codex are authenticated workers", () => {
    expect(
      detectReviewTier([provider({ provider: "claudeAgent" }), provider({ provider: "codex" })]),
    ).toBe("multi");
  });

  it("detects single-provider Claude and Codex tiers", () => {
    expect(detectReviewTier([provider({ provider: "claudeAgent" })])).toBe("single-claude");
    expect(detectReviewTier([provider({ provider: "codex" })])).toBe("single-codex");
  });

  it("ignores unauthenticated, disabled, non-worker, and unsupported providers", () => {
    expect(
      detectReviewTier([
        provider({ provider: "claudeAgent", authStatus: "unauthenticated" }),
        provider({ provider: "codex", enabled: false }),
        provider({ provider: "opencode" }),
        provider({ provider: "cursor", supportsWorker: false }),
      ]),
    ).toBe("none");
  });
});
