import type {
  ProviderKind,
  ProviderSessionRuntimeStatus,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { Option, Context } from "effect";
import type { Effect } from "effect";

import type { ProviderSessionSlotState } from "../../persistence/Services/ProviderSessionRuntime.ts";
import type {
  ProviderSessionDirectoryPersistenceError,
  ProviderValidationError,
} from "../Errors.ts";

export interface ProviderRuntimeBinding {
  readonly threadId: ThreadId;
  readonly provider: ProviderKind;
  readonly adapterKey?: string;
  readonly status?: ProviderSessionRuntimeStatus;
  readonly slotState?: ProviderSessionSlotState;
  readonly resumeCursor?: unknown | null;
  readonly runtimePayload?: unknown | null;
  readonly runtimeMode?: RuntimeMode;
}

export interface ProviderRuntimeBindingWithMetadata extends ProviderRuntimeBinding {
  readonly lastSeenAt: string;
}

export type ProviderSessionDirectoryReadError = ProviderSessionDirectoryPersistenceError;

export type ProviderSessionDirectoryWriteError =
  | ProviderValidationError
  | ProviderSessionDirectoryPersistenceError;

export interface ProviderSessionDirectoryShape {
  readonly upsert: (
    binding: ProviderRuntimeBinding,
  ) => Effect.Effect<void, ProviderSessionDirectoryWriteError>;

  readonly getProvider: (
    threadId: ThreadId,
  ) => Effect.Effect<ProviderKind, ProviderSessionDirectoryReadError>;

  readonly getBinding: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProviderRuntimeBinding>, ProviderSessionDirectoryReadError>;

  readonly getBindingForProvider: (
    threadId: ThreadId,
    provider: ProviderKind,
  ) => Effect.Effect<Option.Option<ProviderRuntimeBinding>, ProviderSessionDirectoryReadError>;

  readonly listBindings: () => Effect.Effect<
    ReadonlyArray<ProviderRuntimeBindingWithMetadata>,
    ProviderSessionDirectoryReadError
  >;

  readonly listBindingsByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<
    ReadonlyArray<ProviderRuntimeBindingWithMetadata>,
    ProviderSessionDirectoryReadError
  >;

  readonly remove: (
    threadId: ThreadId,
  ) => Effect.Effect<void, ProviderSessionDirectoryPersistenceError>;

  readonly removeBinding: (
    threadId: ThreadId,
    provider: ProviderKind,
  ) => Effect.Effect<void, ProviderSessionDirectoryPersistenceError>;

  readonly listThreadIds: () => Effect.Effect<
    ReadonlyArray<ThreadId>,
    ProviderSessionDirectoryPersistenceError
  >;
}

export class ProviderSessionDirectory extends Context.Service<
  ProviderSessionDirectory,
  ProviderSessionDirectoryShape
>()("t3/provider/Services/ProviderSessionDirectory") {}
