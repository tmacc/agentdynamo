import ensureProjectionThreadReviewState from "./049_ProjectionThreadReviewState.ts";

// Existing local Dynamo databases may already contain migration ids 46-48 from
// prior fork states. Re-run the idempotent review-state DDL at a higher id so
// those databases get the column without manual migration receipt cleanup.
export default ensureProjectionThreadReviewState;
