import { Schema } from "effect";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const BrowserSessionId = TrimmedNonEmptyString.pipe(Schema.brand("BrowserSessionId"));
export type BrowserSessionId = typeof BrowserSessionId.Type;

export const BrowserGrantId = TrimmedNonEmptyString.pipe(Schema.brand("BrowserGrantId"));
export type BrowserGrantId = typeof BrowserGrantId.Type;

export const BrowserLeaseId = TrimmedNonEmptyString.pipe(Schema.brand("BrowserLeaseId"));
export type BrowserLeaseId = typeof BrowserLeaseId.Type;

export const BrowserSessionStatus = Schema.Literals([
  "starting",
  "ready",
  "running",
  "idle",
  "unavailable",
  "error",
  "closed",
]);
export type BrowserSessionStatus = typeof BrowserSessionStatus.Type;

export const BrowserViewport = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  label: Schema.optional(Schema.String),
});
export type BrowserViewport = typeof BrowserViewport.Type;

export const BrowserSession = Schema.Struct({
  id: BrowserSessionId,
  threadId: ThreadId,
  status: BrowserSessionStatus,
  currentUrl: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  viewport: BrowserViewport,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(Schema.String),
});
export type BrowserSession = typeof BrowserSession.Type;

export const BrowserGraphNode = Schema.Struct({
  ref: TrimmedNonEmptyString,
  role: Schema.String,
  name: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  tagName: Schema.String,
  bbox: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
  visible: Schema.Boolean,
  interactable: Schema.Boolean,
  disabled: Schema.Boolean,
  viewport: Schema.Literals(["in", "above", "below", "left", "right"]),
  owner: Schema.Struct({
    route: Schema.optional(Schema.String),
    dialog: Schema.optional(Schema.String),
    form: Schema.optional(Schema.String),
    region: Schema.optional(Schema.String),
  }),
  salience: Schema.Number,
  changedSinceLastSnapshot: Schema.Boolean,
  lastActionResult: Schema.optional(
    Schema.Literals(["none", "success", "no-op", "navigation", "error"]),
  ),
});
export type BrowserGraphNode = typeof BrowserGraphNode.Type;

export const BrowserGraphEdge = Schema.Struct({
  fromRef: TrimmedNonEmptyString,
  action: Schema.Literals(["click", "type", "select", "navigate"]),
  toStateId: Schema.optional(Schema.String),
  confidence: Schema.Number,
  observed: Schema.Boolean,
});
export type BrowserGraphEdge = typeof BrowserGraphEdge.Type;

export const BrowserObservation = Schema.Struct({
  id: TrimmedNonEmptyString,
  type: Schema.String,
  fact: Schema.String,
  refs: Schema.Array(TrimmedNonEmptyString),
  evidenceIds: Schema.Array(TrimmedNonEmptyString),
});
export type BrowserObservation = typeof BrowserObservation.Type;

export const BrowserFrictionHypothesis = Schema.Struct({
  severity: Schema.Literals(["low", "medium", "high"]),
  moment: Schema.String,
  claim: Schema.String,
  basedOnObservations: Schema.Array(TrimmedNonEmptyString),
  repro: Schema.Array(Schema.String),
});
export type BrowserFrictionHypothesis = typeof BrowserFrictionHypothesis.Type;

export const BrowserDecisionNeeded = Schema.Struct({
  reason: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      ref: TrimmedNonEmptyString,
      confidence: Schema.Number,
    }),
  ),
  currentStateSummary: Schema.String,
});
export type BrowserDecisionNeeded = typeof BrowserDecisionNeeded.Type;

export const BrowserExperienceResult = Schema.Struct({
  outcome: Schema.Literals([
    "completed",
    "completed_with_friction",
    "decision_needed",
    "failed",
  ]),
  summary: Schema.String,
  confidence: Schema.Number,
  observations: Schema.Array(BrowserObservation),
  frictionHypotheses: Schema.Array(BrowserFrictionHypothesis),
  objectiveSignals: Schema.Struct({
    deadClicks: Schema.Number,
    layoutShifts: Schema.Number,
    failedRequests: Schema.Number,
    horizontalOverflow: Schema.Number,
  }),
  decisionNeeded: Schema.NullOr(BrowserDecisionNeeded),
});
export type BrowserExperienceResult = typeof BrowserExperienceResult.Type;
