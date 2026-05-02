import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveContextCompactionStats,
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
} from "./contextWindow";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });

  it("estimates compacted retained tokens from the post-compaction floor", () => {
    const stats = deriveContextCompactionStats([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 180_000,
      }),
      makeActivity("activity-2", "context-compaction", {
        state: "compacted",
      }),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 42_000,
      }),
      makeActivity("activity-4", "context-window.updated", {
        usedTokens: 61_000,
      }),
      makeActivity("activity-5", "context-compaction", {
        state: "compacted",
      }),
      makeActivity("activity-6", "context-window.updated", {
        usedTokens: 55_000,
      }),
    ]);

    expect(stats.compactionCount).toBe(2);
    expect(stats.estimatedCompactedTokens).toBe(55_000);
    expect(stats.previousEstimatedCompactedTokens).toBe(42_000);
    expect(stats.estimatedCompactedDeltaTokens).toBe(13_000);
  });
});
