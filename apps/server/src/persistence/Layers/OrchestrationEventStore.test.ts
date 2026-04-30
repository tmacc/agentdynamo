import { CommandId, EventId, ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError } from "../Errors.ts";
import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  OrchestrationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("OrchestrationEventStore", (it) => {
  it.effect("stores json columns as strings and replays decoded events", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      const appended = yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-store-roundtrip"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-roundtrip"),
        occurredAt: now,
        commandId: CommandId.make("cmd-store-roundtrip"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-store-roundtrip"),
        metadata: {
          adapterKey: "codex",
        },
        payload: {
          projectId: ProjectId.make("project-roundtrip"),
          title: "Roundtrip Project",
          workspaceRoot: "/tmp/project-roundtrip",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const storedRows = yield* sql<{
        readonly payloadJson: string;
        readonly metadataJson: string;
      }>`
        SELECT
          payload_json AS "payloadJson",
          metadata_json AS "metadataJson"
        FROM orchestration_events
        WHERE event_id = ${appended.eventId}
      `;
      assert.equal(storedRows.length, 1);
      assert.equal(typeof storedRows[0]?.payloadJson, "string");
      assert.equal(typeof storedRows[0]?.metadataJson, "string");

      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(replayed.length, 1);
      assert.equal(replayed[0]?.type, "project.created");
      assert.equal(replayed[0]?.metadata.adapterKey, "codex");
    }),
  );

  it.effect("fails with PersistenceDecodeError when stored json is invalid", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.make("evt-store-invalid-json")},
          ${"project"},
          ${ProjectId.make("project-invalid-json")},
          ${0},
          ${"project.created"},
          ${now},
          ${CommandId.make("cmd-store-invalid-json")},
          ${null},
          ${null},
          ${"server"},
          ${"{"},
          ${"{}"}
        )
      `;

      const replayResult = yield* Effect.result(
        Stream.runCollect(eventStore.readFromSequence(0, 10)),
      );
      assert.equal(replayResult._tag, "Failure");
      if (replayResult._tag === "Failure") {
        assert.ok(Schema.is(PersistenceDecodeError)(replayResult.failure));
        assert.ok(
          replayResult.failure.operation.includes(
            "OrchestrationEventStore.readFromSequence:decodeRows",
          ),
        );
      }
    }),
  );

  it.effect(
    "reads finite ranges past the default replay limit while keeping readFromSequence bounded",
    () =>
      Effect.gen(function* () {
        const eventStore = yield* OrchestrationEventStore;
        const now = new Date().toISOString();
        const eventCount = 1_105;
        const startSequence = yield* eventStore.getLatestSequence();

        yield* Effect.forEach(
          Array.from({ length: eventCount }, (_, index) => index + 1),
          (index) =>
            eventStore.append({
              type: "project.created",
              eventId: EventId.make(`evt-store-range-${index}`),
              aggregateKind: "project",
              aggregateId: ProjectId.make(`project-range-${index}`),
              occurredAt: now,
              commandId: CommandId.make(`cmd-store-range-${index}`),
              causationEventId: null,
              correlationId: CommandId.make(`cmd-store-range-${index}`),
              metadata: {},
              payload: {
                projectId: ProjectId.make(`project-range-${index}`),
                title: `Range Project ${index}`,
                workspaceRoot: `/tmp/project-range-${index}`,
                defaultModelSelection: null,
                scripts: [],
                createdAt: now,
                updatedAt: now,
              },
            }),
          { concurrency: 1 },
        );

        const latestSequence = yield* eventStore.getLatestSequence();
        assert.equal(latestSequence, startSequence + eventCount);

        const boundedReplay = yield* Stream.runCollect(
          eventStore.readFromSequence(startSequence),
        ).pipe(Effect.map((chunk) => Array.from(chunk)));
        assert.equal(boundedReplay.length, 1_000);

        const rangeReplay = yield* Stream.runCollect(
          eventStore.readRange({
            fromSequenceExclusive: startSequence + 100,
            toSequenceInclusive: latestSequence,
          }),
        ).pipe(Effect.map((chunk) => Array.from(chunk)));
        assert.equal(rangeReplay.length, eventCount - 100);
        assert.equal(rangeReplay[0]?.sequence, startSequence + 101);
        assert.equal(rangeReplay[rangeReplay.length - 1]?.sequence, latestSequence);

        const emptyRange = yield* Stream.runCollect(
          eventStore.readRange({
            fromSequenceExclusive: startSequence + 500,
            toSequenceInclusive: startSequence + 500,
          }),
        );
        assert.equal(emptyRange.length, 0);
      }),
  );
});
