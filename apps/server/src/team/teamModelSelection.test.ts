import { describe, expect, it } from "vitest";
import type {
  OrchestrationProject,
  OrchestrationThread,
  ServerProvider,
  ServerSettings,
} from "@t3tools/contracts";

import { selectTeamWorkerModel, TeamModelSelectionError } from "./teamModelSelection.ts";

const baseSettings = {
  teamAgents: {
    enabled: true,
    maxActiveChildren: 3,
    coordinatorToolsOnTopLevelThreads: true,
  },
} as ServerSettings;

const baseThread = {
  modelSelection: { provider: "codex", model: "gpt-5.4" },
} as OrchestrationThread;

const baseProject = {
  defaultModelSelection: { provider: "codex", model: "gpt-5.4" },
} as OrchestrationProject;

function provider(input: {
  readonly provider: ServerProvider["provider"];
  readonly models: ReadonlyArray<{ readonly slug: string; readonly name: string }>;
}): ServerProvider {
  return {
    provider: input.provider,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-24T00:00:00.000Z",
    models: input.models.map((model) => ({
      slug: model.slug,
      name: model.name,
      isCustom: false,
      capabilities: null,
    })),
    teamCapabilities: {
      supportsCoordinatorTools: input.provider === "codex" || input.provider === "claudeAgent",
      supportsWorker: true,
    },
    slashCommands: [],
    skills: [],
  };
}

describe("selectTeamWorkerModel", () => {
  it("normalizes requested provider model aliases", () => {
    const result = selectTeamWorkerModel({
      taskKind: "coding",
      requestedProvider: "claudeAgent",
      requestedModel: "opus-4.7",
      parentThread: baseThread,
      project: baseProject,
      providers: [
        provider({
          provider: "claudeAgent",
          models: [{ slug: "claude-opus-4-7", name: "Claude Opus 4.7" }],
        }),
      ],
      settings: baseSettings,
    });

    expect(result.modelSelection).toEqual({
      provider: "claudeAgent",
      model: "claude-opus-4-7",
    });
    expect(result.mode).toBe("user-specified");
    expect(result.reason).toContain("normalized to claude-opus-4-7");
  });

  it("rejects unavailable explicitly requested worker models", () => {
    expect(() =>
      selectTeamWorkerModel({
        taskKind: "coding",
        requestedProvider: "claudeAgent",
        requestedModel: "opus-4.7",
        parentThread: baseThread,
        project: baseProject,
        providers: [
          provider({
            provider: "claudeAgent",
            models: [{ slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
          }),
        ],
        settings: baseSettings,
      }),
    ).toThrow(TeamModelSelectionError);
  });
});
