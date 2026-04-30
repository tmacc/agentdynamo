import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionBoardCardRepositoryLive } from "../../persistence/Layers/ProjectionBoardCards.ts";
import { ProjectionBoardDismissedGhostRepositoryLive } from "../../persistence/Layers/ProjectionBoardDismissedGhosts.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { ProjectionBoardCardRepository } from "../../persistence/Services/ProjectionBoardCards.ts";
import { ProjectionBoardDismissedGhostRepository } from "../../persistence/Services/ProjectionBoardDismissedGhosts.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import {
  ProjectionBoardSnapshotQuery,
  type ProjectionBoardSnapshotQueryShape,
} from "../Services/ProjectionBoardSnapshotQuery.ts";

const BOARD_CARDS_PROJECTOR = "projection.board-cards";
const BOARD_DISMISSED_GHOSTS_PROJECTOR = "projection.board-dismissed-ghosts";

const makeProjectionBoardSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const cards = yield* ProjectionBoardCardRepository;
  const dismissedGhosts = yield* ProjectionBoardDismissedGhostRepository;
  const projectionState = yield* ProjectionStateRepository;

  const getProjectSnapshot: ProjectionBoardSnapshotQueryShape["getProjectSnapshot"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [projectCards, projectDismissedGhosts, cardState, dismissedGhostState] =
            yield* Effect.all([
              cards.listByProject({ projectId: input.projectId }),
              dismissedGhosts.listByProject({ projectId: input.projectId }),
              projectionState.getByProjector({ projector: BOARD_CARDS_PROJECTOR }),
              projectionState.getByProjector({ projector: BOARD_DISMISSED_GHOSTS_PROJECTOR }),
            ]);
          const cardSequence = Option.match(cardState, {
            onNone: () => 0,
            onSome: (state) => state.lastAppliedSequence,
          });
          const dismissedGhostSequence = Option.match(dismissedGhostState, {
            onNone: () => 0,
            onSome: (state) => state.lastAppliedSequence,
          });
          return {
            cards: projectCards,
            dismissedGhosts: projectDismissedGhosts,
            cardSequence,
            dismissedGhostSequence,
            snapshotSequence: Math.min(cardSequence, dismissedGhostSequence),
          };
        }),
      )
      .pipe(
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(
            toPersistenceSqlError("ProjectionBoardSnapshotQuery.getProjectSnapshot:transaction")(
              sqlError,
            ),
          ),
        ),
      );

  return {
    getProjectSnapshot,
  } satisfies ProjectionBoardSnapshotQueryShape;
});

export const ProjectionBoardSnapshotQueryLive = Layer.effect(
  ProjectionBoardSnapshotQuery,
  makeProjectionBoardSnapshotQuery,
).pipe(
  Layer.provideMerge(ProjectionBoardCardRepositoryLive),
  Layer.provideMerge(ProjectionBoardDismissedGhostRepositoryLive),
  Layer.provideMerge(ProjectionStateRepositoryLive),
);
