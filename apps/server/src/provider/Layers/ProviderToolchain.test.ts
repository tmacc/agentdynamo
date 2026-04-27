import { describe, expect, it } from "vitest";

import { parseNpmLatestVersion, resolveProviderToolchainCommand } from "./ProviderToolchain.ts";

describe("ProviderToolchain helpers", () => {
  it("parses latest npm registry versions", () => {
    expect(parseNpmLatestVersion({ version: "1.2.3" })).toBe("1.2.3");
    expect(parseNpmLatestVersion({ version: " 2.0.0 " })).toBe("2.0.0");
    expect(parseNpmLatestVersion({ name: "@openai/codex" })).toBeNull();
  });

  it("resolves Codex self-updater commands", () => {
    expect(resolveProviderToolchainCommand({ provider: "codex", binaryPath: "codex" })).toEqual({
      command: "codex",
      args: ["--upgrade"],
      method: {
        kind: "self-updater",
        label: "Codex self-updater",
        displayCommand: "codex --upgrade",
        canRunInDynamo: true,
      },
      manualCommand: "npm i -g @openai/codex@latest",
    });
  });

  it("resolves Claude self-updater commands", () => {
    expect(
      resolveProviderToolchainCommand({ provider: "claudeAgent", binaryPath: "/opt/bin/claude" }),
    ).toEqual({
      command: "/opt/bin/claude",
      args: ["update"],
      method: {
        kind: "self-updater",
        label: "Claude self-updater",
        displayCommand: "/opt/bin/claude update",
        canRunInDynamo: true,
      },
      manualCommand: "claude update",
    });
  });
});
