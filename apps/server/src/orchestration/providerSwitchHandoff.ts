import { type MessageId, type OrchestrationReadModel, type ProviderKind } from "@t3tools/contracts";
import type { ProviderThreadSyncState } from "../provider/Services/ProviderService.ts";

const DEFAULT_MAX_CHARS = 32_000;
const DEFAULT_MAX_MESSAGES = 48;

function providerLabel(provider: ProviderKind): string {
  return provider === "claudeAgent" ? "Claude" : "Codex";
}

function attachmentPlaceholders(
  message: OrchestrationReadModel["threads"][number]["messages"][number],
): string[] {
  return (message.attachments ?? []).map(
    (attachment) =>
      `[Historical image attachment: ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)]`,
  );
}

function formatMessageBlock(
  message: OrchestrationReadModel["threads"][number]["messages"][number],
): string {
  const lines = [`${message.role.toUpperCase()}:`];
  const text = message.text.trim();
  if (text.length > 0) {
    lines.push(text);
  } else if ((message.attachments?.length ?? 0) === 0) {
    lines.push("(empty message)");
  }
  lines.push(...attachmentPlaceholders(message));
  return lines.join("\n");
}

function formatCheckpointBlock(
  checkpoint: OrchestrationReadModel["threads"][number]["checkpoints"][number],
): string {
  const changedFiles =
    checkpoint.files.length > 0
      ? checkpoint.files
          .slice(0, 12)
          .map(
            (file) =>
              `${file.path} (+${file.additions ?? 0} / -${file.deletions ?? 0}, ${file.kind})`,
          )
          .join("\n")
      : "(no changed files recorded)";
  return [
    "CHECKPOINT:",
    `Turn: ${checkpoint.turnId}`,
    `Status: ${checkpoint.status}`,
    `Completed at: ${checkpoint.completedAt}`,
    "Changed files:",
    changedFiles,
  ].join("\n");
}

function buildHandoffText(input: {
  readonly thread: OrchestrationReadModel["threads"][number];
  readonly fromProvider: ProviderKind;
  readonly toProvider: ProviderKind;
  readonly mode: "full" | "delta";
  readonly messageBlocks: ReadonlyArray<string>;
  readonly checkpointBlocks: ReadonlyArray<string>;
  readonly omittedMessageCount: number;
}): string {
  const metadataLines = [
    input.mode === "delta"
      ? "Incremental provider switch catch-up for an existing thread."
      : "Provider switch handoff for an existing thread.",
    `Previous provider: ${providerLabel(input.fromProvider)}.`,
    `Target provider: ${providerLabel(input.toProvider)}.`,
    `Thread title: ${input.thread.title}.`,
    ...(input.thread.branch ? [`Branch: ${input.thread.branch}.`] : []),
    ...(input.thread.worktreePath ? [`Worktree: ${input.thread.worktreePath}.`] : []),
    "Historical transcript follows in chronological order.",
    "Answer the next user message after this handoff instead of replying to the handoff itself.",
  ];

  const transcriptLines = [
    input.mode === "delta" ? "Changes since this provider last handled the thread:" : "Transcript:",
    ...(input.omittedMessageCount > 0
      ? [
          `[Truncation note: ${input.omittedMessageCount} older historical message(s) omitted to stay within switch handoff limits.]`,
        ]
      : []),
    ...(input.messageBlocks.length > 0 ? input.messageBlocks : ["(no prior transcript)"]),
    ...(input.checkpointBlocks.length > 0 ? input.checkpointBlocks : []),
  ];

  return `${metadataLines.join("\n")}\n\n${transcriptLines.join("\n\n")}`;
}

export function buildProviderSwitchHandoff(input: {
  readonly thread: OrchestrationReadModel["threads"][number];
  readonly fromProvider: ProviderKind;
  readonly toProvider: ProviderKind;
  readonly currentMessageId: MessageId;
  readonly syncState?: ProviderThreadSyncState;
  readonly maxChars?: number;
  readonly maxMessages?: number;
}): {
  mode: "full" | "delta";
  text: string;
  includedMessageCount: number;
  includedCheckpointCount: number;
  omittedMessageCount: number;
  truncated: boolean;
  charCount: number;
  fallbackReason?:
    | "branch-mismatch"
    | "worktree-mismatch"
    | "message-marker-missing"
    | "checkpoint-marker-missing";
} {
  const maxChars = Number.isFinite(input.maxChars)
    ? Math.max(1, Math.floor(input.maxChars!))
    : DEFAULT_MAX_CHARS;
  const maxMessages = Number.isFinite(input.maxMessages)
    ? Math.max(1, Math.floor(input.maxMessages!))
    : DEFAULT_MAX_MESSAGES;

  const historicalMessages = input.thread.messages.filter(
    (message) => message.id !== input.currentMessageId,
  );

  const branchMismatch =
    input.syncState !== undefined &&
    (input.syncState.branch ?? null) !== (input.thread.branch ?? null);
  const worktreeMismatch =
    input.syncState !== undefined &&
    (input.syncState.worktreePath ?? null) !== (input.thread.worktreePath ?? null);

  let mode: "full" | "delta" = input.syncState ? "delta" : "full";
  let fallbackReason:
    | "branch-mismatch"
    | "worktree-mismatch"
    | "message-marker-missing"
    | "checkpoint-marker-missing"
    | undefined;

  if (branchMismatch) {
    mode = "full";
    fallbackReason = "branch-mismatch";
  } else if (worktreeMismatch) {
    mode = "full";
    fallbackReason = "worktree-mismatch";
  }

  let deltaMessages = historicalMessages;
  let deltaCheckpoints = input.thread.checkpoints;
  if (mode === "delta" && input.syncState) {
    if (input.syncState.latestMessageId) {
      const messageIndex = historicalMessages.findIndex(
        (message) => message.id === input.syncState!.latestMessageId,
      );
      if (messageIndex === -1) {
        mode = "full";
        fallbackReason = "message-marker-missing";
      } else {
        deltaMessages = historicalMessages.slice(messageIndex + 1);
      }
    }
    if (mode === "delta" && input.syncState.latestCheckpointTurnId) {
      const checkpointIndex = input.thread.checkpoints.findIndex(
        (checkpoint) => checkpoint.turnId === input.syncState!.latestCheckpointTurnId,
      );
      if (checkpointIndex === -1) {
        mode = "full";
        fallbackReason = "checkpoint-marker-missing";
      } else {
        deltaCheckpoints = input.thread.checkpoints.slice(checkpointIndex + 1);
      }
    }
  }

  let includedMessages =
    mode === "delta" ? deltaMessages.slice(-maxMessages) : historicalMessages.slice(-maxMessages);
  let includedCheckpoints =
    mode === "delta"
      ? deltaCheckpoints.slice(-maxMessages)
      : input.thread.checkpoints.slice(-maxMessages);
  let omittedMessageCount =
    mode === "delta"
      ? deltaMessages.length - includedMessages.length
      : historicalMessages.length - includedMessages.length;

  while (true) {
    const messageBlocks = includedMessages.map(formatMessageBlock);
    const checkpointBlocks = includedCheckpoints.map(formatCheckpointBlock);
    const text = buildHandoffText({
      thread: input.thread,
      fromProvider: input.fromProvider,
      toProvider: input.toProvider,
      mode,
      messageBlocks,
      checkpointBlocks,
      omittedMessageCount,
    });
    if (
      text.length <= maxChars ||
      (includedMessages.length === 0 && includedCheckpoints.length === 0)
    ) {
      return {
        mode,
        text: text.length <= maxChars ? text : text.slice(0, maxChars),
        includedMessageCount: includedMessages.length,
        includedCheckpointCount: includedCheckpoints.length,
        omittedMessageCount,
        truncated: omittedMessageCount > 0 || text.length > maxChars,
        charCount: Math.min(text.length, maxChars),
        ...(fallbackReason ? { fallbackReason } : {}),
      };
    }
    if (includedMessages.length > 0) {
      includedMessages = includedMessages.slice(1);
      omittedMessageCount += 1;
      continue;
    }
    includedCheckpoints = includedCheckpoints.slice(1);
  }
}
