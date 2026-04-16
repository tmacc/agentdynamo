import { describe, expect, it } from "vitest";
import { ApprovalRequestId, EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  hasPendingProviderInteraction,
} from "./pendingInteractions";

function activity(
  kind: string,
  createdAt: string,
  payload: Record<string, unknown>,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`${kind}-${createdAt}`),
    tone: kind.includes("failed") ? "error" : kind.includes("approval") ? "approval" : "info",
    kind,
    summary: kind,
    payload,
    turnId: null,
    createdAt,
  };
}

describe("derivePendingApprovals", () => {
  it("tracks unresolved approval requests", () => {
    const activities: OrchestrationThreadActivity[] = [
      activity("approval.requested", "2026-04-01T00:00:01.000Z", {
        requestId: "req-1",
        requestKind: "command",
        detail: "Run npm install",
      }),
      activity("approval.requested", "2026-04-01T00:00:02.000Z", {
        requestId: "req-2",
        requestType: "file_read_approval",
      }),
      activity("approval.resolved", "2026-04-01T00:00:03.000Z", {
        requestId: "req-1",
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: ApprovalRequestId.make("req-2"),
        requestKind: "file-read",
        createdAt: "2026-04-01T00:00:02.000Z",
      },
    ]);
  });

  it("clears stale failed approval requests", () => {
    const activities: OrchestrationThreadActivity[] = [
      activity("approval.requested", "2026-04-01T00:00:01.000Z", {
        requestId: "req-1",
        requestKind: "command",
      }),
      activity("provider.approval.respond.failed", "2026-04-01T00:00:02.000Z", {
        requestId: "req-1",
        detail: "Stale pending approval request: req-1",
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });
});

describe("derivePendingUserInputs", () => {
  it("tracks unresolved user-input requests", () => {
    const activities: OrchestrationThreadActivity[] = [
      activity("user-input.requested", "2026-04-01T00:00:01.000Z", {
        requestId: "req-1",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope?",
            options: [{ label: "Small", description: "Keep it small" }],
          },
        ],
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([
      {
        requestId: ApprovalRequestId.make("req-1"),
        createdAt: "2026-04-01T00:00:01.000Z",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope?",
            options: [{ label: "Small", description: "Keep it small" }],
            multiSelect: false,
          },
        ],
      },
    ]);
  });

  it("clears stale failed user-input requests", () => {
    const activities: OrchestrationThreadActivity[] = [
      activity("user-input.requested", "2026-04-01T00:00:01.000Z", {
        requestId: "req-1",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope?",
            options: [{ label: "Small", description: "Keep it small" }],
          },
        ],
      }),
      activity("provider.user-input.respond.failed", "2026-04-01T00:00:02.000Z", {
        requestId: "req-1",
        detail: "Unknown pending user-input request",
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([]);
  });
});

describe("hasPendingProviderInteraction", () => {
  it("returns true when approvals or user-input requests are pending", () => {
    expect(
      hasPendingProviderInteraction([
        activity("approval.requested", "2026-04-01T00:00:01.000Z", {
          requestId: "req-1",
          requestKind: "command",
        }),
      ]),
    ).toBe(true);

    expect(
      hasPendingProviderInteraction([
        activity("user-input.requested", "2026-04-01T00:00:01.000Z", {
          requestId: "req-2",
          questions: [
            {
              id: "scope",
              header: "Scope",
              question: "Which scope?",
              options: [{ label: "Small", description: "Keep it small" }],
            },
          ],
        }),
      ]),
    ).toBe(true);
  });

  it("returns false when nothing is pending", () => {
    expect(hasPendingProviderInteraction([])).toBe(false);
  });
});
