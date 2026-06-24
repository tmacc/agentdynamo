import type {
  ChatImageAttachment as ContractChatImageAttachment,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSession,
  ProjectScript as ContractProjectScript,
  ProviderInteractionMode,
  ProviderDriverKind,
  RuntimeMode,
} from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "term-1";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectScript = ContractProjectScript;

export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
  splitDirection?: "horizontal" | "vertical";
}

export interface ChatImageAttachment extends ContractChatImageAttachment {
  readonly previewUrl?: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatMessage extends Omit<OrchestrationMessage, "attachments"> {
  readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
}

export type ProposedPlan = OrchestrationProposedPlan;
export type TurnDiffFileChange = OrchestrationCheckpointFile;
export type TurnDiffSummary = OrchestrationCheckpointSummary;

export type Project = EnvironmentProject & {
  readonly name?: string;
  readonly cwd?: string;
};

export type ThreadSession = Partial<OrchestrationSession> & {
  readonly status: OrchestrationSession["status"];
  readonly provider?: ProviderDriverKind;
  readonly orchestrationStatus?: "idle" | "running" | "error";
  readonly createdAt?: string;
};

export type Thread = Omit<EnvironmentThread, "session"> & {
  readonly session: ThreadSession | null;
  readonly codexThreadId?: string | null;
  readonly error?: string | null;
  readonly pendingSourceProposedPlan?: unknown;
  readonly turnDiffSummaries?: ReadonlyArray<TurnDiffSummary>;
  readonly teamTasks?: ReadonlyArray<unknown>;
};

export type ThreadShell = Omit<EnvironmentThreadShell, "session"> & {
  readonly session: ThreadSession | null;
  readonly codexThreadId?: string | null;
  readonly error?: string | null;
  readonly teamTasks?: ReadonlyArray<unknown>;
};

export interface ThreadTurnState {
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: unknown;
}

export type SidebarThreadSummary = ThreadShell;
