import { describe, expect, it } from "vitest";

import { buildChildPrompt, selectChildTranscriptMessages } from "./TeamOrchestrationService.ts";

describe("selectChildTranscriptMessages", () => {
  it("keeps only recent user context and excludes the duplicated latest goal", () => {
    expect(
      selectChildTranscriptMessages({
        latestGoal: "Review the current working tree",
        messages: [
          { role: "user", text: "Initial repo context" },
          { role: "assistant", text: "I'm dispatching two reviewers now." },
          { role: "user", text: "Focus on bugs and missing tests only" },
          { role: "assistant", text: "Waiting for both children." },
          { role: "user", text: "Review the current working tree" },
        ],
      }),
    ).toEqual([
      { role: "user", text: "Initial repo context" },
      { role: "user", text: "Focus on bugs and missing tests only" },
    ]);
  });
});

describe("buildChildPrompt", () => {
  it("tells child agents not to delegate and to return the deliverable directly", () => {
    const prompt = buildChildPrompt({
      parentTitle: "Current working tree review",
      latestGoal: "Review the current working tree",
      latestPlanMarkdown: "1. Spawn reviewers\n2. Wait\n3. Merge findings",
      branch: "main",
      worktreePath: "/tmp/project",
      roleLabel: "Frontend reviewer",
      contextBrief: "Review only for bugs, regressions, risks, and missing tests.",
      relevantFiles: ["apps/web/src/components/ChatView.tsx"],
      task: "Review the frontend changes. Do not make edits.",
      transcript: [{ role: "user", text: "Focus on bugs and missing tests only" }],
    });

    expect(prompt).toContain("You are a child agent working for a coordinator thread.");
    expect(prompt).toContain(
      "Do not delegate, spawn subagents, or use native collaboration tools.",
    );
    expect(prompt).toContain("Assigned role: Frontend reviewer");
    expect(prompt).toContain("Recent user context:\nUSER:\nFocus on bugs and missing tests only");
    expect(prompt).toContain("Return the requested deliverable directly.");
    expect(prompt).toContain(
      "Only include branch/worktree handoff details if you actually made code changes in your own workspace.",
    );
    expect(prompt).not.toContain("When you finish, summarize what changed");
  });
});
