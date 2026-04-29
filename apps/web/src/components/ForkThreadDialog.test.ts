import { MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildForkThreadInput, buildForkThreadModeOptions } from "./ForkThreadDialog";

const sourceThreadId = ThreadId.make("thread-source");
const sourceUserMessageId = MessageId.make("message-source-user");

describe("ForkThreadDialog helpers", () => {
  it("allows worktree forks without a branch label", () => {
    const options = buildForkThreadModeOptions(null);
    const worktreeOption = options.find((option) => option.value === "worktree");

    expect(worktreeOption).toEqual({
      value: "worktree",
      label: "Worktree",
      description: "Create a new worktree from the source checkout.",
      disabled: false,
    });
    expect(
      buildForkThreadInput({
        sourceThreadId,
        sourceUserMessageId,
        mode: "worktree",
        baseBranch: null,
      }),
    ).toEqual({
      sourceThreadId,
      sourceUserMessageId,
      mode: "worktree",
    });
  });

  it("labels and sends a worktree branch when one is available", () => {
    const options = buildForkThreadModeOptions("feature/source");
    const worktreeOption = options.find((option) => option.value === "worktree");

    expect(worktreeOption?.description).toBe("Create a new worktree from feature/source.");
    expect(
      buildForkThreadInput({
        sourceThreadId,
        sourceUserMessageId,
        mode: "worktree",
        baseBranch: "feature/source",
      }),
    ).toEqual({
      sourceThreadId,
      sourceUserMessageId,
      mode: "worktree",
      baseBranch: "feature/source",
    });
  });
});
