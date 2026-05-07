import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0055 from "./055_ProjectionThreadMessageRenderMode.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

type TableColumn = {
  readonly name: string;
};

layer("055_ProjectionThreadMessageRenderMode", (it) => {
  it.effect("adds render_mode to projection_thread_messages", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 55 });

      const columns = yield* sql<TableColumn>`
        PRAGMA table_info(projection_thread_messages)
      `;
      assert.ok(columns.some((column) => column.name === "render_mode"));
    }),
  );

  it.effect("no-ops when render_mode already exists but migration 55 is pending", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* sql`
        DELETE FROM effect_sql_migrations
        WHERE migration_id = 55
      `;
      yield* runMigrations({ toMigrationInclusive: 55 });

      const columns = yield* sql<TableColumn>`
        PRAGMA table_info(projection_thread_messages)
      `;
      assert.equal(columns.filter((column) => column.name === "render_mode").length, 1);
    }),
  );

  it.effect("fails clearly when projection_thread_messages is missing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DROP TABLE IF EXISTS projection_thread_messages`;
      const error = yield* Migration0055.pipe(Effect.flip);

      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "projection_thread_messages table is missing before migration 55",
      );
    }),
  );
});
