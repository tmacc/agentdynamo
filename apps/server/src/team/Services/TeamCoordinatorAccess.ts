import {
  ProviderKind,
  TeamCoordinatorGrantId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

export const TeamCoordinatorGrant = Schema.Struct({
  grantId: TeamCoordinatorGrantId,
  parentThreadId: ThreadId,
  tokenHash: TrimmedNonEmptyString,
  provider: ProviderKind,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
});
export type TeamCoordinatorGrant = typeof TeamCoordinatorGrant.Type;

export interface IssueTeamCoordinatorGrantInput {
  readonly parentThreadId: ThreadId;
  readonly provider: ProviderKind;
}

export interface IssuedTeamCoordinatorGrant {
  readonly grantId: TeamCoordinatorGrantId;
  readonly parentThreadId: ThreadId;
  readonly provider: ProviderKind;
  readonly accessToken: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface TeamCoordinatorAccessShape {
  readonly issueGrant: (
    input: IssueTeamCoordinatorGrantInput,
  ) => Effect.Effect<IssuedTeamCoordinatorGrant, Error>;
  readonly authenticate: (input: {
    readonly token: string;
  }) => Effect.Effect<Option.Option<ThreadId>, Error>;
  readonly revokeForThread: (input: {
    readonly parentThreadId: ThreadId;
  }) => Effect.Effect<void, Error>;
}

export class TeamCoordinatorAccess extends Context.Service<
  TeamCoordinatorAccess,
  TeamCoordinatorAccessShape
>()("t3/team/Services/TeamCoordinatorAccess") {}
