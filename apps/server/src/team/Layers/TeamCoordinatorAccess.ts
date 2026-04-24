import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  TeamCoordinatorAccess,
  TeamCoordinatorGrant,
  type TeamCoordinatorAccessShape,
} from "../Services/TeamCoordinatorAccess.ts";

const TEAM_COORDINATOR_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

const TeamCoordinatorGrantDbRow = TeamCoordinatorGrant.mapFields(Struct.assign({}));

const TokenHashLookupInput = Schema.Struct({
  tokenHash: Schema.String,
  now: Schema.String,
});

const RevokeForThreadInput = Schema.Struct({
  parentThreadId: TeamCoordinatorGrant.fields.parentThreadId,
  revokedAt: Schema.String,
});

const hashToken = async (token: string): Promise<string> => {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const makeTeamCoordinatorAccess = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertGrant = SqlSchema.void({
    Request: TeamCoordinatorGrant,
    execute: (grant) =>
      sql`
        INSERT INTO team_coordinator_access_grants (
          grant_id,
          parent_thread_id,
          token_hash,
          provider,
          created_at,
          expires_at,
          revoked_at
        )
        VALUES (
          ${grant.grantId},
          ${grant.parentThreadId},
          ${grant.tokenHash},
          ${grant.provider},
          ${grant.createdAt},
          ${grant.expiresAt},
          ${grant.revokedAt}
        )
      `,
  });

  const findGrantByTokenHash = SqlSchema.findOneOption({
    Request: TokenHashLookupInput,
    Result: TeamCoordinatorGrantDbRow,
    execute: ({ tokenHash, now }) =>
      sql`
        SELECT
          grant_id AS "grantId",
          parent_thread_id AS "parentThreadId",
          token_hash AS "tokenHash",
          provider,
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          revoked_at AS "revokedAt"
        FROM team_coordinator_access_grants
        WHERE token_hash = ${tokenHash}
          AND revoked_at IS NULL
          AND expires_at > ${now}
        LIMIT 1
      `,
  });

  const revokeRowsForThread = SqlSchema.void({
    Request: RevokeForThreadInput,
    execute: ({ parentThreadId, revokedAt }) =>
      sql`
        UPDATE team_coordinator_access_grants
        SET revoked_at = ${revokedAt}
        WHERE parent_thread_id = ${parentThreadId}
          AND revoked_at IS NULL
      `,
  });

  const issueGrant: TeamCoordinatorAccessShape["issueGrant"] = (input) =>
    Effect.gen(function* () {
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + TEAM_COORDINATOR_GRANT_TTL_MS).toISOString();
      const accessToken = `dynamo_team_${crypto.randomUUID()}_${crypto.randomUUID()}`;
      const tokenHash = yield* Effect.promise(() => hashToken(accessToken));
      const grantId = `team-grant:${crypto.randomUUID()}` as TeamCoordinatorGrant["grantId"];
      yield* insertGrant({
        grantId,
        parentThreadId: input.parentThreadId,
        provider: input.provider,
        tokenHash,
        createdAt,
        expiresAt,
        revokedAt: null,
      });
      return {
        grantId,
        parentThreadId: input.parentThreadId,
        provider: input.provider,
        accessToken,
        createdAt,
        expiresAt,
      };
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  const authenticate: TeamCoordinatorAccessShape["authenticate"] = ({ token }) =>
    Effect.gen(function* () {
      const tokenHash = yield* Effect.promise(() => hashToken(token));
      const grant = yield* findGrantByTokenHash({
        tokenHash,
        now: new Date().toISOString(),
      });
      return Option.map(grant, (row) => row.parentThreadId);
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  const revokeForThread: TeamCoordinatorAccessShape["revokeForThread"] = (input) =>
    revokeRowsForThread({
      parentThreadId: input.parentThreadId,
      revokedAt: new Date().toISOString(),
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  return {
    issueGrant,
    authenticate,
    revokeForThread,
  } satisfies TeamCoordinatorAccessShape;
});

export const TeamCoordinatorAccessLive = Layer.effect(
  TeamCoordinatorAccess,
  makeTeamCoordinatorAccess,
);
