import type { ReviewCancelInput, ReviewStartInput, ReviewState } from "@t3tools/contracts";
import { Context, Effect } from "effect";

export interface ReviewOrchestratorShape {
  readonly start: (input: ReviewStartInput) => Effect.Effect<ReviewState, Error>;
  readonly cancel: (input: ReviewCancelInput) => Effect.Effect<ReviewState, Error>;
  readonly getResult: (threadId: ReviewStartInput["threadId"]) => Effect.Effect<ReviewState | null>;
}

export class ReviewOrchestrator extends Context.Service<
  ReviewOrchestrator,
  ReviewOrchestratorShape
>()("t3/review/Services/ReviewOrchestrator") {}
