import { type MessageId, type OrchestrationReadModel, type ProviderKind } from "@t3tools/contracts";

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

function buildHandoffText(input: {
  readonly thread: OrchestrationReadModel["threads"][number];
  readonly fromProvider: ProviderKind;
  readonly toProvider: ProviderKind;
  readonly messageBlocks: ReadonlyArray<string>;
  readonly omittedMessageCount: number;
}): string {
  const metadataLines = [
    "Provider switch handoff for an existing thread.",
    `Previous provider: ${providerLabel(input.fromProvider)}.`,
    `Target provider: ${providerLabel(input.toProvider)}.`,
    `Thread title: ${input.thread.title}.`,
    ...(input.thread.branch ? [`Branch: ${input.thread.branch}.`] : []),
    ...(input.thread.worktreePath ? [`Worktree: ${input.thread.worktreePath}.`] : []),
    "Historical transcript follows in chronological order.",
    "Answer the next user message after this handoff instead of replying to the handoff itself.",
  ];

  const transcriptLines = [
    "Transcript:",
    ...(input.omittedMessageCount > 0
      ? [
          `[Truncation note: ${input.omittedMessageCount} older historical message(s) omitted to stay within switch handoff limits.]`,
        ]
      : []),
    ...(input.messageBlocks.length > 0 ? input.messageBlocks : ["(no prior transcript)"]),
  ];

  return `${metadataLines.join("\n")}\n\n${transcriptLines.join("\n\n")}`;
}

export function buildProviderSwitchHandoff(input: {
  readonly thread: OrchestrationReadModel["threads"][number];
  readonly fromProvider: ProviderKind;
  readonly toProvider: ProviderKind;
  readonly currentMessageId: MessageId;
  readonly maxChars?: number;
  readonly maxMessages?: number;
}): {
  text: string;
  includedMessageCount: number;
  omittedMessageCount: number;
  truncated: boolean;
  charCount: number;
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
  let includedMessages = historicalMessages.slice(-maxMessages);
  let omittedMessageCount = historicalMessages.length - includedMessages.length;

  while (true) {
    const messageBlocks = includedMessages.map(formatMessageBlock);
    const text = buildHandoffText({
      thread: input.thread,
      fromProvider: input.fromProvider,
      toProvider: input.toProvider,
      messageBlocks,
      omittedMessageCount,
    });
    if (text.length <= maxChars || includedMessages.length === 0) {
      return {
        text: text.length <= maxChars ? text : text.slice(0, maxChars),
        includedMessageCount: includedMessages.length,
        omittedMessageCount,
        truncated: omittedMessageCount > 0 || text.length > maxChars,
        charCount: Math.min(text.length, maxChars),
      };
    }
    includedMessages = includedMessages.slice(1);
    omittedMessageCount += 1;
  }
}
