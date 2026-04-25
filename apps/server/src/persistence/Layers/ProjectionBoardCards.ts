import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { FeatureCard } from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionBoardCardInput,
  GetProjectionBoardCardByLinkedThreadInput,
  GetProjectionBoardCardInput,
  ListProjectionBoardCardsByProjectInput,
  ProjectionBoardCardRepository,
  type ProjectionBoardCardRepositoryShape,
} from "../Services/ProjectionBoardCards.ts";

const SELECT_COLUMNS = `
  card_id AS "id",
  project_id AS "projectId",
  title,
  description,
  seeded_prompt AS "seededPrompt",
  column_name AS "column",
  sort_order AS "sortOrder",
  linked_thread_id AS "linkedThreadId",
  linked_proposed_plan_id AS "linkedProposedPlanId",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  archived_at AS "archivedAt"
`;

const makeProjectionBoardCardRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: FeatureCard,
    execute: (row) => sql`
      INSERT INTO projection_board_cards (
        card_id,
        project_id,
        title,
        description,
        seeded_prompt,
        column_name,
        sort_order,
        linked_thread_id,
        linked_proposed_plan_id,
        created_at,
        updated_at,
        archived_at
      )
      VALUES (
        ${row.id},
        ${row.projectId},
        ${row.title},
        ${row.description},
        ${row.seededPrompt},
        ${row.column},
        ${row.sortOrder},
        ${row.linkedThreadId},
        ${row.linkedProposedPlanId},
        ${row.createdAt},
        ${row.updatedAt},
        ${row.archivedAt}
      )
      ON CONFLICT (card_id)
      DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        description = excluded.description,
        seeded_prompt = excluded.seeded_prompt,
        column_name = excluded.column_name,
        sort_order = excluded.sort_order,
        linked_thread_id = excluded.linked_thread_id,
        linked_proposed_plan_id = excluded.linked_proposed_plan_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at
    `,
  });

  const getByIdRow = SqlSchema.findOneOption({
    Request: GetProjectionBoardCardInput,
    Result: FeatureCard,
    execute: ({ cardId }) => sql`
      SELECT ${sql.unsafe(SELECT_COLUMNS)}
      FROM projection_board_cards
      WHERE card_id = ${cardId}
    `,
  });

  const getByLinkedThreadRow = SqlSchema.findOneOption({
    Request: GetProjectionBoardCardByLinkedThreadInput,
    Result: FeatureCard,
    execute: ({ linkedThreadId }) => sql`
      SELECT ${sql.unsafe(SELECT_COLUMNS)}
      FROM projection_board_cards
      WHERE linked_thread_id = ${linkedThreadId}
        AND archived_at IS NULL
    `,
  });

  const listByProjectRows = SqlSchema.findAll({
    Request: ListProjectionBoardCardsByProjectInput,
    Result: FeatureCard,
    execute: ({ projectId }) => sql`
      SELECT ${sql.unsafe(SELECT_COLUMNS)}
      FROM projection_board_cards
      WHERE project_id = ${projectId}
      ORDER BY sort_order ASC, created_at ASC, card_id ASC
    `,
  });

  const deleteByIdRow = SqlSchema.void({
    Request: DeleteProjectionBoardCardInput,
    execute: ({ cardId }) => sql`
      DELETE FROM projection_board_cards WHERE card_id = ${cardId}
    `,
  });

  const upsert: ProjectionBoardCardRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBoardCardRepository.upsert:query")),
    );

  const getById: ProjectionBoardCardRepositoryShape["getById"] = (input) =>
    getByIdRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBoardCardRepository.getById:query")),
    );

  const getByLinkedThreadId: ProjectionBoardCardRepositoryShape["getByLinkedThreadId"] = (input) =>
    getByLinkedThreadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionBoardCardRepository.getByLinkedThreadId:query"),
      ),
    );

  const listByProject: ProjectionBoardCardRepositoryShape["listByProject"] = (input) =>
    listByProjectRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBoardCardRepository.listByProject:query")),
    );

  const deleteById: ProjectionBoardCardRepositoryShape["deleteById"] = (input) =>
    deleteByIdRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBoardCardRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    getByLinkedThreadId,
    listByProject,
    deleteById,
  } satisfies ProjectionBoardCardRepositoryShape;
});

export const ProjectionBoardCardRepositoryLive = Layer.effect(
  ProjectionBoardCardRepository,
  makeProjectionBoardCardRepository,
);
