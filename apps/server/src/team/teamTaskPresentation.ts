export function truncateTeamText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

export function latestAssistantOutputText(thread: {
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
}): string | null {
  const assistantMessage = thread.messages
    .toReversed()
    .find((message) => message.role === "assistant" && message.text.trim().length > 0);
  return assistantMessage ? assistantMessage.text.trim() : null;
}

export function latestAssistantSummary(
  thread: {
    readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  },
  limit = 600,
): string | null {
  const output = latestAssistantOutputText(thread);
  return output ? truncateTeamText(output, limit) : null;
}

export function latestDiffSummary(thread: {
  readonly checkpoints: ReadonlyArray<{
    readonly files: ReadonlyArray<{ readonly additions: number; readonly deletions: number }>;
  }>;
}): string | null {
  const checkpoint = thread.checkpoints.at(-1);
  if (!checkpoint) {
    return null;
  }
  if (checkpoint.files.length === 0) {
    return "No tracked file changes.";
  }
  const additions = checkpoint.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = checkpoint.files.reduce((sum, file) => sum + file.deletions, 0);
  return `${checkpoint.files.length} file(s), +${additions}/-${deletions}`;
}
