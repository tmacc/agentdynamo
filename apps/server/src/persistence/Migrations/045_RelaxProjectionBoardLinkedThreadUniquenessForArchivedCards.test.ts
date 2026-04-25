import { FeatureCardId, ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionBoardCardRepositoryLive } from "../Layers/ProjectionBoardCards.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { ProjectionBoardCardRepository } from "../Services/ProjectionBoardCards.ts";

const layer = it.layer(
  ProjectionBoardCardRepositoryLive.pipe(Layer.provideMerge(NodeSqliteClient.layerMemory())),
);

layer("045_RelaxProjectionBoardLinkedThreadUniquenessForArchivedCards", (it) => {
  it.effect("allows archived and active cards to retain the same linked thread", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const cards = yield* ProjectionBoardCardRepository;
      const projectId = ProjectId.make("project-board-link-archive");
      const threadId = ThreadId.make("thread-board-link-archive");

      yield* runMigrations({ toMigrationInclusive: 44 });
      yield* sql`DROP INDEX idx_projection_board_cards_linked_thread_id_unique`;
      yield* sql`
        CREATE UNIQUE INDEX idx_projection_board_cards_linked_thread_id_unique
        ON projection_board_cards(linked_thread_id)
        WHERE linked_thread_id IS NOT NULL
      `;
      const beforeSql = yield* sql<{ readonly sql: string | null }>`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_projection_board_cards_linked_thread_id_unique'
      `;
      assert.match(beforeSql[0]?.sql ?? "", /WHERE linked_thread_id IS NOT NULL\s*$/);

      yield* runMigrations({ toMigrationInclusive: 45 });
      const afterSql = yield* sql<{ readonly sql: string | null }>`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_projection_board_cards_linked_thread_id_unique'
      `;
      assert.match(afterSql[0]?.sql ?? "", /archived_at IS NULL/);

      yield* cards.upsert({
        id: FeatureCardId.make("card-board-link-archived"),
        projectId,
        title: "Archived card",
        description: null,
        seededPrompt: null,
        column: "planned",
        sortOrder: 10,
        linkedThreadId: threadId,
        linkedProposedPlanId: null,
        createdAt: "2026-04-25T12:00:00.000Z",
        updatedAt: "2026-04-25T12:01:00.000Z",
        archivedAt: "2026-04-25T12:01:00.000Z",
      });
      yield* cards.upsert({
        id: FeatureCardId.make("card-board-link-active"),
        projectId,
        title: "Active card",
        description: null,
        seededPrompt: null,
        column: "planned",
        sortOrder: 20,
        linkedThreadId: threadId,
        linkedProposedPlanId: null,
        createdAt: "2026-04-25T12:02:00.000Z",
        updatedAt: "2026-04-25T12:02:00.000Z",
        archivedAt: null,
      });

      const active = yield* cards.getByLinkedThreadId({ linkedThreadId: threadId });
      assert.ok(Option.isSome(active));
      assert.equal(active.value.id, FeatureCardId.make("card-board-link-active"));
    }),
  );
});
