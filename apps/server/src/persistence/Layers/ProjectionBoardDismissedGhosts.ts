import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { BoardDismissedGhost } from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteBoardDismissedGhostInput,
  ListBoardDismissedGhostsByProjectInput,
  ProjectionBoardDismissedGhostRepository,
  type ProjectionBoardDismissedGhostRepositoryShape,
} from "../Services/ProjectionBoardDismissedGhosts.ts";

const makeProjectionBoardDismissedGhostRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: BoardDismissedGhost,
    execute: (row) => sql`
      INSERT INTO projection_board_dismissed_ghosts (
        project_id,
        thread_id,
        dismissed_at
      )
      VALUES (
        ${row.projectId},
        ${row.threadId},
        ${row.dismissedAt}
      )
      ON CONFLICT (project_id, thread_id)
      DO UPDATE SET dismissed_at = excluded.dismissed_at
    `,
  });

  const listByProjectRows = SqlSchema.findAll({
    Request: ListBoardDismissedGhostsByProjectInput,
    Result: BoardDismissedGhost,
    execute: ({ projectId }) => sql`
      SELECT
        project_id AS "projectId",
        thread_id AS "threadId",
        dismissed_at AS "dismissedAt"
      FROM projection_board_dismissed_ghosts
      WHERE project_id = ${projectId}
      ORDER BY dismissed_at DESC
    `,
  });

  const deleteRow = SqlSchema.void({
    Request: DeleteBoardDismissedGhostInput,
    execute: ({ projectId, threadId }) => sql`
      DELETE FROM projection_board_dismissed_ghosts
      WHERE project_id = ${projectId} AND thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionBoardDismissedGhostRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionBoardDismissedGhostRepository.upsert:query"),
      ),
    );

  const listByProject: ProjectionBoardDismissedGhostRepositoryShape["listByProject"] = (input) =>
    listByProjectRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionBoardDismissedGhostRepository.listByProject:query"),
      ),
    );

  const deleteFn: ProjectionBoardDismissedGhostRepositoryShape["delete"] = (input) =>
    deleteRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionBoardDismissedGhostRepository.delete:query"),
      ),
    );

  return {
    upsert,
    listByProject,
    delete: deleteFn,
  } satisfies ProjectionBoardDismissedGhostRepositoryShape;
});

export const ProjectionBoardDismissedGhostRepositoryLive = Layer.effect(
  ProjectionBoardDismissedGhostRepository,
  makeProjectionBoardDismissedGhostRepository,
);
