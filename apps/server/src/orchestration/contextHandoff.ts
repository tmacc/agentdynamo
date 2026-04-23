import {
  type ChatAttachment,
  type OrchestrationContextHandoffRenderStats,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationThread,
  type OrchestrationThreadContextHandoff,
  type ProviderKind,
} from "@t3tools/contracts";

export interface ContextHandoffRenderableThread {
  readonly id: OrchestrationThread["id"];
  readonly title: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly proposedPlans: ReadonlyArray<OrchestrationProposedPlan>;
  readonly activities?: OrchestrationThread["activities"];
  readonly forkOrigin?: OrchestrationThread["forkOrigin"];
  readonly contextHandoffs: ReadonlyArray<OrchestrationThreadContextHandoff>;
}

export interface ContextHandoffRenderInput {
  readonly thread: ContextHandoffRenderableThread;
  readonly handoff: OrchestrationThreadContextHandoff;
  readonly liveMessage: OrchestrationMessage;
  readonly targetProvider: ProviderKind;
  readonly maxInputChars: number;
  readonly reserveChars: number;
}

export interface ContextHandoffRenderResult {
  readonly input: string;
  readonly stats: OrchestrationContextHandoffRenderStats;
}

type HandoffRow =
  | {
      readonly kind: "message";
      readonly createdAt: string;
      readonly text: string;
      readonly messageCount: number;
      readonly proposedPlanCount: 0;
      readonly attachmentCount: number;
    }
  | {
      readonly kind: "plan";
      readonly createdAt: string;
      readonly text: string;
      readonly messageCount: 0;
      readonly proposedPlanCount: number;
      readonly attachmentCount: 0;
    };

function summarizeAttachment(attachment: ChatAttachment): string {
  return `${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`;
}

function renderImportedMessage(message: OrchestrationMessage): {
  readonly text: string;
  readonly attachmentCount: number;
} {
  const label = message.role[0]?.toUpperCase() + message.role.slice(1);
  const attachments = message.attachments ?? [];
  const segments = [`${label} [${message.createdAt}]:`];
  const trimmedText = message.text.trim();
  segments.push(trimmedText.length > 0 ? message.text : "(no text)");
  if (attachments.length > 0) {
    segments.push(
      [
        "Attachments metadata:",
        ...attachments.map((attachment) => `- ${summarizeAttachment(attachment)}`),
      ].join("\n"),
    );
  }
  return {
    text: segments.join("\n"),
    attachmentCount: attachments.length,
  };
}

function renderImportedPlan(plan: OrchestrationProposedPlan): string {
  const status =
    plan.implementedAt === null ? "not yet implemented" : `implemented at ${plan.implementedAt}`;
  return [`Proposed plan [${plan.createdAt}; ${status}]:`, plan.planMarkdown].join("\n");
}

function keepLatestRowsWithinBudget(
  rows: ReadonlyArray<HandoffRow>,
  budget: number,
): {
  readonly rows: ReadonlyArray<HandoffRow>;
  readonly omittedItemCount: number;
  readonly truncated: boolean;
} {
  if (budget <= 0 || rows.length === 0) {
    return {
      rows: [],
      omittedItemCount: rows.length,
      truncated: rows.length > 0,
    };
  }

  const kept: HandoffRow[] = [];
  let total = 0;
  let truncatedRow = false;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) {
      continue;
    }

    const separatorChars = kept.length > 0 ? 2 : 0;
    const nextSize = row.text.length + separatorChars;
    if (kept.length > 0 && total + nextSize > budget) {
      break;
    }
    if (kept.length === 0 && nextSize > budget) {
      kept.unshift({
        ...row,
        text: row.text.slice(Math.max(0, row.text.length - budget)),
      });
      total = budget;
      truncatedRow = true;
      break;
    }

    kept.unshift(row);
    total += nextSize;
  }

  return {
    rows: kept,
    omittedItemCount: Math.max(0, rows.length - kept.length),
    truncated: kept.length < rows.length || truncatedRow,
  };
}

function countRows(rows: ReadonlyArray<HandoffRow>) {
  return rows.reduce(
    (accumulator, row) => ({
      includedMessageCount: accumulator.includedMessageCount + row.messageCount,
      includedProposedPlanCount: accumulator.includedProposedPlanCount + row.proposedPlanCount,
      includedAttachmentCount: accumulator.includedAttachmentCount + row.attachmentCount,
    }),
    {
      includedMessageCount: 0,
      includedProposedPlanCount: 0,
      includedAttachmentCount: 0,
    },
  );
}

function fallbackLiveMessage(input: string, maxInputChars: number): ContextHandoffRenderResult {
  const renderedInput =
    input.length <= maxInputChars ? input : input.slice(0, Math.max(0, maxInputChars));
  return {
    input: renderedInput,
    stats: {
      includedMessageCount: 0,
      includedProposedPlanCount: 0,
      includedAttachmentCount: 0,
      omittedItemCount: 0,
      truncated: renderedInput.length !== input.length,
      inputCharCount: renderedInput.length,
    },
  };
}

export function renderContextHandoff(
  input: ContextHandoffRenderInput,
): ContextHandoffRenderResult | undefined {
  if (input.handoff.status !== "pending") {
    return undefined;
  }

  const maxInputChars = Math.max(0, input.maxInputChars);
  const reservedMaxInputChars = Math.max(0, maxInputChars - Math.max(0, input.reserveChars));
  const importedUntilAt = input.handoff.importedUntilAt;
  const importedRows = [
    ...input.thread.messages
      .filter(
        (message) =>
          message.id !== input.liveMessage.id &&
          message.createdAt.localeCompare(importedUntilAt) <= 0,
      )
      .map((message): HandoffRow => {
        const rendered = renderImportedMessage(message);
        return {
          kind: "message",
          createdAt: message.createdAt,
          text: rendered.text,
          messageCount: 1,
          proposedPlanCount: 0,
          attachmentCount: rendered.attachmentCount,
        };
      }),
    ...input.thread.proposedPlans
      .filter((plan) => plan.createdAt.localeCompare(importedUntilAt) <= 0)
      .map(
        (plan): HandoffRow => ({
          kind: "plan",
          createdAt: plan.createdAt,
          text: renderImportedPlan(plan),
          messageCount: 0,
          proposedPlanCount: 1,
          attachmentCount: 0,
        }),
      ),
  ].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));

  if (importedRows.length === 0) {
    return undefined;
  }

  const sourceTitle = input.handoff.sourceThreadTitle ?? "unknown source thread";
  const sourceThreadId = input.handoff.sourceThreadId ?? "unknown";
  const sourceUserMessageId = input.handoff.sourceUserMessageId ?? "unknown";
  const executionContext = [
    "Execution context:",
    `- Target provider: ${input.targetProvider}`,
    input.thread.branch === null ? "- Branch: none" : `- Branch: ${input.thread.branch}`,
    input.thread.worktreePath === null
      ? "- Worktree path: none"
      : `- Worktree path: ${input.thread.worktreePath}`,
  ].join("\n");
  const header = [
    "Context handoff",
    `Reason: ${input.handoff.reason}`,
    `Source thread: ${sourceTitle}`,
    `Source thread id: ${sourceThreadId}`,
    `Source user message id: ${sourceUserMessageId}`,
    `Imported until: ${importedUntilAt}`,
    "",
    executionContext,
    "",
    "Treat the imported transcript and proposed plans below as prior visible conversation state.",
    "",
    "Imported transcript and proposed plans:",
  ].join("\n");
  const footer = [
    "",
    "Continue from the new live user message below.",
    "",
    "New live user message:",
    input.liveMessage.text,
  ].join("\n");
  const staticChars = header.length + footer.length + 4;
  const rowBudget = reservedMaxInputChars - staticChars;
  const keptRows = keepLatestRowsWithinBudget(importedRows, rowBudget);
  const omissionNotice =
    keptRows.omittedItemCount > 0
      ? `[Older imported context omitted: ${keptRows.omittedItemCount} item${keptRows.omittedItemCount === 1 ? "" : "s"}]\n\n`
      : "";
  const importedContext = keptRows.rows.map((row) => row.text).join("\n\n");
  const truncationNotice = keptRows.truncated
    ? "\n\n[Context handoff was truncated to fit the provider input budget.]"
    : "";
  const renderedInput = [
    header,
    `${omissionNotice}${importedContext}${truncationNotice}`,
    footer,
  ].join("\n");

  if (renderedInput.length > maxInputChars || renderedInput.trim().length === 0) {
    const fallback = fallbackLiveMessage(input.liveMessage.text, maxInputChars);
    return {
      input: fallback.input,
      stats: {
        ...fallback.stats,
        omittedItemCount: importedRows.length,
        truncated: true,
      },
    };
  }

  const rowCounts = countRows(keptRows.rows);
  return {
    input: renderedInput,
    stats: {
      ...rowCounts,
      omittedItemCount: keptRows.omittedItemCount,
      truncated: keptRows.truncated,
      inputCharCount: renderedInput.length,
    },
  };
}
