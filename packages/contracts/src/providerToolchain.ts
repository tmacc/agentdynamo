import { Effect, Schema } from "effect";
import { ProviderKind } from "./orchestration.ts";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ProviderToolchainKind = Schema.Literals(["codex", "claudeAgent"]);
export type ProviderToolchainKind = typeof ProviderToolchainKind.Type;

export const ProviderToolchainCheckState = Schema.Literals([
  "idle",
  "checking",
  "up-to-date",
  "update-available",
  "unknown",
  "error",
]);
export type ProviderToolchainCheckState = typeof ProviderToolchainCheckState.Type;

export const ProviderToolchainUpdateState = Schema.Literals([
  "idle",
  "updating",
  "updated",
  "error",
]);
export type ProviderToolchainUpdateState = typeof ProviderToolchainUpdateState.Type;

export const ProviderToolchainUpdateMethodKind = Schema.Literals(["self-updater", "manual"]);
export type ProviderToolchainUpdateMethodKind = typeof ProviderToolchainUpdateMethodKind.Type;

export const ProviderToolchainUpdateMethod = Schema.Struct({
  kind: ProviderToolchainUpdateMethodKind,
  label: TrimmedNonEmptyString,
  displayCommand: TrimmedNonEmptyString,
  canRunInDynamo: Schema.Boolean,
});
export type ProviderToolchainUpdateMethod = typeof ProviderToolchainUpdateMethod.Type;

export const ProviderToolchainStatus = Schema.Struct({
  provider: ProviderToolchainKind,
  currentVersion: Schema.NullOr(TrimmedNonEmptyString),
  latestVersion: Schema.NullOr(TrimmedNonEmptyString),
  updateAvailable: Schema.NullOr(Schema.Boolean),
  checkState: ProviderToolchainCheckState,
  updateState: ProviderToolchainUpdateState,
  method: Schema.NullOr(ProviderToolchainUpdateMethod),
  checkedAt: Schema.NullOr(IsoDateTime),
  updatedAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProviderToolchainStatus = typeof ProviderToolchainStatus.Type;

export const ProviderToolchainStatuses = Schema.Array(ProviderToolchainStatus);
export type ProviderToolchainStatuses = typeof ProviderToolchainStatuses.Type;

export const ProviderToolchainCheckInput = Schema.Struct({
  provider: Schema.optional(ProviderToolchainKind),
  force: Schema.optional(Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false)))),
});
export type ProviderToolchainCheckInput = typeof ProviderToolchainCheckInput.Type;

export const ProviderToolchainUpdateInput = Schema.Struct({
  provider: ProviderToolchainKind,
});
export type ProviderToolchainUpdateInput = typeof ProviderToolchainUpdateInput.Type;

export const ProviderToolchainSnapshot = Schema.Struct({
  statuses: ProviderToolchainStatuses,
});
export type ProviderToolchainSnapshot = typeof ProviderToolchainSnapshot.Type;

export class ProviderToolchainError extends Schema.TaggedErrorClass<ProviderToolchainError>()(
  "ProviderToolchainError",
  {
    provider: ProviderKind,
    message: TrimmedNonEmptyString,
  },
) {}
