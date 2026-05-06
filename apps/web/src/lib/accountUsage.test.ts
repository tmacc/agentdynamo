import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveLatestAccountUsageSnapshot,
  formatAccountUsagePercentage,
  formatAccountUsageStatus,
} from "./accountUsage";

function makeActivity(
  id: string,
  kind: string,
  payload: unknown,
  createdAt = "2026-05-01T16:00:00.000Z",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt,
  };
}

describe("accountUsage", () => {
  it("derives latest rate limit snapshots and defaults primary to five hour", () => {
    const snapshot = deriveLatestAccountUsageSnapshot([
      makeActivity("activity-1", "account.rate-limits.updated", {
        rateLimits: {
          rate_limit_info: {
            rateLimitType: "seven_day",
            status: "allowed",
            utilization: 0.2,
            resetsAt: 1_777_777_777,
          },
        },
      }),
      makeActivity(
        "activity-2",
        "account.rate-limits.updated",
        {
          rateLimits: {
            rate_limit_info: {
              rateLimitType: "five_hour",
              status: "allowed_warning",
              utilization: 72,
              resetsAt: 1_777_777_777_000,
            },
          },
        },
        "2026-05-01T17:00:00.000Z",
      ),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.primary.type).toBe("five_hour");
    expect(snapshot?.primary.utilizationPercentage).toBe(72);
    expect(snapshot?.limits.map((limit) => limit.type)).toEqual(["five_hour", "seven_day"]);
    expect(snapshot?.limits[1]?.utilizationPercentage).toBe(20);
  });

  it("keeps latest entry by rate limit type", () => {
    const snapshot = deriveLatestAccountUsageSnapshot([
      makeActivity("activity-1", "account.rate-limits.updated", {
        rate_limit_info: {
          rateLimitType: "five_hour",
          status: "allowed",
          utilization: 10,
        },
      }),
      makeActivity("activity-2", "account.rate-limits.updated", {
        rate_limit_info: {
          rateLimitType: "five_hour",
          status: "allowed",
          utilization: 25,
        },
      }),
    ]);

    expect(snapshot?.primary.utilizationPercentage).toBe(25);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestAccountUsageSnapshot([
      makeActivity("activity-1", "account.rate-limits.updated", {
        rateLimits: {},
      }),
    ]);

    expect(snapshot).toBeNull();
  });

  it("formats usage percentages and overage status", () => {
    expect(formatAccountUsagePercentage(2.5)).toBe("2.5%");
    expect(formatAccountUsagePercentage(15.2)).toBe("15%");

    const snapshot = deriveLatestAccountUsageSnapshot([
      makeActivity("activity-1", "account.rate-limits.updated", {
        rate_limit_info: {
          rateLimitType: "overage",
          status: "allowed",
          utilization: 0,
          overageDisabledReason: "out_of_credits",
        },
      }),
    ]);

    expect(snapshot?.primary.type).toBe("overage");
    expect(snapshot?.primary ? formatAccountUsageStatus(snapshot.primary) : null).toBe(
      "not enabled",
    );
  });

  it("does not rescale percentages captured from the Claude CLI usage screen", () => {
    const snapshot = deriveLatestAccountUsageSnapshot([
      makeActivity("activity-cli-capture", "account.rate-limits.updated", {
        rateLimits: {
          source: "claude-cli-tui-capture",
          rate_limit_info: {
            rateLimitType: "five_hour",
            status: "allowed",
            utilization: 1,
          },
        },
      }),
    ]);

    expect(snapshot?.primary.utilizationPercentage).toBe(1);
    expect(formatAccountUsagePercentage(snapshot?.primary.utilizationPercentage ?? null)).toBe(
      "1%",
    );
  });

  it("derives Codex five-hour and weekly usage from app-server rate limit payloads", () => {
    const snapshot = deriveLatestAccountUsageSnapshot([
      makeActivity("activity-codex", "account.rate-limits.updated", {
        rateLimits: {
          rateLimits: {
            limitId: "codex",
            planType: "pro",
            primary: {
              resetsAt: 1_778_086_861,
              usedPercent: 38,
              windowDurationMins: 300,
            },
            secondary: {
              resetsAt: 1_778_591_685,
              usedPercent: 12,
              windowDurationMins: 10_080,
            },
          },
        },
      }),
    ]);

    expect(snapshot?.primary.type).toBe("five_hour");
    expect(snapshot?.primary.utilizationPercentage).toBe(38);
    expect(snapshot?.limits.map((limit) => [limit.type, limit.utilizationPercentage])).toEqual([
      ["five_hour", 38],
      ["seven_day", 12],
    ]);
  });

  it("filters snapshots by provider so picker changes swap displayed account bars", () => {
    const activities = [
      makeActivity("activity-claude", "account.rate-limits.updated", {
        rateLimits: {
          source: "claude-cli-tui-capture",
          rate_limit_info: {
            rateLimitType: "five_hour",
            status: "allowed",
            utilization: 2,
          },
        },
      }),
      makeActivity(
        "activity-codex",
        "account.rate-limits.updated",
        {
          rateLimits: {
            rateLimits: {
              primary: { usedPercent: 40 },
              secondary: { usedPercent: 15 },
            },
          },
        },
        "2026-05-01T17:00:00.000Z",
      ),
    ];

    expect(
      deriveLatestAccountUsageSnapshot(activities, { provider: "claudeAgent" })?.primary
        .utilizationPercentage,
    ).toBe(2);
    expect(
      deriveLatestAccountUsageSnapshot(activities, { provider: "codex" })?.primary
        .utilizationPercentage,
    ).toBe(40);
    expect(deriveLatestAccountUsageSnapshot(activities, { provider: "cursor" })).toBeNull();
  });

  it("ignores status-only updates when utilization data already exists", () => {
    const snapshot = deriveLatestAccountUsageSnapshot([
      makeActivity(
        "activity-api",
        "account.rate-limits.updated",
        {
          rate_limit_info: {
            rateLimitType: "five_hour",
            status: "allowed",
            utilization: 30,
            resetsAt: 1_777_777_777_000,
          },
        },
        "2026-05-01T16:00:00.000Z",
      ),
      makeActivity(
        "activity-sdk-status-only",
        "account.rate-limits.updated",
        {
          rate_limit_info: {
            rateLimitType: "five_hour",
            status: "allowed",
            // No utilization (Claude SDK omits it for low usage)
          },
        },
        "2026-05-01T17:00:00.000Z",
      ),
    ]);

    expect(snapshot?.primary.utilizationPercentage).toBe(30);
  });

  it("excludes limits without utilization from the rendered meter", () => {
    const snapshot = deriveLatestAccountUsageSnapshot([
      makeActivity("activity-status-only", "account.rate-limits.updated", {
        rate_limit_info: {
          rateLimitType: "seven_day",
          status: "allowed",
        },
      }),
      makeActivity("activity-with-utilization", "account.rate-limits.updated", {
        rate_limit_info: {
          rateLimitType: "five_hour",
          status: "allowed",
          utilization: 12,
        },
      }),
    ]);

    expect(snapshot?.limits.map((limit) => limit.type)).toEqual(["five_hour"]);
  });
});
