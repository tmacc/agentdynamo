/**
 * ProviderService - Service interface for provider sessions, turns, and checkpoints.
 *
 * Acts as the cross-provider facade used by transports (WebSocket/RPC). It
 * resolves provider adapters through `ProviderAdapterRegistry`, routes
 * session-scoped calls via `ProviderSessionDirectory`, and exposes one unified
 * provider event stream to callers.
 *
 * Uses Effect `Context.Service` for dependency injection and returns typed
 * domain errors for validation, session, codex, and checkpoint workflows.
 *
 * @module ProviderService
 */
import type {
  ProviderInterruptTurnInput,
  ProviderKind,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  ThreadId,
  ProviderTurnStartResult,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { ProviderServiceError } from "../Errors.ts";
import type { ProviderAdapterCapabilities } from "./ProviderAdapter.ts";
import type {
  ProviderRuntimeBinding,
  ProviderRuntimeBindingWithMetadata,
} from "./ProviderSessionDirectory.ts";

export interface ProviderThreadSyncState {
  readonly latestMessageId: string | null;
  readonly latestCheckpointTurnId: string | null;
  readonly latestTurnId: string | null;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly syncedAt: string;
}

export interface ProviderSessionStartOptions {
  readonly resumeStrategy?: "prefer-persisted" | "fresh";
}

export interface ProviderSessionParkInput {
  readonly threadId: ThreadId;
  readonly provider: ProviderKind;
  readonly syncState?: ProviderThreadSyncState;
  readonly nextSlotState?: "parked" | "expired" | "stale" | "stopped";
}

/**
 * ProviderServiceShape - Service API for provider session and turn orchestration.
 */
export interface ProviderServiceShape {
  /**
   * Start a provider session.
   */
  readonly startSession: (
    threadId: ThreadId,
    input: ProviderSessionStartInput,
    options?: ProviderSessionStartOptions,
  ) => Effect.Effect<ProviderSession, ProviderServiceError>;

  /**
   * Park one provider slot for a thread.
   */
  readonly parkSession: (
    input: ProviderSessionParkInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Send a provider turn.
   */
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, ProviderServiceError>;

  /**
   * Interrupt a running provider turn.
   */
  readonly interruptTurn: (
    input: ProviderInterruptTurnInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Respond to a provider approval request.
   */
  readonly respondToRequest: (
    input: ProviderRespondToRequestInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Respond to a provider structured user-input request.
   */
  readonly respondToUserInput: (
    input: ProviderRespondToUserInputInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Stop a provider session.
   */
  readonly stopSession: (
    input: ProviderStopSessionInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * List active provider sessions.
   *
   * Aggregates runtime session lists from all registered adapters.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  /**
   * Read the active persisted binding for a thread.
   */
  readonly getBinding: (
    threadId: ThreadId,
  ) => Effect.Effect<ProviderRuntimeBinding | undefined, ProviderServiceError>;

  /**
   * Read a persisted provider slot for a thread/provider pair.
   */
  readonly getBindingForProvider: (
    threadId: ThreadId,
    provider: ProviderKind,
  ) => Effect.Effect<ProviderRuntimeBinding | undefined, ProviderServiceError>;

  /**
   * List all persisted provider slots for a thread.
   */
  readonly listBindingsByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<ProviderRuntimeBindingWithMetadata>, ProviderServiceError>;

  /**
   * Read static capabilities for a provider adapter.
   */
  readonly getCapabilities: (
    provider: ProviderKind,
  ) => Effect.Effect<ProviderAdapterCapabilities, ProviderServiceError>;

  /**
   * Roll back provider conversation state by a number of turns.
   */
  readonly rollbackConversation: (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Canonical provider runtime event stream.
   *
   * Fan-out is owned by ProviderService (not by a standalone event-bus service).
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}

/**
 * ProviderService - Service tag for provider orchestration.
 */
export class ProviderService extends Context.Service<ProviderService, ProviderServiceShape>()(
  "t3/provider/Services/ProviderService",
) {}
