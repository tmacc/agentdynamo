import { Effect, Option, Schema, SchemaIssue, Struct } from "effect";
import {
  ClaudeModelOptions,
  CodexModelOptions,
  CursorModelOptions,
  OpenCodeModelOptions,
} from "./model.ts";
import { RepositoryIdentity } from "./environment.ts";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ProviderItemId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import {
  BoardArchiveCardCommand,
  BoardCardArchivedPayload,
  BoardCardCreatedPayload,
  BoardCardDeletedPayload,
  BoardCardMovedPayload,
  BoardCardThreadLinkedPayload,
  BoardCardThreadUnlinkedPayload,
  BoardCardUpdatedPayload,
  BoardCreateCardCommand,
  BoardDeleteCardCommand,
  BoardGhostCardDismissCommand,
  BoardGhostCardDismissedPayload,
  BoardGhostCardUndismissCommand,
  BoardGhostCardUndismissedPayload,
  BoardLinkThreadCommand,
  BoardMoveCardCommand,
  BoardUnlinkThreadCommand,
  BoardUpdateCardCommand,
} from "./board.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  forkThread: "orchestration.forkThread",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  getTeamTaskTrace: "orchestration.getTeamTaskTrace",
  replayEvents: "orchestration.replayEvents",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
  subscribeTeamTaskTrace: "orchestration.subscribeTeamTaskTrace",
} as const;

export const ProviderKind = Schema.Literals(["codex", "claudeAgent", "cursor", "opencode"]);
export type ProviderKind = typeof ProviderKind.Type;
export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

export const DEFAULT_PROVIDER_KIND: ProviderKind = "codex";

export const CodexModelSelection = Schema.Struct({
  provider: Schema.Literal("codex"),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(CodexModelOptions),
});
export type CodexModelSelection = typeof CodexModelSelection.Type;

export const ClaudeModelSelection = Schema.Struct({
  provider: Schema.Literal("claudeAgent"),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ClaudeModelOptions),
});
export type ClaudeModelSelection = typeof ClaudeModelSelection.Type;

export const CursorModelSelection = Schema.Struct({
  provider: Schema.Literal("cursor"),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(CursorModelOptions),
});
export type CursorModelSelection = typeof CursorModelSelection.Type;
export const OpenCodeModelSelection = Schema.Struct({
  provider: Schema.Literal("opencode"),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(OpenCodeModelOptions),
});
export type OpenCodeModelSelection = typeof OpenCodeModelSelection.Type;

export const ModelSelection = Schema.Union([
  CodexModelSelection,
  ClaudeModelSelection,
  CursorModelSelection,
  OpenCodeModelSelection,
]);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
});
export type ProjectScript = typeof ProjectScript.Type;

export const ProjectWorktreeSetupPackageManager = Schema.Literals([
  "bun",
  "pnpm",
  "npm",
  "yarn",
  "uv",
  "pip",
  "poetry",
  "bundle",
  "mix",
  "unknown",
]);
export type ProjectWorktreeSetupPackageManager = typeof ProjectWorktreeSetupPackageManager.Type;

export const ProjectWorktreeSetupFramework = Schema.Literals([
  "next",
  "vite",
  "astro",
  "django",
  "rails",
  "phoenix",
  "generic",
]);
export type ProjectWorktreeSetupFramework = typeof ProjectWorktreeSetupFramework.Type;

export const ProjectWorktreeSetupEnvStrategy = Schema.Literals([
  "symlink_root",
  "copy_root",
  "none",
]);
export type ProjectWorktreeSetupEnvStrategy = typeof ProjectWorktreeSetupEnvStrategy.Type;

export const ProjectWorktreeSetupStorageMode = Schema.Literal("dynamo-managed");
export type ProjectWorktreeSetupStorageMode = typeof ProjectWorktreeSetupStorageMode.Type;

export const ProjectWorktreeSetupProfile = Schema.Struct({
  version: Schema.Literal(1),
  status: Schema.Literal("configured"),
  scanFingerprint: TrimmedNonEmptyString,
  packageManager: ProjectWorktreeSetupPackageManager,
  framework: ProjectWorktreeSetupFramework,
  installCommand: Schema.NullOr(TrimmedNonEmptyString),
  devCommand: TrimmedNonEmptyString,
  envStrategy: ProjectWorktreeSetupEnvStrategy,
  envSourcePath: Schema.NullOr(TrimmedNonEmptyString),
  portCount: NonNegativeInt,
  storageMode: ProjectWorktreeSetupStorageMode,
  autoRunSetupOnWorktreeCreate: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectWorktreeSetupProfile = typeof ProjectWorktreeSetupProfile.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  worktreeSetup: Schema.optional(Schema.NullOr(ProjectWorktreeSetupProfile)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "recovering",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const OrchestrationThreadForkOrigin = Schema.Struct({
  sourceThreadId: ThreadId,
  sourceThreadTitle: TrimmedNonEmptyString,
  sourceUserMessageId: MessageId,
  importedUntilAt: IsoDateTime,
  forkedAt: IsoDateTime,
});
export type OrchestrationThreadForkOrigin = typeof OrchestrationThreadForkOrigin.Type;

export const TeamTaskId = TrimmedNonEmptyString.pipe(Schema.brand("TeamTaskId"));
export type TeamTaskId = typeof TeamTaskId.Type;

export const TeamCoordinatorGrantId = TrimmedNonEmptyString.pipe(
  Schema.brand("TeamCoordinatorGrantId"),
);
export type TeamCoordinatorGrantId = typeof TeamCoordinatorGrantId.Type;

export const TeamTaskStatus = Schema.Literals([
  "queued",
  "starting",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
export type TeamTaskStatus = typeof TeamTaskStatus.Type;

export const TeamTaskWorkspaceMode = Schema.Literals(["auto", "worktree", "shared"]);
export type TeamTaskWorkspaceMode = typeof TeamTaskWorkspaceMode.Type;

export const TeamTaskResolvedWorkspaceMode = Schema.Literals(["worktree", "shared"]);
export type TeamTaskResolvedWorkspaceMode = typeof TeamTaskResolvedWorkspaceMode.Type;

export const TeamTaskSetupMode = Schema.Literals(["auto", "run", "skip"]);
export type TeamTaskSetupMode = typeof TeamTaskSetupMode.Type;

export const TeamTaskResolvedSetupMode = Schema.Literals(["run", "skip"]);
export type TeamTaskResolvedSetupMode = typeof TeamTaskResolvedSetupMode.Type;

export const TeamTaskKind = Schema.Literals([
  "coding",
  "exploration",
  "review",
  "test",
  "ui",
  "docs",
  "general",
]);
export type TeamTaskKind = typeof TeamTaskKind.Type;

export const TeamTaskModelSelectionMode = Schema.Literals([
  "user-specified",
  "coordinator-selected",
  "fallback",
]);
export type TeamTaskModelSelectionMode = typeof TeamTaskModelSelectionMode.Type;

export const TeamTaskSource = Schema.Literals(["dynamo", "native-provider"]);
export type TeamTaskSource = typeof TeamTaskSource.Type;

export const NativeProviderTeamTaskRef = Schema.Struct({
  provider: ProviderKind,
  providerTaskId: Schema.optionalKey(TrimmedNonEmptyString),
  providerItemId: Schema.optionalKey(TrimmedNonEmptyString),
  providerTurnId: Schema.optionalKey(TrimmedNonEmptyString),
  providerThreadIds: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  toolName: Schema.optionalKey(TrimmedNonEmptyString),
  providerSessionId: Schema.optionalKey(TrimmedNonEmptyString),
  providerAgentId: Schema.optionalKey(TrimmedNonEmptyString),
  providerTranscriptPath: Schema.optionalKey(TrimmedNonEmptyString),
});
export type NativeProviderTeamTaskRef = typeof NativeProviderTeamTaskRef.Type;

export const NativeSubagentTraceItemId = TrimmedNonEmptyString.pipe(
  Schema.brand("NativeSubagentTraceItemId"),
);
export type NativeSubagentTraceItemId = typeof NativeSubagentTraceItemId.Type;

export const NativeSubagentTraceItemKind = Schema.Literals([
  "lifecycle",
  "user_message",
  "assistant_message",
  "reasoning_summary",
  "tool_call",
  "tool_output",
  "command_output",
  "file_change",
  "error",
]);
export type NativeSubagentTraceItemKind = typeof NativeSubagentTraceItemKind.Type;

export const NativeSubagentTraceItemStatus = Schema.Literals([
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type NativeSubagentTraceItemStatus = typeof NativeSubagentTraceItemStatus.Type;

export const OrchestrationNativeSubagentTraceItem = Schema.Struct({
  id: NativeSubagentTraceItemId,
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  provider: ProviderKind,
  providerThreadId: Schema.NullOr(TrimmedNonEmptyString),
  providerTurnId: Schema.NullOr(TrimmedNonEmptyString),
  providerItemId: Schema.NullOr(TrimmedNonEmptyString),
  providerToolUseId: Schema.NullOr(TrimmedNonEmptyString),
  kind: NativeSubagentTraceItemKind,
  status: NativeSubagentTraceItemStatus,
  title: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  toolName: Schema.NullOr(Schema.String),
  inputSummary: Schema.NullOr(Schema.String),
  outputSummary: Schema.NullOr(Schema.String),
  sequence: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationNativeSubagentTraceItem = typeof OrchestrationNativeSubagentTraceItem.Type;

export const OrchestrationTeamTask = Schema.Struct({
  id: TeamTaskId,
  parentThreadId: ThreadId,
  childThreadId: ThreadId,
  title: TrimmedNonEmptyString,
  task: TrimmedNonEmptyString,
  roleLabel: Schema.NullOr(TrimmedNonEmptyString),
  kind: TeamTaskKind,
  modelSelection: ModelSelection,
  modelSelectionMode: TeamTaskModelSelectionMode,
  modelSelectionReason: TrimmedNonEmptyString,
  workspaceMode: TeamTaskWorkspaceMode,
  resolvedWorkspaceMode: TeamTaskResolvedWorkspaceMode,
  setupMode: TeamTaskSetupMode,
  resolvedSetupMode: TeamTaskResolvedSetupMode,
  source: Schema.optionalKey(TeamTaskSource).pipe(
    Schema.withDecodingDefault(Effect.succeed("dynamo" as const)),
    Schema.withConstructorDefault(Effect.succeed("dynamo" as const)),
  ),
  childThreadMaterialized: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
    Schema.withConstructorDefault(Effect.succeed(true)),
  ),
  nativeProviderRef: Schema.optionalKey(Schema.NullOr(NativeProviderTeamTaskRef)),
  status: TeamTaskStatus,
  latestSummary: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  errorText: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  promptStats: Schema.optional(
    Schema.Struct({
      includedMessageCount: NonNegativeInt,
      includedProposedPlanCount: NonNegativeInt,
      includedAttachmentCount: NonNegativeInt,
      omittedItemCount: NonNegativeInt,
      truncated: Schema.Boolean,
      inputCharCount: NonNegativeInt,
    }),
  ),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  updatedAt: IsoDateTime,
});
export type OrchestrationTeamTask = typeof OrchestrationTeamTask.Type;

export const OrchestrationThreadTeamParent = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  roleLabel: Schema.NullOr(TrimmedNonEmptyString),
});
export type OrchestrationThreadTeamParent = typeof OrchestrationThreadTeamParent.Type;

export const ContextHandoffId = TrimmedNonEmptyString.pipe(Schema.brand("ContextHandoffId"));
export type ContextHandoffId = typeof ContextHandoffId.Type;

export const OrchestrationContextHandoffReason = Schema.Literals(["fork", "provider-switch"]);
export type OrchestrationContextHandoffReason = typeof OrchestrationContextHandoffReason.Type;

export const OrchestrationContextHandoffStatus = Schema.Literals(["pending", "delivered"]);
export type OrchestrationContextHandoffStatus = typeof OrchestrationContextHandoffStatus.Type;

export const OrchestrationContextHandoffRenderStats = Schema.Struct({
  includedMessageCount: NonNegativeInt,
  includedProposedPlanCount: NonNegativeInt,
  includedAttachmentCount: NonNegativeInt,
  omittedItemCount: NonNegativeInt,
  truncated: Schema.Boolean,
  inputCharCount: NonNegativeInt,
});
export type OrchestrationContextHandoffRenderStats =
  typeof OrchestrationContextHandoffRenderStats.Type;

export const OrchestrationThreadContextHandoff = Schema.Struct({
  id: ContextHandoffId,
  threadId: ThreadId,
  reason: OrchestrationContextHandoffReason,
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceThreadTitle: Schema.NullOr(TrimmedNonEmptyString),
  sourceUserMessageId: Schema.NullOr(MessageId),
  sourceProvider: Schema.optional(ProviderKind),
  targetProvider: Schema.optional(ProviderKind),
  importedUntilAt: IsoDateTime,
  createdAt: IsoDateTime,
  status: OrchestrationContextHandoffStatus,
  deliveredAt: Schema.optional(IsoDateTime),
  deliveredProvider: Schema.optional(ProviderKind),
  deliveredTurnId: Schema.optional(TurnId),
  deliveredLiveMessageId: Schema.optional(MessageId),
  renderStats: Schema.optional(OrchestrationContextHandoffRenderStats),
});
export type OrchestrationThreadContextHandoff = typeof OrchestrationThreadContextHandoff.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  deletedAt: Schema.NullOr(IsoDateTime),
  forkOrigin: Schema.optional(OrchestrationThreadForkOrigin),
  teamParent: Schema.optionalKey(Schema.NullOr(OrchestrationThreadTeamParent)),
  teamTasks: Schema.optionalKey(Schema.Array(OrchestrationTeamTask)),
  contextHandoffs: Schema.Array(OrchestrationThreadContextHandoff).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  worktreeSetup: Schema.optional(Schema.NullOr(ProjectWorktreeSetupProfile)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  session: Schema.NullOr(OrchestrationSession),
  forkOrigin: Schema.optional(OrchestrationThreadForkOrigin),
  teamParent: Schema.optionalKey(Schema.NullOr(OrchestrationThreadTeamParent)),
  activeTeamTaskCount: Schema.optionalKey(NonNegativeInt),
  contextHandoffs: Schema.Array(OrchestrationThreadContextHandoff).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  worktreeSetup: Schema.optional(Schema.NullOr(ProjectWorktreeSetupProfile)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadForkCommand = Schema.Struct({
  type: Schema.Literal("thread.fork"),
  commandId: CommandId,
  handoffId: ContextHandoffId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  forkOrigin: OrchestrationThreadForkOrigin,
  clonedMessages: Schema.Array(OrchestrationMessage),
  clonedProposedPlans: Schema.Array(OrchestrationProposedPlan),
  createdAt: IsoDateTime,
});

const ThreadContextHandoffPrepareCommand = Schema.Struct({
  type: Schema.Literal("thread.context-handoff.prepare"),
  commandId: CommandId,
  threadId: ThreadId,
  handoffId: ContextHandoffId,
  reason: OrchestrationContextHandoffReason,
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceThreadTitle: Schema.NullOr(TrimmedNonEmptyString),
  sourceUserMessageId: Schema.NullOr(MessageId),
  sourceProvider: Schema.optional(ProviderKind),
  targetProvider: Schema.optional(ProviderKind),
  importedUntilAt: IsoDateTime,
  createdAt: IsoDateTime,
});

const ThreadContextHandoffMarkDeliveredCommand = Schema.Struct({
  type: Schema.Literal("thread.context-handoff.mark-delivered"),
  commandId: CommandId,
  threadId: ThreadId,
  handoffId: ContextHandoffId,
  liveMessageId: MessageId,
  provider: ProviderKind,
  turnId: TurnId,
  modelSelection: Schema.optional(ModelSelection),
  renderStats: OrchestrationContextHandoffRenderStats,
  createdAt: IsoDateTime,
});

const ThreadContextHandoffMarkDeliveryFailedCommand = Schema.Struct({
  type: Schema.Literal("thread.context-handoff.mark-delivery-failed"),
  commandId: CommandId,
  threadId: ThreadId,
  handoffId: ContextHandoffId,
  liveMessageId: MessageId,
  provider: Schema.optional(ProviderKind),
  detail: TrimmedNonEmptyString,
  renderStats: Schema.optional(OrchestrationContextHandoffRenderStats),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
});

const ThreadTurnStartBootstrap = Schema.Struct({
  createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
  prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type ThreadTurnStartBootstrap = typeof ThreadTurnStartBootstrap.Type;

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadTurnCompletionState = Schema.Literals([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);
export type ThreadTurnCompletionState = typeof ThreadTurnCompletionState.Type;

const ThreadTurnCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  state: ThreadTurnCompletionState,
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
  errorText: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const TeamTaskStatusCommandBase = {
  commandId: CommandId,
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  createdAt: IsoDateTime,
} as const;

const ThreadTeamTaskSpawnCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.spawn"),
  commandId: CommandId,
  teamTask: OrchestrationTeamTask,
  createdAt: IsoDateTime,
});

const ThreadTeamTaskUpsertNativeCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.upsert-native"),
  commandId: CommandId,
  parentThreadId: ThreadId,
  teamTask: OrchestrationTeamTask,
  createdAt: IsoDateTime,
});

const ThreadTeamTaskMarkStartingCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.mark-starting"),
  ...TeamTaskStatusCommandBase,
});

const ThreadTeamTaskMarkRunningCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.mark-running"),
  ...TeamTaskStatusCommandBase,
});

const ThreadTeamTaskMarkWaitingCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.mark-waiting"),
  ...TeamTaskStatusCommandBase,
});

const ThreadTeamTaskMarkCompletedCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.mark-completed"),
  ...TeamTaskStatusCommandBase,
  latestSummary: Schema.optional(Schema.String),
});

const ThreadTeamTaskMarkFailedCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.mark-failed"),
  ...TeamTaskStatusCommandBase,
  detail: TrimmedNonEmptyString,
});

const ThreadTeamTaskMarkCancelledCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.mark-cancelled"),
  ...TeamTaskStatusCommandBase,
  reason: Schema.optional(TrimmedNonEmptyString),
});

const ThreadTeamTaskUpdateSummaryCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.update-summary"),
  ...TeamTaskStatusCommandBase,
  latestSummary: Schema.String,
});

const ThreadTeamTaskSendMessageCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.send-message"),
  ...TeamTaskStatusCommandBase,
  message: TrimmedNonEmptyString,
});

const ThreadTeamTaskCloseCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.close"),
  ...TeamTaskStatusCommandBase,
  reason: Schema.optional(TrimmedNonEmptyString),
});

const ThreadTeamTaskNativeTraceUpsertItemCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.native-trace.upsert-item"),
  commandId: CommandId,
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  item: OrchestrationNativeSubagentTraceItem,
  createdAt: IsoDateTime,
});

const ThreadTeamTaskNativeTraceAppendContentCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.native-trace.append-content"),
  commandId: CommandId,
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  traceItemId: NativeSubagentTraceItemId,
  delta: Schema.String,
  updatedAt: IsoDateTime,
  createdAt: IsoDateTime,
});

const ThreadTeamTaskNativeTraceMarkCompletedCommand = Schema.Struct({
  type: Schema.Literal("thread.team-task.native-trace.mark-completed"),
  commandId: CommandId,
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  traceItemId: NativeSubagentTraceItemId,
  status: NativeSubagentTraceItemStatus,
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  outputSummary: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  ThreadTeamTaskSendMessageCommand,
  ThreadTeamTaskCloseCommand,
  BoardCreateCardCommand,
  BoardUpdateCardCommand,
  BoardMoveCardCommand,
  BoardArchiveCardCommand,
  BoardDeleteCardCommand,
  BoardLinkThreadCommand,
  BoardUnlinkThreadCommand,
  BoardGhostCardDismissCommand,
  BoardGhostCardUndismissCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  ThreadTeamTaskSendMessageCommand,
  ThreadTeamTaskCloseCommand,
  BoardCreateCardCommand,
  BoardUpdateCardCommand,
  BoardMoveCardCommand,
  BoardArchiveCardCommand,
  BoardDeleteCardCommand,
  BoardLinkThreadCommand,
  BoardUnlinkThreadCommand,
  BoardGhostCardDismissCommand,
  BoardGhostCardUndismissCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadForkCommand,
  ThreadContextHandoffPrepareCommand,
  ThreadContextHandoffMarkDeliveredCommand,
  ThreadContextHandoffMarkDeliveryFailedCommand,
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnCompleteCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
  ThreadTeamTaskSpawnCommand,
  ThreadTeamTaskUpsertNativeCommand,
  ThreadTeamTaskMarkStartingCommand,
  ThreadTeamTaskMarkRunningCommand,
  ThreadTeamTaskMarkWaitingCommand,
  ThreadTeamTaskMarkCompletedCommand,
  ThreadTeamTaskMarkFailedCommand,
  ThreadTeamTaskMarkCancelledCommand,
  ThreadTeamTaskUpdateSummaryCommand,
  ThreadTeamTaskSendMessageCommand,
  ThreadTeamTaskNativeTraceUpsertItemCommand,
  ThreadTeamTaskNativeTraceAppendContentCommand,
  ThreadTeamTaskNativeTraceMarkCompletedCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.turn-completed",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  "thread.context-handoff-prepared",
  "thread.context-handoff-delivered",
  "thread.context-handoff-delivery-failed",
  "thread.team-task-created",
  "thread.team-task-started",
  "thread.team-task-status-changed",
  "thread.team-task-summary-updated",
  "thread.team-task-message-requested",
  "thread.team-task-close-requested",
  "thread.team-task-native-trace-item-upserted",
  "thread.team-task-native-trace-content-appended",
  "thread.team-task-native-trace-item-completed",
  "board.card-created",
  "board.card-updated",
  "board.card-moved",
  "board.card-archived",
  "board.card-deleted",
  "board.card-thread-linked",
  "board.card-thread-unlinked",
  "board.ghost-card-dismissed",
  "board.ghost-card-undismissed",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "thread", "board"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  worktreeSetup: Schema.optional(Schema.NullOr(ProjectWorktreeSetupProfile)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  worktreeSetup: Schema.optional(Schema.NullOr(ProjectWorktreeSetupProfile)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  forkOrigin: Schema.optional(OrchestrationThreadForkOrigin),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadTurnCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  state: ThreadTurnCompletionState,
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
  errorText: Schema.optional(Schema.String),
});
export type ThreadTurnCompletedPayload = typeof ThreadTurnCompletedPayload.Type;

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const ThreadTeamTaskCreatedPayload = Schema.Struct({
  parentThreadId: ThreadId,
  teamTask: OrchestrationTeamTask,
});

export const ThreadTeamTaskStartedPayload = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  startedAt: IsoDateTime,
});

export const ThreadTeamTaskStatusChangedPayload = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  status: TeamTaskStatus,
  errorText: Schema.optional(Schema.NullOr(Schema.String)),
  latestSummary: Schema.optional(Schema.NullOr(Schema.String)),
  nativeProviderRef: Schema.optional(Schema.NullOr(NativeProviderTeamTaskRef)),
  updatedAt: IsoDateTime,
  completedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
});

export const ThreadTeamTaskSummaryUpdatedPayload = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  latestSummary: Schema.String,
  updatedAt: IsoDateTime,
});

export const ThreadTeamTaskMessageRequestedPayload = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  message: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const ThreadTeamTaskCloseRequestedPayload = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  reason: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

export const ThreadTeamTaskNativeTraceItemUpsertedPayload = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  item: OrchestrationNativeSubagentTraceItem,
});

export const ThreadTeamTaskNativeTraceContentAppendedPayload = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  traceItemId: NativeSubagentTraceItemId,
  delta: Schema.String,
  updatedAt: IsoDateTime,
});

export const ThreadTeamTaskNativeTraceItemCompletedPayload = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  traceItemId: NativeSubagentTraceItemId,
  status: NativeSubagentTraceItemStatus,
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  outputSummary: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadContextHandoffPreparedPayload = Schema.Struct({
  handoffId: ContextHandoffId,
  threadId: ThreadId,
  reason: OrchestrationContextHandoffReason,
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceThreadTitle: Schema.NullOr(TrimmedNonEmptyString),
  sourceUserMessageId: Schema.NullOr(MessageId),
  sourceProvider: Schema.optional(ProviderKind),
  targetProvider: Schema.optional(ProviderKind),
  importedUntilAt: IsoDateTime,
  createdAt: IsoDateTime,
});

export const ThreadContextHandoffDeliveredPayload = Schema.Struct({
  handoffId: ContextHandoffId,
  threadId: ThreadId,
  liveMessageId: MessageId,
  provider: ProviderKind,
  turnId: TurnId,
  renderStats: OrchestrationContextHandoffRenderStats,
  deliveredAt: IsoDateTime,
});

export const ThreadContextHandoffDeliveryFailedPayload = Schema.Struct({
  handoffId: ContextHandoffId,
  threadId: ThreadId,
  liveMessageId: MessageId,
  provider: Schema.optional(ProviderKind),
  detail: TrimmedNonEmptyString,
  renderStats: Schema.optional(OrchestrationContextHandoffRenderStats),
  failedAt: IsoDateTime,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-completed"),
    payload: ThreadTurnCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.context-handoff-prepared"),
    payload: ThreadContextHandoffPreparedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.context-handoff-delivered"),
    payload: ThreadContextHandoffDeliveredPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.context-handoff-delivery-failed"),
    payload: ThreadContextHandoffDeliveryFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.team-task-created"),
    payload: ThreadTeamTaskCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.team-task-started"),
    payload: ThreadTeamTaskStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.team-task-status-changed"),
    payload: ThreadTeamTaskStatusChangedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.team-task-summary-updated"),
    payload: ThreadTeamTaskSummaryUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.team-task-message-requested"),
    payload: ThreadTeamTaskMessageRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.team-task-close-requested"),
    payload: ThreadTeamTaskCloseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.team-task-native-trace-item-upserted"),
    payload: ThreadTeamTaskNativeTraceItemUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.team-task-native-trace-content-appended"),
    payload: ThreadTeamTaskNativeTraceContentAppendedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.team-task-native-trace-item-completed"),
    payload: ThreadTeamTaskNativeTraceItemCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("board.card-created"),
    payload: BoardCardCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("board.card-updated"),
    payload: BoardCardUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("board.card-moved"),
    payload: BoardCardMovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("board.card-archived"),
    payload: BoardCardArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("board.card-deleted"),
    payload: BoardCardDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("board.card-thread-linked"),
    payload: BoardCardThreadLinkedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("board.card-thread-unlinked"),
    payload: BoardCardThreadUnlinkedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("board.ghost-card-dismissed"),
    payload: BoardGhostCardDismissedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("board.ghost-card-undismissed"),
    payload: BoardGhostCardUndismissedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "ready",
  "running",
  "recovering",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({ threadId: ThreadId }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationForkThreadInput = Schema.Struct({
  sourceThreadId: ThreadId,
  sourceUserMessageId: MessageId,
  mode: Schema.Literals(["local", "worktree"]),
  baseBranch: Schema.optional(TrimmedNonEmptyString),
});
export type OrchestrationForkThreadInput = typeof OrchestrationForkThreadInput.Type;

export const OrchestrationForkThreadResult = Schema.Struct({
  thread: OrchestrationThreadShell,
});
export type OrchestrationForkThreadResult = typeof OrchestrationForkThreadResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

export const OrchestrationGetTeamTaskTraceInput = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  limit: Schema.optional(NonNegativeInt),
});
export type OrchestrationGetTeamTaskTraceInput = typeof OrchestrationGetTeamTaskTraceInput.Type;

export const OrchestrationSubscribeTeamTaskTraceInput = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
});
export type OrchestrationSubscribeTeamTaskTraceInput =
  typeof OrchestrationSubscribeTeamTaskTraceInput.Type;

export const OrchestrationTeamTaskTraceSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  items: Schema.Array(OrchestrationNativeSubagentTraceItem),
});
export type OrchestrationTeamTaskTraceSnapshot = typeof OrchestrationTeamTaskTraceSnapshot.Type;

export const OrchestrationTeamTaskTraceStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationTeamTaskTraceSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationTeamTaskTraceStreamItem = typeof OrchestrationTeamTaskTraceStreamItem.Type;

export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  forkThread: {
    input: OrchestrationForkThreadInput,
    output: OrchestrationForkThreadResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  getTeamTaskTrace: {
    input: OrchestrationGetTeamTaskTraceInput,
    output: OrchestrationTeamTaskTraceSnapshot,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  subscribeTeamTaskTrace: {
    input: OrchestrationSubscribeTeamTaskTraceInput,
    output: OrchestrationTeamTaskTraceStreamItem,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeShell: {
    input: Schema.Struct({}),
    output: OrchestrationShellStreamItem,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationForkThreadError extends Schema.TaggedErrorClass<OrchestrationForkThreadError>()(
  "OrchestrationForkThreadError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  "OrchestrationGetFullThreadDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationReplayEventsError extends Schema.TaggedErrorClass<OrchestrationReplayEventsError>()(
  "OrchestrationReplayEventsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
