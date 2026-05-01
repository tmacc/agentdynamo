import {
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationContextHandoffRenderStats,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationThread,
  type TeamTaskKind,
  type TeamTaskResolvedSetupMode,
  type TeamTaskResolvedWorkspaceMode,
  type TeamTaskSetupMode,
  type TeamTaskWorkspaceMode,
} from "@t3tools/contracts";

export interface TeamTaskContextInput {
  readonly parentThread: OrchestrationThread;
  readonly task: string;
  readonly title: string;
  readonly roleLabel: string | null;
  readonly contextBrief: string | null;
  readonly relevantFiles: ReadonlyArray<string>;
  readonly taskKind?: TeamTaskKind;
  readonly modelSelection: ModelSelection;
  readonly modelSelectionReason: string;
  readonly workspaceMode: TeamTaskWorkspaceMode;
  readonly setupMode: TeamTaskSetupMode;
  readonly projectHasWorktreeSetup: boolean;
  readonly isGitProject: boolean;
}

export interface TeamWorkspacePolicy {
  readonly resolvedWorkspaceMode: TeamTaskResolvedWorkspaceMode;
  readonly resolvedSetupMode: TeamTaskResolvedSetupMode;
}

interface PromptRow {
  readonly createdAt: string;
  readonly text: string;
  readonly messageCount: number;
  readonly proposedPlanCount: number;
  readonly attachmentCount: number;
}

const RUN_SETUP_FOR_AUTO_KINDS = new Set<TeamTaskKind>(["coding", "test", "ui"]);

function attachmentLabel(attachment: ChatAttachment): string {
  return `${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`;
}

function messageRow(message: OrchestrationMessage): PromptRow {
  const attachments = message.attachments ?? [];
  return {
    createdAt: message.createdAt,
    messageCount: 1,
    proposedPlanCount: 0,
    attachmentCount: attachments.length,
    text: [
      `${message.role.toUpperCase()} [${message.createdAt}]:`,
      message.text.trim().length === 0 ? "(no text)" : message.text,
      attachments.length > 0
        ? [
            "Attachment metadata:",
            ...attachments.map((attachment) => `- ${attachmentLabel(attachment)}`),
          ].join("\n")
        : null,
    ]
      .filter((value): value is string => value !== null)
      .join("\n"),
  };
}

function proposedPlanRow(plan: OrchestrationProposedPlan): PromptRow {
  return {
    createdAt: plan.createdAt,
    messageCount: 0,
    proposedPlanCount: 1,
    attachmentCount: 0,
    text: [`PROPOSED PLAN [${plan.createdAt}]:`, plan.planMarkdown].join("\n"),
  };
}

function keepLatestRowsWithinBudget(rows: ReadonlyArray<PromptRow>, budget: number) {
  if (budget <= 0) {
    return {
      rows: [] as ReadonlyArray<PromptRow>,
      omittedItemCount: rows.length,
      truncated: rows.length > 0,
    };
  }
  const kept: PromptRow[] = [];
  let used = 0;
  let truncated = false;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;
    const nextSize = row.text.length + (kept.length > 0 ? 2 : 0);
    if (kept.length > 0 && used + nextSize > budget) break;
    if (kept.length === 0 && nextSize > budget) {
      kept.unshift({ ...row, text: row.text.slice(Math.max(0, row.text.length - budget)) });
      truncated = true;
      used = budget;
      break;
    }
    kept.unshift(row);
    used += nextSize;
  }
  return {
    rows: kept,
    omittedItemCount: Math.max(0, rows.length - kept.length),
    truncated: truncated || kept.length < rows.length,
  };
}

export function inferTeamTaskKind(input: {
  readonly task: string;
  readonly title?: string;
}): TeamTaskKind {
  const text = `${input.title ?? ""} ${input.task}`.toLowerCase();
  if (/\b(test|spec|verify|regression|qa)\b/.test(text)) return "test";
  if (/\b(review|audit|risk|bug hunt|check)\b/.test(text)) return "review";
  if (/\b(ui|ux|frontend|design|css|component|visual)\b/.test(text)) return "ui";
  if (/\b(doc|readme|guide|documentation)\b/.test(text)) return "docs";
  if (/\b(search|explore|investigate|research|find|map)\b/.test(text)) return "exploration";
  if (/\b(implement|fix|code|refactor|build|change|patch)\b/.test(text)) return "coding";
  return "general";
}

export function resolveTeamWorkspacePolicy(input: {
  readonly taskKind: TeamTaskKind;
  readonly workspaceMode: TeamTaskWorkspaceMode;
  readonly setupMode: TeamTaskSetupMode;
  readonly isGitProject: boolean;
  readonly projectHasWorktreeSetup: boolean;
}): TeamWorkspacePolicy {
  const resolvedWorkspaceMode =
    input.workspaceMode === "shared" || (!input.isGitProject && input.workspaceMode === "auto")
      ? "shared"
      : "worktree";
  const resolvedSetupMode =
    resolvedWorkspaceMode === "shared"
      ? "skip"
      : input.setupMode === "run"
        ? "run"
        : input.setupMode === "skip"
          ? "skip"
          : input.projectHasWorktreeSetup && RUN_SETUP_FOR_AUTO_KINDS.has(input.taskKind)
            ? "run"
            : "skip";
  return { resolvedWorkspaceMode, resolvedSetupMode };
}

export function selectTeamTaskContext(thread: OrchestrationThread): ReadonlyArray<PromptRow> {
  const messageRows = thread.messages.map(messageRow);
  const planRows = thread.proposedPlans.map(proposedPlanRow);
  return [...messageRows, ...planRows].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.text.localeCompare(right.text),
  );
}

export function renderTeamChildPrompt(input: TeamTaskContextInput): {
  readonly prompt: string;
  readonly taskKind: TeamTaskKind;
  readonly policy: TeamWorkspacePolicy;
  readonly stats: OrchestrationContextHandoffRenderStats;
} {
  const taskKind = input.taskKind ?? inferTeamTaskKind({ title: input.title, task: input.task });
  const policy = resolveTeamWorkspacePolicy({
    taskKind,
    workspaceMode: input.workspaceMode,
    setupMode: input.setupMode,
    isGitProject: input.isGitProject,
    projectHasWorktreeSetup: input.projectHasWorktreeSetup,
  });
  const workspaceInstruction =
    policy.resolvedWorkspaceMode === "worktree"
      ? "Work only in your assigned isolated child branch/worktree. Do not merge or apply changes back to the coordinator workspace."
      : "You are sharing the coordinator workspace. Do not assume isolated worktree ownership; keep changes scoped to the assigned task and report what you changed.";
  const header = [
    "You are a child agent working for a Dynamo coordinator thread.",
    "Do not delegate, spawn subagents, or use native collaboration tools.",
    workspaceInstruction,
    "Return a concise result with changed files, tests/checks run, and blockers.",
    "",
    `Coordinator thread: ${input.parentThread.title} (${input.parentThread.id})`,
    `Assigned task title: ${input.title}`,
    input.roleLabel ? `Assigned role: ${input.roleLabel}` : null,
    `Task kind: ${taskKind}`,
    `Selected worker: ${input.modelSelection.instanceId}/${input.modelSelection.model}`,
    `Selection reason: ${input.modelSelectionReason}`,
    `Workspace policy: ${input.workspaceMode} -> ${policy.resolvedWorkspaceMode}`,
    `Setup policy: ${input.setupMode} -> ${policy.resolvedSetupMode}`,
    `Coordinator branch: ${input.parentThread.branch ?? "none"}`,
    `Coordinator worktree: ${input.parentThread.worktreePath ?? "project root"}`,
    input.contextBrief ? `Context brief:\n${input.contextBrief}` : null,
    input.relevantFiles.length > 0
      ? `Relevant files:\n${input.relevantFiles.map((file) => `- ${file}`).join("\n")}`
      : null,
    "",
    `Assigned task:\n${input.task}`,
    "",
    "Relevant coordinator context:",
  ]
    .filter((value): value is string => value !== null)
    .join("\n");
  const footer = "\n\nBegin work now and report the result directly.";
  const budget = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 8_000 - header.length - footer.length;
  const rows = selectTeamTaskContext(input.parentThread);
  const kept = keepLatestRowsWithinBudget(rows, budget);
  const omission =
    kept.omittedItemCount > 0
      ? `[Older coordinator context omitted: ${kept.omittedItemCount} item${kept.omittedItemCount === 1 ? "" : "s"}]\n\n`
      : "";
  const body = kept.rows.map((row) => row.text).join("\n\n");
  const truncation = kept.truncated
    ? "\n\n[Coordinator context was truncated to fit the provider input budget.]"
    : "";
  const prompt = [header, omission + body + truncation, footer].join("\n");
  const counts = kept.rows.reduce(
    (accumulator, row) => ({
      includedMessageCount: accumulator.includedMessageCount + row.messageCount,
      includedProposedPlanCount: accumulator.includedProposedPlanCount + row.proposedPlanCount,
      includedAttachmentCount: accumulator.includedAttachmentCount + row.attachmentCount,
    }),
    { includedMessageCount: 0, includedProposedPlanCount: 0, includedAttachmentCount: 0 },
  );
  return {
    prompt,
    taskKind,
    policy,
    stats: {
      ...counts,
      omittedItemCount: kept.omittedItemCount,
      truncated: kept.truncated,
      inputCharCount: prompt.length,
    },
  };
}
