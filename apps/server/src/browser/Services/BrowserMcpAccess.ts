import {
  BrowserGrantId,
  BrowserLeaseId,
  ProviderKind,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

export const BrowserMcpGrant = Schema.Struct({
  grantId: BrowserGrantId,
  threadId: ThreadId,
  tokenHash: TrimmedNonEmptyString,
  provider: ProviderKind,
  leaseId: Schema.NullOr(BrowserLeaseId),
  createdAt: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
});
export type BrowserMcpGrant = typeof BrowserMcpGrant.Type;

export interface IssueBrowserMcpGrantInput {
  readonly threadId: ThreadId;
  readonly provider: ProviderKind;
  readonly leaseId?: BrowserLeaseId;
}

export interface IssuedBrowserMcpGrant {
  readonly grantId: BrowserGrantId;
  readonly threadId: ThreadId;
  readonly provider: ProviderKind;
  readonly leaseId?: BrowserLeaseId;
  readonly accessToken: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface BrowserMcpAccessShape {
  readonly issueGrant: (
    input: IssueBrowserMcpGrantInput,
  ) => Effect.Effect<IssuedBrowserMcpGrant, Error>;
  readonly authenticate: (input: {
    readonly token: string;
  }) => Effect.Effect<Option.Option<BrowserMcpGrant>, Error>;
  readonly revokeForThread: (input: { readonly threadId: ThreadId }) => Effect.Effect<void, Error>;
  readonly revokeGrant: (input: {
    readonly grantId: BrowserGrantId;
  }) => Effect.Effect<void, Error>;
  readonly revokeOtherGrantsForThread: (input: {
    readonly threadId: ThreadId;
    readonly keepGrantId: BrowserGrantId;
  }) => Effect.Effect<void, Error>;
}

export class BrowserMcpAccess extends Context.Service<BrowserMcpAccess, BrowserMcpAccessShape>()(
  "t3/browser/Services/BrowserMcpAccess",
) {}
