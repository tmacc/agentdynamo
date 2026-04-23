import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ListProjectionThreadContextHandoffsByThreadInput,
  MarkProjectionThreadContextHandoffDeliveredInput,
  MarkProjectionThreadContextHandoffDeliveryFailedInput,
  ProjectionThreadContextHandoff,
  ProjectionThreadContextHandoffRepository,
  type ProjectionThreadContextHandoffRepositoryShape,
} from "../Services/ProjectionThreadContextHandoffs.ts";
import { OrchestrationContextHandoffRenderStats } from "@t3tools/contracts";

const ProjectionThreadContextHandoffDbRow = ProjectionThreadContextHandoff.mapFields(
  Struct.assign({
    renderStats: Schema.NullOr(Schema.fromJsonString(OrchestrationContextHandoffRenderStats)),
  }),
);

const makeProjectionThreadContextHandoffRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertPreparedRow = SqlSchema.void({
    Request: ProjectionThreadContextHandoff,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_context_handoffs (
          handoff_id,
          thread_id,
          reason,
          source_thread_id,
          source_thread_title,
          source_user_message_id,
          source_provider,
          target_provider,
          imported_until_at,
          created_at,
          delivered_at,
          delivered_provider,
          delivered_turn_id,
          delivered_live_message_id,
          last_failure_at,
          last_failure_detail,
          render_stats_json
        )
        VALUES (
          ${row.handoffId},
          ${row.threadId},
          ${row.reason},
          ${row.sourceThreadId},
          ${row.sourceThreadTitle},
          ${row.sourceUserMessageId},
          ${row.sourceProvider},
          ${row.targetProvider},
          ${row.importedUntilAt},
          ${row.createdAt},
          ${row.deliveredAt},
          ${row.deliveredProvider},
          ${row.deliveredTurnId},
          ${row.deliveredLiveMessageId},
          ${row.lastFailureAt},
          ${row.lastFailureDetail},
          ${row.renderStats === null ? null : JSON.stringify(row.renderStats)}
        )
        ON CONFLICT (handoff_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          reason = excluded.reason,
          source_thread_id = excluded.source_thread_id,
          source_thread_title = excluded.source_thread_title,
          source_user_message_id = excluded.source_user_message_id,
          source_provider = excluded.source_provider,
          target_provider = excluded.target_provider,
          imported_until_at = excluded.imported_until_at,
          created_at = excluded.created_at
      `,
  });

  const markDeliveredRow = SqlSchema.void({
    Request: MarkProjectionThreadContextHandoffDeliveredInput,
    execute: (row) =>
      sql`
        UPDATE projection_thread_context_handoffs
        SET
          delivered_at = ${row.deliveredAt},
          delivered_provider = ${row.provider},
          delivered_turn_id = ${row.turnId},
          delivered_live_message_id = ${row.liveMessageId},
          render_stats_json = ${JSON.stringify(row.renderStats)}
        WHERE handoff_id = ${row.handoffId}
          AND thread_id = ${row.threadId}
      `,
  });

  const markDeliveryFailedRow = SqlSchema.void({
    Request: MarkProjectionThreadContextHandoffDeliveryFailedInput,
    execute: (row) =>
      sql`
        UPDATE projection_thread_context_handoffs
        SET
          last_failure_at = ${row.failedAt},
          last_failure_detail = ${row.detail},
          render_stats_json = ${row.renderStats === null ? null : JSON.stringify(row.renderStats)}
        WHERE handoff_id = ${row.handoffId}
          AND thread_id = ${row.threadId}
      `,
  });

  const listRowsByThread = SqlSchema.findAll({
    Request: ListProjectionThreadContextHandoffsByThreadInput,
    Result: ProjectionThreadContextHandoffDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          handoff_id AS "handoffId",
          thread_id AS "threadId",
          reason,
          source_thread_id AS "sourceThreadId",
          source_thread_title AS "sourceThreadTitle",
          source_user_message_id AS "sourceUserMessageId",
          source_provider AS "sourceProvider",
          target_provider AS "targetProvider",
          imported_until_at AS "importedUntilAt",
          created_at AS "createdAt",
          delivered_at AS "deliveredAt",
          delivered_provider AS "deliveredProvider",
          delivered_turn_id AS "deliveredTurnId",
          delivered_live_message_id AS "deliveredLiveMessageId",
          last_failure_at AS "lastFailureAt",
          last_failure_detail AS "lastFailureDetail",
          render_stats_json AS "renderStats"
        FROM projection_thread_context_handoffs
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, handoff_id ASC
      `,
  });

  const getPendingRowByThread = SqlSchema.findOneOption({
    Request: ListProjectionThreadContextHandoffsByThreadInput,
    Result: ProjectionThreadContextHandoffDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          handoff_id AS "handoffId",
          thread_id AS "threadId",
          reason,
          source_thread_id AS "sourceThreadId",
          source_thread_title AS "sourceThreadTitle",
          source_user_message_id AS "sourceUserMessageId",
          source_provider AS "sourceProvider",
          target_provider AS "targetProvider",
          imported_until_at AS "importedUntilAt",
          created_at AS "createdAt",
          delivered_at AS "deliveredAt",
          delivered_provider AS "deliveredProvider",
          delivered_turn_id AS "deliveredTurnId",
          delivered_live_message_id AS "deliveredLiveMessageId",
          last_failure_at AS "lastFailureAt",
          last_failure_detail AS "lastFailureDetail",
          render_stats_json AS "renderStats"
        FROM projection_thread_context_handoffs
        WHERE thread_id = ${threadId}
          AND delivered_at IS NULL
        ORDER BY created_at ASC, handoff_id ASC
        LIMIT 1
      `,
  });

  const upsertPrepared: ProjectionThreadContextHandoffRepositoryShape["upsertPrepared"] = (row) =>
    upsertPreparedRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadContextHandoffRepository.upsertPrepared:query"),
      ),
    );

  const markDelivered: ProjectionThreadContextHandoffRepositoryShape["markDelivered"] = (input) =>
    markDeliveredRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadContextHandoffRepository.markDelivered:query"),
      ),
    );

  const markDeliveryFailed: ProjectionThreadContextHandoffRepositoryShape["markDeliveryFailed"] = (
    input,
  ) =>
    markDeliveryFailedRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadContextHandoffRepository.markDeliveryFailed:query"),
      ),
    );

  const listByThreadId: ProjectionThreadContextHandoffRepositoryShape["listByThreadId"] = (input) =>
    listRowsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadContextHandoffRepository.listByThreadId:query"),
      ),
    );

  const getPendingByThreadId: ProjectionThreadContextHandoffRepositoryShape["getPendingByThreadId"] =
    (input) =>
      getPendingRowByThread(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionThreadContextHandoffRepository.getPendingByThreadId:query",
          ),
        ),
        Effect.map((row) => (Option.isSome(row) ? Option.some(row.value) : Option.none())),
      );

  return {
    upsertPrepared,
    markDelivered,
    markDeliveryFailed,
    listByThreadId,
    getPendingByThreadId,
  } satisfies ProjectionThreadContextHandoffRepositoryShape;
});

export const ProjectionThreadContextHandoffRepositoryLive = Layer.effect(
  ProjectionThreadContextHandoffRepository,
  makeProjectionThreadContextHandoffRepository,
);
