import { FeatureCardId, ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionBoardCardRepositoryLive } from "../Layers/ProjectionBoardCards.ts";
import { ProjectionBoardDismissedGhostRepositoryLive } from "../Layers/ProjectionBoardDismissedGhosts.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { ProjectionBoardCardRepository } from "../Services/ProjectionBoardCards.ts";
import { ProjectionBoardDismissedGhostRepository } from "../Services/ProjectionBoardDismissedGhosts.ts";

const layer = it.layer(
  Layer.mergeAll(
    ProjectionBoardCardRepositoryLive,
    ProjectionBoardDismissedGhostRepositoryLive,
  ).pipe(Layer.provideMerge(NodeSqliteClient.layerMemory())),
);

layer("044_EnsureProjectionBoardTables", (it) => {
  it.effect("recovers databases recorded past moved board migrations with missing tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const cards = yield* ProjectionBoardCardRepository;
      const dismissedGhosts = yield* ProjectionBoardDismissedGhostRepository;
      const projectId = ProjectId.make("project-board-repair");
      const threadId = ThreadId.make("thread-board-repair");

      yield* runMigrations({ toMigrationInclusive: 28 });
      yield* sql`DROP TABLE projection_board_cards`;
      yield* sql`DROP TABLE projection_board_dismissed_ghosts`;

      const executedMigrations = yield* runMigrations({ toMigrationInclusive: 44 });
      assert.ok(
        executedMigrations.some(
          ([id, name]) => id === 44 && name === "EnsureProjectionBoardTables",
        ),
      );

      const cardIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_board_cards)
      `;
      assert.ok(
        cardIndexes.some((index) => index.name === "idx_projection_board_cards_project_id"),
      );
      assert.ok(
        cardIndexes.some(
          (index) => index.name === "idx_projection_board_cards_linked_thread_id_unique",
        ),
      );

      const dismissedGhostIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_board_dismissed_ghosts)
      `;
      assert.ok(
        dismissedGhostIndexes.some(
          (index) => index.name === "idx_projection_board_dismissed_ghosts_project_id",
        ),
      );

      yield* cards.upsert({
        id: FeatureCardId.make("card-board-repair"),
        projectId,
        title: "Repair board card",
        description: "Created after migration 44 repaired missing board tables.",
        seededPrompt: null,
        column: "ideas",
        sortOrder: 10,
        linkedThreadId: threadId,
        linkedProposedPlanId: null,
        createdAt: "2026-04-25T12:00:00.000Z",
        updatedAt: "2026-04-25T12:00:00.000Z",
        archivedAt: null,
      });
      yield* dismissedGhosts.upsert({
        projectId,
        threadId,
        dismissedAt: "2026-04-25T12:01:00.000Z",
      });

      const listedCards = yield* cards.listByProject({ projectId });
      assert.equal(listedCards.length, 1);
      assert.deepStrictEqual(listedCards[0], {
        id: FeatureCardId.make("card-board-repair"),
        projectId,
        title: "Repair board card",
        description: "Created after migration 44 repaired missing board tables.",
        seededPrompt: null,
        column: "ideas",
        sortOrder: 10,
        linkedThreadId: threadId,
        linkedProposedPlanId: null,
        createdAt: "2026-04-25T12:00:00.000Z",
        updatedAt: "2026-04-25T12:00:00.000Z",
        archivedAt: null,
      });

      const listedDismissedGhosts = yield* dismissedGhosts.listByProject({ projectId });
      assert.deepStrictEqual(listedDismissedGhosts, [
        {
          projectId,
          threadId,
          dismissedAt: "2026-04-25T12:01:00.000Z",
        },
      ]);
    }),
  );
});
