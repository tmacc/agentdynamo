import { type ProviderKind, type ThreadId } from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";

import type { ProviderSessionRuntime } from "../../persistence/Services/ProviderSessionRuntime.ts";
import { ProviderSessionRuntimeRepository } from "../../persistence/Services/ProviderSessionRuntime.ts";
import { ProviderSessionDirectoryPersistenceError, ProviderValidationError } from "../Errors.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
  type ProviderRuntimeBindingWithMetadata,
  type ProviderSessionDirectoryShape,
} from "../Services/ProviderSessionDirectory.ts";

function toPersistenceError(operation: string) {
  return (cause: unknown) =>
    new ProviderSessionDirectoryPersistenceError({
      operation,
      detail: `Failed to execute ${operation}.`,
      cause,
    });
}

function decodeProviderKind(
  providerName: string,
  operation: string,
): Effect.Effect<ProviderKind, ProviderSessionDirectoryPersistenceError> {
  if (providerName === "codex" || providerName === "claudeAgent") {
    return Effect.succeed(providerName);
  }
  return Effect.fail(
    new ProviderSessionDirectoryPersistenceError({
      operation,
      detail: `Unknown persisted provider '${providerName}'.`,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeRuntimePayload(
  existing: unknown | null,
  next: unknown | null | undefined,
): unknown | null {
  if (next === undefined) {
    return existing ?? null;
  }
  if (isRecord(existing) && isRecord(next)) {
    return { ...existing, ...next };
  }
  return next;
}

function toRuntimeBinding(
  runtime: ProviderSessionRuntime,
  operation: string,
): Effect.Effect<ProviderRuntimeBindingWithMetadata, ProviderSessionDirectoryPersistenceError> {
  return decodeProviderKind(runtime.providerName, operation).pipe(
    Effect.map(
      (provider) =>
        ({
          threadId: runtime.threadId,
          provider,
          adapterKey: runtime.adapterKey,
          runtimeMode: runtime.runtimeMode,
          status: runtime.status,
          slotState: runtime.slotState,
          resumeCursor: runtime.resumeCursor,
          runtimePayload: runtime.runtimePayload,
          lastSeenAt: runtime.lastSeenAt,
        }) satisfies ProviderRuntimeBindingWithMetadata,
    ),
  );
}

const makeProviderSessionDirectory = Effect.gen(function* () {
  const repository = yield* ProviderSessionRuntimeRepository;

  const getBinding = (threadId: ThreadId) =>
    repository.getByThreadId({ threadId }).pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.getBinding:getByThreadId")),
      Effect.flatMap((runtime) =>
        Option.match(runtime, {
          onNone: () => Effect.succeed(Option.none<ProviderRuntimeBinding>()),
          onSome: (value) =>
            toRuntimeBinding(value, "ProviderSessionDirectory.getBinding").pipe(
              Effect.map((binding) => Option.some(binding)),
            ),
        }),
      ),
    );

  const getBindingForProvider = (threadId: ThreadId, provider: ProviderKind) =>
    repository.getByThreadIdAndProvider({ threadId, providerName: provider }).pipe(
      Effect.mapError(
        toPersistenceError(
          "ProviderSessionDirectory.getBindingForProvider:getByThreadIdAndProvider",
        ),
      ),
      Effect.flatMap((runtime) =>
        Option.match(runtime, {
          onNone: () => Effect.succeed(Option.none<ProviderRuntimeBinding>()),
          onSome: (value) =>
            toRuntimeBinding(value, "ProviderSessionDirectory.getBindingForProvider").pipe(
              Effect.map((binding) => Option.some(binding)),
            ),
        }),
      ),
    );

  const upsert: ProviderSessionDirectoryShape["upsert"] = Effect.fn(function* (binding) {
    const existing = yield* repository
      .getByThreadIdAndProvider({ threadId: binding.threadId, providerName: binding.provider })
      .pipe(
        Effect.mapError(
          toPersistenceError("ProviderSessionDirectory.upsert:getByThreadIdAndProvider"),
        ),
      );

    const existingRuntime = Option.getOrUndefined(existing);
    const resolvedThreadId = binding.threadId ?? existingRuntime?.threadId;
    if (!resolvedThreadId) {
      return yield* new ProviderValidationError({
        operation: "ProviderSessionDirectory.upsert",
        issue: "threadId must be a non-empty string.",
      });
    }

    const now = new Date().toISOString();
    const nextSlotState = binding.slotState ?? existingRuntime?.slotState ?? "active";
    if (nextSlotState === "active") {
      const existingBindings = yield* repository
        .listByThreadId({ threadId: resolvedThreadId })
        .pipe(
          Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:listByThreadId")),
        );
      yield* Effect.forEach(
        existingBindings,
        (runtime) =>
          runtime.providerName === binding.provider || runtime.slotState !== "active"
            ? Effect.void
            : repository
                .upsert({
                  ...runtime,
                  status: runtime.status === "error" ? "error" : "stopped",
                  slotState: runtime.status === "error" ? "error" : "parked",
                  lastSeenAt: now,
                })
                .pipe(
                  Effect.mapError(
                    toPersistenceError("ProviderSessionDirectory.upsert:deactivateExistingActive"),
                  ),
                ),
        { discard: true },
      );
    }
    yield* repository
      .upsert({
        threadId: resolvedThreadId,
        providerName: binding.provider,
        adapterKey: binding.adapterKey ?? existingRuntime?.adapterKey ?? binding.provider,
        runtimeMode: binding.runtimeMode ?? existingRuntime?.runtimeMode ?? "full-access",
        status: binding.status ?? existingRuntime?.status ?? "running",
        slotState: nextSlotState,
        lastSeenAt: now,
        resumeCursor:
          binding.resumeCursor !== undefined
            ? binding.resumeCursor
            : (existingRuntime?.resumeCursor ?? null),
        runtimePayload: mergeRuntimePayload(
          existingRuntime?.runtimePayload ?? null,
          binding.runtimePayload,
        ),
      })
      .pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:upsert")));
  });

  const getProvider: ProviderSessionDirectoryShape["getProvider"] = (threadId) =>
    getBinding(threadId).pipe(
      Effect.flatMap((binding) =>
        Option.match(binding, {
          onSome: (value) => Effect.succeed(value.provider),
          onNone: () =>
            Effect.fail(
              new ProviderSessionDirectoryPersistenceError({
                operation: "ProviderSessionDirectory.getProvider",
                detail: `No persisted provider binding found for thread '${threadId}'.`,
              }),
            ),
        }),
      ),
    );

  const listBindingsByThreadId: ProviderSessionDirectoryShape["listBindingsByThreadId"] = (
    threadId,
  ) =>
    repository.listByThreadId({ threadId }).pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.listBindingsByThreadId:list")),
      Effect.flatMap((rows) =>
        Effect.forEach(
          rows,
          (row) => toRuntimeBinding(row, "ProviderSessionDirectory.listBindingsByThreadId"),
          { concurrency: "unbounded" },
        ),
      ),
    );

  const remove: ProviderSessionDirectoryShape["remove"] = (threadId) =>
    repository
      .deleteByThreadId({ threadId })
      .pipe(
        Effect.mapError(toPersistenceError("ProviderSessionDirectory.remove:deleteByThreadId")),
      );

  const removeBinding: ProviderSessionDirectoryShape["removeBinding"] = (threadId, provider) =>
    repository
      .deleteByThreadIdAndProvider({ threadId, providerName: provider })
      .pipe(
        Effect.mapError(
          toPersistenceError("ProviderSessionDirectory.removeBinding:deleteByThreadIdAndProvider"),
        ),
      );

  const listThreadIds: ProviderSessionDirectoryShape["listThreadIds"] = () =>
    repository.list().pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.listThreadIds:list")),
      Effect.map((rows) => [...new Set(rows.map((row) => row.threadId))]),
    );

  const listBindings: ProviderSessionDirectoryShape["listBindings"] = () =>
    repository.list().pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.listBindings:list")),
      Effect.flatMap((rows) =>
        Effect.forEach(
          rows,
          (row) => toRuntimeBinding(row, "ProviderSessionDirectory.listBindings"),
          { concurrency: "unbounded" },
        ),
      ),
    );

  return {
    upsert,
    getProvider,
    getBinding,
    getBindingForProvider,
    listBindings,
    listBindingsByThreadId,
    remove,
    removeBinding,
    listThreadIds,
  } satisfies ProviderSessionDirectoryShape;
});

export const ProviderSessionDirectoryLive = Layer.effect(
  ProviderSessionDirectory,
  makeProviderSessionDirectory,
);

export function makeProviderSessionDirectoryLive() {
  return Layer.effect(ProviderSessionDirectory, makeProviderSessionDirectory);
}
