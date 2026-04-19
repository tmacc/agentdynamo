import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Migration0031 from "./031_RepairProjectionBoardCardLinkedThreadUniqueness.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("031_RepairProjectionBoardCardLinkedThreadUniqueness", (it) => {
  it.effect("keeps the oldest linked card per thread and unlinks later duplicates", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 26 });
      yield* sql`
        CREATE TABLE projection_board_cards (
          card_id TEXT PRIMARY KEY NOT NULL,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          seeded_prompt TEXT,
          column_name TEXT NOT NULL,
          sort_order REAL NOT NULL,
          linked_thread_id TEXT,
          linked_proposed_plan_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        )
      `;
      yield* sql`
        CREATE INDEX idx_projection_board_cards_project_id
        ON projection_board_cards(project_id)
      `;
      yield* sql`
        CREATE INDEX idx_projection_board_cards_linked_thread_id
        ON projection_board_cards(linked_thread_id)
      `;

      yield* sql`
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
        VALUES
          (
            'card-oldest',
            'project-1',
            'Oldest card',
            NULL,
            NULL,
            'planned',
            0,
            'thread-shared',
            NULL,
            '2026-04-18T00:00:00.000Z',
            '2026-04-18T00:00:00.000Z',
            NULL
          ),
          (
            'card-newer',
            'project-1',
            'Newer card',
            NULL,
            NULL,
            'planned',
            100,
            'thread-shared',
            NULL,
            '2026-04-18T00:00:01.000Z',
            '2026-04-18T00:00:01.000Z',
            NULL
          ),
          (
            'card-tie-breaker',
            'project-1',
            'Tie breaker',
            NULL,
            NULL,
            'planned',
            200,
            'thread-shared-2',
            NULL,
            '2026-04-18T00:00:02.000Z',
            '2026-04-18T00:00:02.000Z',
            NULL
          ),
          (
            'card-tie-breaker-b',
            'project-1',
            'Tie breaker B',
            NULL,
            NULL,
            'planned',
            300,
            'thread-shared-2',
            NULL,
            '2026-04-18T00:00:02.000Z',
            '2026-04-18T00:00:02.000Z',
            NULL
          )
      `;

      yield* Migration0031;

      const rows = yield* sql<{
        readonly cardId: string;
        readonly linkedThreadId: string | null;
      }>`
        SELECT
          card_id AS "cardId",
          linked_thread_id AS "linkedThreadId"
        FROM projection_board_cards
        ORDER BY card_id ASC
      `;
      assert.deepStrictEqual(rows, [
        { cardId: "card-newer", linkedThreadId: null },
        { cardId: "card-oldest", linkedThreadId: "thread-shared" },
        { cardId: "card-tie-breaker", linkedThreadId: "thread-shared-2" },
        { cardId: "card-tie-breaker-b", linkedThreadId: null },
      ]);

      const indexes = yield* sql<{
        readonly name: string;
        readonly unique: number;
        readonly partial: number;
      }>`
        PRAGMA index_list(projection_board_cards)
      `;
      assert.ok(
        indexes.some(
          (index) =>
            index.name === "idx_projection_board_cards_linked_thread_id_unique" &&
            index.unique === 1 &&
            index.partial === 1,
        ),
      );
    }),
  );

  it.effect("is idempotent when rerun against clean board card links", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 29 });
      yield* sql`
        DELETE FROM projection_board_cards
      `;
      yield* sql`
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
        VALUES
          (
            'card-clean',
            'project-1',
            'Clean card',
            NULL,
            NULL,
            'planned',
            0,
            'thread-clean',
            NULL,
            '2026-04-18T00:00:00.000Z',
            '2026-04-18T00:00:00.000Z',
            NULL
          )
      `;

      yield* Migration0031;
      yield* Migration0031;

      const rows = yield* sql<{
        readonly cardId: string;
        readonly linkedThreadId: string | null;
      }>`
        SELECT
          card_id AS "cardId",
          linked_thread_id AS "linkedThreadId"
        FROM projection_board_cards
      `;
      assert.deepStrictEqual(rows, [{ cardId: "card-clean", linkedThreadId: "thread-clean" }]);
    }),
  );
});
