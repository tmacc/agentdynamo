import type { ProviderSessionStartInput, ThreadId } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect, Option } from "effect";

export interface TeamCoordinatorSessionRegistryShape {
  readonly getCoordinatorSessionConfig: (
    threadId: ThreadId,
  ) => Effect.Effect<NonNullable<ProviderSessionStartInput["teamCoordinator"]>, Error>;
  readonly authenticateCoordinatorAccessToken: (
    accessToken: string,
  ) => Effect.Effect<Option.Option<ThreadId>>;
}

export class TeamCoordinatorSessionRegistry extends Context.Service<
  TeamCoordinatorSessionRegistry,
  TeamCoordinatorSessionRegistryShape
>()("t3/team/Services/TeamCoordinatorSessionRegistry") {}
