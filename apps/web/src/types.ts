import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationLatestTurn,
  OrchestrationProposedPlanId,
  RepositoryIdentity,
  OrchestrationSessionStatus,
  OrchestrationTeamTaskId,
  OrchestrationTeamTaskStatus,
  OrchestrationTeamTaskWorkspaceMode,
  OrchestrationThreadActivity,
  ProjectScript as ContractProjectScript,
  ThreadId,
  ProjectId,
  TurnId,
  MessageId,
  ProviderKind,
  CheckpointRef,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "default";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectScript = ContractProjectScript;

export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
}

export interface ChatImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatAttachment[];
  turnId?: TurnId | null;
  createdAt: string;
  completedAt?: string | undefined;
  streaming: boolean;
}

export interface ProposedPlan {
  id: OrchestrationProposedPlanId;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnDiffFileChange {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TurnDiffSummary {
  turnId: TurnId;
  completedAt: string;
  status?: string | undefined;
  files: TurnDiffFileChange[];
  checkpointRef?: CheckpointRef | undefined;
  assistantMessageId?: MessageId | undefined;
  checkpointTurnCount?: number | undefined;
}

export interface TeamTask {
  id: OrchestrationTeamTaskId;
  parentThreadId: ThreadId;
  childThreadId: ThreadId;
  title: string;
  roleLabel: string | null;
  modelSelection: ModelSelection;
  workspaceMode: OrchestrationTeamTaskWorkspaceMode;
  status: OrchestrationTeamTaskStatus;
  latestSummary: string | null;
  errorText: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface Project {
  id: ProjectId;
  environmentId: EnvironmentId;
  name: string;
  cwd: string;
  repositoryIdentity?: RepositoryIdentity | null;
  defaultModelSelection: ModelSelection | null;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  scripts: ProjectScript[];
}

export interface Thread {
  id: ThreadId;
  environmentId: EnvironmentId;
  codexThreadId: string | null;
  projectId: ProjectId;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  session: ThreadSession | null;
  messages: ChatMessage[];
  proposedPlans: ProposedPlan[];
  error: string | null;
  createdAt: string;
  archivedAt: string | null;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: OrchestrationLatestTurn["sourceProposedPlan"];
  branch: string | null;
  worktreePath: string | null;
  teamParentThreadId?: ThreadId | null;
  teamParentTaskId?: OrchestrationTeamTaskId | null;
  teamRoleLabel?: string | null;
  teamStatus?: OrchestrationTeamTaskStatus | null;
  activeTeamTaskCount?: number;
  teamTasks?: TeamTask[];
  turnDiffSummaries: TurnDiffSummary[];
  activities: OrchestrationThreadActivity[];
}

export interface ThreadShell {
  id: ThreadId;
  environmentId: EnvironmentId;
  codexThreadId: string | null;
  projectId: ProjectId;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  error: string | null;
  createdAt: string;
  archivedAt: string | null;
  updatedAt?: string | undefined;
  branch: string | null;
  worktreePath: string | null;
  teamParentThreadId?: ThreadId | null;
  teamParentTaskId?: OrchestrationTeamTaskId | null;
  teamRoleLabel?: string | null;
  teamStatus?: OrchestrationTeamTaskStatus | null;
  activeTeamTaskCount?: number;
}

export interface ThreadTurnState {
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: OrchestrationLatestTurn["sourceProposedPlan"];
}

export interface SidebarThreadSummary {
  id: ThreadId;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  title: string;
  interactionMode: ProviderInteractionMode;
  session: ThreadSession | null;
  createdAt: string;
  archivedAt: string | null;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  branch: string | null;
  worktreePath: string | null;
  teamParentThreadId?: ThreadId | null;
  teamParentTaskId?: OrchestrationTeamTaskId | null;
  teamRoleLabel?: string | null;
  teamStatus?: OrchestrationTeamTaskStatus | null;
  activeTeamTaskCount?: number;
  latestUserMessageAt: string | null;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  hasActionableProposedPlan: boolean;
}

export interface ThreadSession {
  provider: ProviderKind;
  status: SessionPhase | "error" | "closed";
  activeTurnId?: TurnId | undefined;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  orchestrationStatus: OrchestrationSessionStatus;
}
