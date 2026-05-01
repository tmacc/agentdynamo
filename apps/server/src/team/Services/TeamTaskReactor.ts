import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface TeamTaskReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly syncAll?: () => Effect.Effect<void>;
}

export class TeamTaskReactor extends Context.Service<TeamTaskReactor, TeamTaskReactorShape>()(
  "t3/team/Services/TeamTaskReactor",
) {}
