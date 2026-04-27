import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  BrowserMcpAccess,
  BrowserMcpGrant,
  type BrowserMcpAccessShape,
} from "../Services/BrowserMcpAccess.ts";

const BROWSER_MCP_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

const BrowserMcpGrantDbRow = BrowserMcpGrant.mapFields(Struct.assign({}));

const TokenHashLookupInput = Schema.Struct({
  tokenHash: Schema.String,
  now: Schema.String,
});

const RevokeForThreadInput = Schema.Struct({
  threadId: BrowserMcpGrant.fields.threadId,
  revokedAt: Schema.String,
});

const RevokeGrantInput = Schema.Struct({
  grantId: BrowserMcpGrant.fields.grantId,
  revokedAt: Schema.String,
});

const RevokeOtherGrantsForThreadInput = Schema.Struct({
  threadId: BrowserMcpGrant.fields.threadId,
  keepGrantId: BrowserMcpGrant.fields.grantId,
  revokedAt: Schema.String,
});

const hashToken = async (token: string): Promise<string> => {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const makeBrowserMcpAccess = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertGrant = SqlSchema.void({
    Request: BrowserMcpGrant,
    execute: (grant) =>
      sql`
        INSERT INTO browser_mcp_access_grants (
          grant_id,
          thread_id,
          token_hash,
          provider,
          lease_id,
          created_at,
          expires_at,
          revoked_at
        )
        VALUES (
          ${grant.grantId},
          ${grant.threadId},
          ${grant.tokenHash},
          ${grant.provider},
          ${grant.leaseId},
          ${grant.createdAt},
          ${grant.expiresAt},
          ${grant.revokedAt}
        )
      `,
  });

  const findGrantByTokenHash = SqlSchema.findOneOption({
    Request: TokenHashLookupInput,
    Result: BrowserMcpGrantDbRow,
    execute: ({ tokenHash, now }) =>
      sql`
        SELECT
          grant_id AS "grantId",
          thread_id AS "threadId",
          token_hash AS "tokenHash",
          provider,
          lease_id AS "leaseId",
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          revoked_at AS "revokedAt"
        FROM browser_mcp_access_grants
        WHERE token_hash = ${tokenHash}
          AND revoked_at IS NULL
          AND expires_at > ${now}
        LIMIT 1
      `,
  });

  const revokeRowsForThread = SqlSchema.void({
    Request: RevokeForThreadInput,
    execute: ({ threadId, revokedAt }) =>
      sql`
        UPDATE browser_mcp_access_grants
        SET revoked_at = ${revokedAt}
        WHERE thread_id = ${threadId}
          AND revoked_at IS NULL
      `,
  });

  const revokeGrantRow = SqlSchema.void({
    Request: RevokeGrantInput,
    execute: ({ grantId, revokedAt }) =>
      sql`
        UPDATE browser_mcp_access_grants
        SET revoked_at = ${revokedAt}
        WHERE grant_id = ${grantId}
          AND revoked_at IS NULL
      `,
  });

  const revokeOtherRowsForThread = SqlSchema.void({
    Request: RevokeOtherGrantsForThreadInput,
    execute: ({ threadId, keepGrantId, revokedAt }) =>
      sql`
        UPDATE browser_mcp_access_grants
        SET revoked_at = ${revokedAt}
        WHERE thread_id = ${threadId}
          AND grant_id <> ${keepGrantId}
          AND revoked_at IS NULL
      `,
  });

  const issueGrant: BrowserMcpAccessShape["issueGrant"] = (input) =>
    Effect.gen(function* () {
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + BROWSER_MCP_GRANT_TTL_MS).toISOString();
      const accessToken = `dynamo_browser_${crypto.randomUUID()}_${crypto.randomUUID()}`;
      const tokenHash = yield* Effect.promise(() => hashToken(accessToken));
      const grantId = `browser-grant:${crypto.randomUUID()}` as never;
      yield* insertGrant({
        grantId,
        threadId: input.threadId,
        provider: input.provider,
        leaseId: input.leaseId ?? null,
        tokenHash,
        createdAt,
        expiresAt,
        revokedAt: null,
      });
      return {
        grantId,
        threadId: input.threadId,
        provider: input.provider,
        ...(input.leaseId !== undefined ? { leaseId: input.leaseId } : {}),
        accessToken,
        createdAt,
        expiresAt,
      };
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  const authenticate: BrowserMcpAccessShape["authenticate"] = ({ token }) =>
    Effect.gen(function* () {
      const tokenHash = yield* Effect.promise(() => hashToken(token));
      return yield* findGrantByTokenHash({
        tokenHash,
        now: new Date().toISOString(),
      });
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  const revokeForThread: BrowserMcpAccessShape["revokeForThread"] = (input) =>
    revokeRowsForThread({
      threadId: input.threadId,
      revokedAt: new Date().toISOString(),
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  const revokeGrant: BrowserMcpAccessShape["revokeGrant"] = (input) =>
    revokeGrantRow({
      grantId: input.grantId,
      revokedAt: new Date().toISOString(),
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  const revokeOtherGrantsForThread: BrowserMcpAccessShape["revokeOtherGrantsForThread"] = (
    input,
  ) =>
    revokeOtherRowsForThread({
      threadId: input.threadId,
      keepGrantId: input.keepGrantId,
      revokedAt: new Date().toISOString(),
    }).pipe(
      Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
    );

  return {
    issueGrant,
    authenticate,
    revokeForThread,
    revokeGrant,
    revokeOtherGrantsForThread,
  } satisfies BrowserMcpAccessShape;
});

export const BrowserMcpAccessLive = Layer.effect(BrowserMcpAccess, makeBrowserMcpAccess);
