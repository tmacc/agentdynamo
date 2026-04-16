import type { ThreadId } from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";

import { ServerConfig } from "../../config.ts";
import {
  TeamCoordinatorSessionRegistry,
  type TeamCoordinatorSessionRegistryShape,
} from "../Services/TeamCoordinatorSessionRegistry.ts";

const makeTeamCoordinatorSessionRegistry = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;

  const coordinatorAccessTokens = new Map<string, ThreadId>();
  const coordinatorTokenByThreadId = new Map<ThreadId, string>();

  return {
    getCoordinatorSessionConfig: (threadId) =>
      Effect.sync(() => {
        const existingToken = coordinatorTokenByThreadId.get(threadId);
        const accessToken = existingToken ?? crypto.randomUUID();
        coordinatorTokenByThreadId.set(threadId, accessToken);
        coordinatorAccessTokens.set(accessToken, threadId);
        return {
          mcpServerUrl: `http://127.0.0.1:${serverConfig.port}/api/team-mcp`,
          accessToken,
        };
      }),
    authenticateCoordinatorAccessToken: (accessToken) =>
      Effect.succeed(
        (() => {
          const threadId = coordinatorAccessTokens.get(accessToken);
          return threadId ? Option.some(threadId) : Option.none();
        })(),
      ),
  } satisfies TeamCoordinatorSessionRegistryShape;
});

export const TeamCoordinatorSessionRegistryLive = Layer.effect(
  TeamCoordinatorSessionRegistry,
  makeTeamCoordinatorSessionRegistry,
);
