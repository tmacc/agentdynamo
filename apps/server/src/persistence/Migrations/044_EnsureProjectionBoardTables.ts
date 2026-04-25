import createProjectionBoardCards from "./026_ProjectionBoardCards.ts";
import createProjectionBoardDismissedGhosts from "./027_ProjectionBoardDismissedGhosts.ts";
import * as Effect from "effect/Effect";

// Existing Dynamo databases may already contain migration ids above 27 from a
// prior fork state. Re-run the idempotent board DDL at a higher id so those
// databases get the tables and indexes without manual migration receipt cleanup.
export default Effect.gen(function* () {
  yield* createProjectionBoardCards;
  yield* createProjectionBoardDismissedGhosts;
});
