import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ListProjectionNativeSubagentTraceByTaskInput,
  MarkProjectionNativeSubagentTraceItemCompletedInput,
  ProjectionNativeSubagentTraceItem,
  ProjectionNativeSubagentTraceRepository,
  type ProjectionNativeSubagentTraceRepositoryShape,
} from "../Services/ProjectionNativeSubagentTrace.ts";

const MAX_TRACE_TEXT_CHARS = 64_000;
const TRUNCATED_SUFFIX = "...[truncated]";

const ProjectionNativeSubagentTraceDbRow = ProjectionNativeSubagentTraceItem;
type ProjectionNativeSubagentTraceDbRow = typeof ProjectionNativeSubagentTraceDbRow.Type;

const selectColumns = `
  trace_item_id AS "id",
  parent_thread_id AS "parentThreadId",
  task_id AS "taskId",
  provider,
  provider_thread_id AS "providerThreadId",
  provider_turn_id AS "providerTurnId",
  provider_item_id AS "providerItemId",
  provider_tool_use_id AS "providerToolUseId",
  kind,
  status,
  title,
  detail,
  text,
  tool_name AS "toolName",
  input_summary AS "inputSummary",
  output_summary AS "outputSummary",
  sequence,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  completed_at AS "completedAt"
`;

function appendCapped(existing: string | null, delta: string): string {
  const next = `${existing ?? ""}${delta}`;
  if (next.length <= MAX_TRACE_TEXT_CHARS) return next;
  return `${next.slice(0, MAX_TRACE_TEXT_CHARS - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`;
}

const makeProjectionNativeSubagentTraceRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionNativeSubagentTraceItem,
    execute: (row) =>
      sql`
        INSERT INTO projection_native_subagent_trace_items (
          parent_thread_id,
          task_id,
          trace_item_id,
          provider,
          provider_thread_id,
          provider_turn_id,
          provider_item_id,
          provider_tool_use_id,
          kind,
          status,
          title,
          detail,
          text,
          tool_name,
          input_summary,
          output_summary,
          sequence,
          created_at,
          updated_at,
          completed_at
        )
        VALUES (
          ${row.parentThreadId},
          ${row.taskId},
          ${row.id},
          ${row.provider},
          ${row.providerThreadId},
          ${row.providerTurnId},
          ${row.providerItemId},
          ${row.providerToolUseId},
          ${row.kind},
          ${row.status},
          ${row.title},
          ${row.detail},
          ${row.text},
          ${row.toolName},
          ${row.inputSummary},
          ${row.outputSummary},
          ${row.sequence},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.completedAt}
        )
        ON CONFLICT (task_id, trace_item_id)
        DO UPDATE SET
          parent_thread_id = excluded.parent_thread_id,
          provider = excluded.provider,
          provider_thread_id = excluded.provider_thread_id,
          provider_turn_id = excluded.provider_turn_id,
          provider_item_id = excluded.provider_item_id,
          provider_tool_use_id = excluded.provider_tool_use_id,
          kind = excluded.kind,
          status = excluded.status,
          title = COALESCE(excluded.title, projection_native_subagent_trace_items.title),
          detail = COALESCE(excluded.detail, projection_native_subagent_trace_items.detail),
          text = COALESCE(projection_native_subagent_trace_items.text, excluded.text),
          tool_name = COALESCE(excluded.tool_name, projection_native_subagent_trace_items.tool_name),
          input_summary = COALESCE(excluded.input_summary, projection_native_subagent_trace_items.input_summary),
          output_summary = COALESCE(excluded.output_summary, projection_native_subagent_trace_items.output_summary),
          sequence = MIN(projection_native_subagent_trace_items.sequence, excluded.sequence),
          updated_at = excluded.updated_at,
          completed_at = COALESCE(excluded.completed_at, projection_native_subagent_trace_items.completed_at)
      `,
  });

  const getById = SqlSchema.findOneOption({
    Request: Schema.Struct({
      taskId: ProjectionNativeSubagentTraceItem.fields.taskId,
      traceItemId: ProjectionNativeSubagentTraceItem.fields.id,
    }),
    Result: ProjectionNativeSubagentTraceDbRow,
    execute: ({ taskId, traceItemId }) =>
      sql`
        SELECT ${sql.unsafe(selectColumns)}
        FROM projection_native_subagent_trace_items
        WHERE task_id = ${taskId} AND trace_item_id = ${traceItemId}
      `,
  });

  const updateText = SqlSchema.void({
    Request: Schema.Struct({
      taskId: ProjectionNativeSubagentTraceItem.fields.taskId,
      traceItemId: ProjectionNativeSubagentTraceItem.fields.id,
      text: Schema.String,
      updatedAt: ProjectionNativeSubagentTraceItem.fields.updatedAt,
    }),
    execute: ({ taskId, traceItemId, text, updatedAt }) =>
      sql`
        UPDATE projection_native_subagent_trace_items
        SET text = ${text}, updated_at = ${updatedAt}
        WHERE task_id = ${taskId} AND trace_item_id = ${traceItemId}
      `,
  });

  const updateCompleted = SqlSchema.void({
    Request: MarkProjectionNativeSubagentTraceItemCompletedInput,
    execute: ({ taskId, traceItemId, status, detail, outputSummary, completedAt, updatedAt }) =>
      sql`
        UPDATE projection_native_subagent_trace_items
        SET
          status = ${status},
          detail = COALESCE(${detail ?? null}, detail),
          output_summary = COALESCE(${outputSummary ?? null}, output_summary),
          completed_at = ${completedAt},
          updated_at = ${updatedAt}
        WHERE task_id = ${taskId} AND trace_item_id = ${traceItemId}
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: ListProjectionNativeSubagentTraceByTaskInput,
    Result: ProjectionNativeSubagentTraceDbRow,
    execute: ({ parentThreadId, taskId, limit }) =>
      sql`
        SELECT ${sql.unsafe(selectColumns)}
        FROM projection_native_subagent_trace_items
        WHERE parent_thread_id = ${parentThreadId} AND task_id = ${taskId}
        ORDER BY sequence ASC, created_at ASC, trace_item_id ASC
        LIMIT ${Math.min(Math.max(limit ?? 200, 0), 1000)}
      `,
  });

  const upsertItem: ProjectionNativeSubagentTraceRepositoryShape["upsertItem"] = (item) =>
    upsertRow(item).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionNativeSubagentTrace.upsertItem:query")),
    );

  const appendContent: ProjectionNativeSubagentTraceRepositoryShape["appendContent"] = (input) =>
    getById({ taskId: input.taskId, traceItemId: input.traceItemId }).pipe(
      Effect.flatMap((existing) =>
        existing._tag === "None"
          ? Effect.void
          : updateText({
              taskId: input.taskId,
              traceItemId: input.traceItemId,
              text: appendCapped(existing.value.text, input.delta),
              updatedAt: input.updatedAt,
            }),
      ),
      Effect.mapError(toPersistenceSqlError("ProjectionNativeSubagentTrace.appendContent:query")),
    );

  const markCompleted: ProjectionNativeSubagentTraceRepositoryShape["markCompleted"] = (input) =>
    updateCompleted(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionNativeSubagentTrace.markCompleted:query")),
    );

  const listByTask: ProjectionNativeSubagentTraceRepositoryShape["listByTask"] = (input) =>
    listRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionNativeSubagentTrace.listByTask:query")),
    );

  return {
    upsertItem,
    appendContent,
    markCompleted,
    listByTask,
  } satisfies ProjectionNativeSubagentTraceRepositoryShape;
});

export const ProjectionNativeSubagentTraceRepositoryLive = Layer.effect(
  ProjectionNativeSubagentTraceRepository,
  makeProjectionNativeSubagentTraceRepository,
);
