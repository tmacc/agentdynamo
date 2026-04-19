import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(provider_session_runtime)
  `;

  const hasTable = columns.length > 0;
  const hasSlotState = columns.some((column) => column.name === "slot_state");

  if (!hasTable) {
    yield* sql`
      CREATE TABLE IF NOT EXISTS provider_session_runtime (
        thread_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        runtime_mode TEXT NOT NULL DEFAULT 'full-access',
        status TEXT NOT NULL,
        slot_state TEXT NOT NULL DEFAULT 'stopped',
        last_seen_at TEXT NOT NULL,
        resume_cursor_json TEXT,
        runtime_payload_json TEXT,
        PRIMARY KEY (thread_id, provider_name)
      )
    `;
  } else if (!hasSlotState) {
    yield* sql`
      ALTER TABLE provider_session_runtime RENAME TO provider_session_runtime_legacy
    `;

    yield* sql`
      CREATE TABLE provider_session_runtime (
        thread_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        runtime_mode TEXT NOT NULL DEFAULT 'full-access',
        status TEXT NOT NULL,
        slot_state TEXT NOT NULL DEFAULT 'stopped',
        last_seen_at TEXT NOT NULL,
        resume_cursor_json TEXT,
        runtime_payload_json TEXT,
        PRIMARY KEY (thread_id, provider_name)
      )
    `;

    yield* sql`
      INSERT INTO provider_session_runtime (
        thread_id,
        provider_name,
        adapter_key,
        runtime_mode,
        status,
        slot_state,
        last_seen_at,
        resume_cursor_json,
        runtime_payload_json
      )
      SELECT
        thread_id,
        provider_name,
        adapter_key,
        runtime_mode,
        status,
        CASE
          WHEN status = 'starting' OR status = 'running' THEN 'active'
          WHEN status = 'error' THEN 'error'
          ELSE 'stopped'
        END,
        last_seen_at,
        resume_cursor_json,
        runtime_payload_json
      FROM provider_session_runtime_legacy
    `;

    yield* sql`
      DROP TABLE provider_session_runtime_legacy
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_status
    ON provider_session_runtime(status)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_provider
    ON provider_session_runtime(provider_name)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_slot_state
    ON provider_session_runtime(slot_state)
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_session_runtime_active_thread
    ON provider_session_runtime(thread_id)
    WHERE slot_state = 'active'
  `;
});
