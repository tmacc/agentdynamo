import { ProjectId, ThreadId, type FeatureCard } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionBoardCardRepositoryLive } from "./ProjectionBoardCards.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionBoardCardRepository } from "../Services/ProjectionBoardCards.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";

const projectionRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionBoardCardRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

projectionRepositoriesLayer("Projection repositories", (it) => {
  it.effect("stores SQL NULL for missing project model options", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* projects.upsert({
        projectId: ProjectId.make("project-null-options"),
        title: "Null options project",
        workspaceRoot: "/tmp/project-null-options",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        scripts: [],
        worktreeReadiness: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly defaultModelSelection: string | null;
      }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.fail(new Error("Expected projection_projects row to exist."));
      }

      assert.strictEqual(
        row.defaultModelSelection,
        JSON.stringify({
          provider: "codex",
          model: "gpt-5.4",
        }),
      );

      const persisted = yield* projects.getById({
        projectId: ProjectId.make("project-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.defaultModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
      });
    }),
  );

  it.effect("stores JSON for thread model options", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-null-options"),
        projectId: ProjectId.make("project-null-options"),
        title: "Null options thread",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly modelSelection: string | null;
      }>`
        SELECT model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = 'thread-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.fail(new Error("Expected projection_threads row to exist."));
      }

      assert.strictEqual(
        row.modelSelection,
        JSON.stringify({
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        }),
      );

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.modelSelection, {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      });
    }),
  );

  it.effect("rejects duplicate linked thread ids across board cards", () =>
    Effect.gen(function* () {
      const boardCards = yield* ProjectionBoardCardRepository;
      const firstCard: FeatureCard = {
        id: "card-1" as FeatureCard["id"],
        projectId: ProjectId.make("project-board"),
        title: "Card 1" as FeatureCard["title"],
        description: null,
        seededPrompt: null,
        column: "planned",
        sortOrder: 0,
        linkedThreadId: ThreadId.make("thread-shared"),
        linkedProposedPlanId: null,
        createdAt: "2026-04-18T00:00:00.000Z" as FeatureCard["createdAt"],
        updatedAt: "2026-04-18T00:00:00.000Z" as FeatureCard["updatedAt"],
        archivedAt: null,
      };
      const secondCard: FeatureCard = {
        id: "card-2" as FeatureCard["id"],
        projectId: ProjectId.make("project-board"),
        title: "Card 2" as FeatureCard["title"],
        description: null,
        seededPrompt: null,
        column: "planned",
        sortOrder: 100,
        linkedThreadId: ThreadId.make("thread-shared"),
        linkedProposedPlanId: null,
        createdAt: "2026-04-18T00:00:01.000Z" as FeatureCard["createdAt"],
        updatedAt: "2026-04-18T00:00:01.000Z" as FeatureCard["updatedAt"],
        archivedAt: null,
      };

      yield* boardCards.upsert(firstCard);

      const exit = yield* Effect.exit(boardCards.upsert(secondCard));

      assert.strictEqual(exit._tag, "Failure");
    }),
  );
});
