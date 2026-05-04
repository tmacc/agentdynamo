import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import type { ModelSelection } from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ProviderOptionSelections } from "./model.ts";

const ReviewProviderKind = Schema.Literals(["codex", "claudeAgent", "cursor", "opencode"]);
const ReviewModelSelectionSchema = Schema.Struct({
  provider: ReviewProviderKind,
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optional(ProviderOptionSelections),
});
const ReviewTeamTaskId = TrimmedNonEmptyString.pipe(Schema.brand("TeamTaskId"));
type ReviewModelSelection = ModelSelection & {
  readonly provider: typeof ReviewProviderKind.Type;
};

export const ReviewTier = Schema.Literals(["multi", "single-claude", "single-codex", "none"]);
export type ReviewTier = typeof ReviewTier.Type;

export const ReviewStepKind = Schema.Literals(["map", "bug-hunt", "style", "verify"]);
export type ReviewStepKind = typeof ReviewStepKind.Type;

export const ReviewPromptFlavor = Schema.Literals(["anthropic", "openai"]);
export type ReviewPromptFlavor = typeof ReviewPromptFlavor.Type;

export const ReviewFindingSeverity = Schema.Literals(["high", "medium", "low"]);
export type ReviewFindingSeverity = typeof ReviewFindingSeverity.Type;

export const ReviewFindingKind = TrimmedNonEmptyString;
export type ReviewFindingKind = typeof ReviewFindingKind.Type;

export const ReviewFindingVerifier = Schema.Struct({
  provider: ReviewProviderKind,
  model: TrimmedNonEmptyString,
  reproduced: Schema.Boolean,
  evidence: Schema.String,
  taskId: Schema.optional(ReviewTeamTaskId),
});
export type ReviewFindingVerifier = typeof ReviewFindingVerifier.Type;

export const ReviewFinding = Schema.Struct({
  id: TrimmedNonEmptyString,
  file: TrimmedNonEmptyString,
  lineStart: PositiveInt,
  lineEnd: PositiveInt,
  severity: ReviewFindingSeverity,
  kind: ReviewFindingKind,
  summary: TrimmedNonEmptyString,
  reasoning: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.String),
  sourceStep: ReviewStepKind,
  sourceTaskId: Schema.optional(ReviewTeamTaskId),
  verified: Schema.Boolean,
  verifier: Schema.NullOr(ReviewFindingVerifier),
});
export type ReviewFinding = typeof ReviewFinding.Type;

export const ReviewStep = Schema.Struct({
  kind: ReviewStepKind,
  title: TrimmedNonEmptyString,
  roleLabel: TrimmedNonEmptyString,
  promptFlavor: ReviewPromptFlavor,
  primary: ReviewModelSelectionSchema,
});
export type ReviewStep = Omit<typeof ReviewStep.Type, "primary"> & {
  readonly primary: ReviewModelSelection;
};

export const ReviewPreset = Schema.Struct({
  tier: ReviewTier,
  label: TrimmedNonEmptyString,
  steps: Schema.Array(ReviewStep),
  verifier: ReviewModelSelectionSchema,
});
export type ReviewPreset = Omit<typeof ReviewPreset.Type, "steps" | "verifier"> & {
  readonly steps: ReadonlyArray<ReviewStep>;
  readonly verifier: ReviewModelSelection;
};

export const ReviewResult = Schema.Struct({
  threadId: ThreadId,
  tier: ReviewTier,
  label: TrimmedNonEmptyString,
  prNumber: Schema.NullOr(NonNegativeInt),
  prTitle: Schema.NullOr(Schema.String),
  baseRef: Schema.NullOr(Schema.String),
  headRef: Schema.NullOr(Schema.String),
  findings: Schema.Array(ReviewFinding),
  droppedFindingCount: NonNegativeInt,
  completedAt: IsoDateTime,
});
export type ReviewResult = typeof ReviewResult.Type;

export const ReviewStartInput = Schema.Struct({
  threadId: ThreadId,
  prRef: Schema.optional(TrimmedNonEmptyString),
});
export type ReviewStartInput = typeof ReviewStartInput.Type;

export const ReviewCancelInput = Schema.Struct({
  threadId: ThreadId,
});
export type ReviewCancelInput = typeof ReviewCancelInput.Type;

export const ReviewRunStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type ReviewRunStatus = typeof ReviewRunStatus.Type;

export const ReviewState = Schema.Struct({
  status: ReviewRunStatus,
  tier: ReviewTier,
  label: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  prRef: Schema.NullOr(TrimmedNonEmptyString),
  prNumber: Schema.NullOr(NonNegativeInt),
  prTitle: Schema.NullOr(Schema.String),
  baseRef: Schema.NullOr(Schema.String),
  headRef: Schema.NullOr(Schema.String),
  findings: Schema.Array(ReviewFinding),
  droppedFindingCount: NonNegativeInt,
  errorText: Schema.NullOr(Schema.String),
  taskIds: Schema.Array(ReviewTeamTaskId),
});
export type ReviewState = typeof ReviewState.Type;
