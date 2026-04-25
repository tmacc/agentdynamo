import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { TeamCoordinatorAccess } from "../Services/TeamCoordinatorAccess.ts";
import { TeamCoordinatorAccessLive } from "./TeamCoordinatorAccess.ts";
import { ThreadId, TeamCoordinatorGrantId } from "@t3tools/contracts";

const layer = it.layer(
  TeamCoordinatorAccessLive.pipe(Layer.provideMerge(NodeSqliteClient.layerMemory())),
);

layer("TeamCoordinatorAccess", (it) => {
  it.effect("revokes other thread grants while preserving the kept grant", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 45 });
      const access = yield* TeamCoordinatorAccess;
      const parentThreadId = ThreadId.make("thread-team-access");
      const first = yield* access.issueGrant({ parentThreadId, provider: "codex" });
      const second = yield* access.issueGrant({ parentThreadId, provider: "codex" });

      yield* access.revokeOtherGrantsForThread({
        parentThreadId,
        keepGrantId: second.grantId,
      });

      const firstAuth = yield* access.authenticate({ token: first.accessToken });
      const secondAuth = yield* access.authenticate({ token: second.accessToken });
      assert.ok(Option.isNone(firstAuth));
      assert.ok(Option.isSome(secondAuth));
      assert.equal(secondAuth.value, parentThreadId);
    }),
  );

  it.effect("revokes one grant without revoking older grants for the same thread", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 45 });
      const access = yield* TeamCoordinatorAccess;
      const parentThreadId = ThreadId.make("thread-team-access-single");
      const first = yield* access.issueGrant({ parentThreadId, provider: "codex" });
      const second = yield* access.issueGrant({ parentThreadId, provider: "codex" });

      yield* access.revokeGrant({ grantId: second.grantId });

      const firstAuth = yield* access.authenticate({ token: first.accessToken });
      const secondAuth = yield* access.authenticate({ token: second.accessToken });
      assert.ok(Option.isSome(firstAuth));
      assert.ok(Option.isNone(secondAuth));
    }),
  );

  it.effect("treats revoking an unknown grant as idempotent", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 45 });
      const access = yield* TeamCoordinatorAccess;

      yield* access.revokeGrant({
        grantId: TeamCoordinatorGrantId.make("team-grant:missing"),
      });
    }),
  );
});
