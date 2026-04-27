import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ProviderToolchainStatus } from "./providerToolchain.ts";
import { ServerConfigStreamEvent } from "./server.ts";
import { WS_METHODS } from "./rpc.ts";

const decodeStatus = Schema.decodeUnknownSync(ProviderToolchainStatus);
const decodeServerConfigStreamEvent = Schema.decodeUnknownSync(ServerConfigStreamEvent);

describe("ProviderToolchain contracts", () => {
  it("decodes all check and update states", () => {
    for (const checkState of [
      "idle",
      "checking",
      "up-to-date",
      "update-available",
      "unknown",
      "error",
    ] as const) {
      for (const updateState of ["idle", "updating", "updated", "error"] as const) {
        expect(
          decodeStatus({
            provider: "codex",
            currentVersion: "1.0.0",
            latestVersion: "1.0.1",
            updateAvailable: true,
            checkState,
            updateState,
            method: {
              kind: "self-updater",
              label: "Codex self-updater",
              displayCommand: "codex --upgrade",
              canRunInDynamo: true,
            },
            checkedAt: "2026-04-27T00:00:00.000Z",
            updatedAt: null,
            message: "Update available.",
          }),
        ).toMatchObject({ checkState, updateState });
      }
    }
  });

  it("exposes provider toolchain RPC method names", () => {
    expect(WS_METHODS.serverGetProviderToolchains).toBe("server.getProviderToolchains");
    expect(WS_METHODS.serverCheckProviderToolchains).toBe("server.checkProviderToolchains");
    expect(WS_METHODS.serverUpdateProviderToolchain).toBe("server.updateProviderToolchain");
  });

  it("decodes provider toolchain config stream events", () => {
    const parsed = decodeServerConfigStreamEvent({
      version: 1,
      type: "providerToolchains",
      payload: {
        statuses: [
          {
            provider: "claudeAgent",
            currentVersion: "2.1.111",
            latestVersion: "2.1.112",
            updateAvailable: true,
            checkState: "update-available",
            updateState: "idle",
            method: {
              kind: "self-updater",
              label: "Claude self-updater",
              displayCommand: "claude update",
              canRunInDynamo: true,
            },
            checkedAt: "2026-04-27T00:00:00.000Z",
            updatedAt: null,
            message: "Claude 2.1.112 is available.",
          },
        ],
      },
    });

    expect(parsed.type).toBe("providerToolchains");
  });
});
