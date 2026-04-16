import {
  OrchestrationTeamTaskId,
  type OrchestrationTeamTaskStatus,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { TeamCoordinatorSessionRegistry } from "./Services/TeamCoordinatorSessionRegistry.ts";
import { TeamOrchestrationService } from "./Services/TeamOrchestrationService.ts";

const MCP_PROTOCOL_VERSION = "2025-03-26";

const jsonRpcError = (id: unknown, code: number, message: string, data?: unknown) =>
  HttpServerResponse.jsonUnsafe(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: {
        code,
        message,
        ...(data !== undefined ? { data } : {}),
      },
    },
    { status: 200 },
  );

const jsonRpcResult = (id: unknown, result: unknown) =>
  HttpServerResponse.jsonUnsafe(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      result,
    },
    { status: 200 },
  );

const toolResultPayload = (result: unknown, isError = false) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(result, null, 2),
    },
  ],
  structuredContent: result,
  isError,
});

const buildSharedSpawnChildProperties = () =>
  ({
    title: { type: "string" },
    task: { type: "string" },
    roleLabel: { type: "string" },
    contextBrief: { type: "string" },
    relevantFiles: {
      type: "array",
      items: { type: "string" },
    },
  }) as const;

const workerProviderLabel = (provider: ServerProvider["provider"]): string =>
  provider === "claudeAgent" ? "Claude" : "Codex";

const getAvailableWorkerProviders = (providers: ReadonlyArray<ServerProvider>) =>
  providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.supportsTeamWorker === true &&
      provider.models.length > 0,
  );

const formatAvailableWorkerModels = (providers: ReadonlyArray<ServerProvider>): string => {
  if (providers.length === 0) {
    return "No team-worker providers are currently available.";
  }

  return providers
    .map((provider) => {
      const models = provider.models.map((model) => model.slug).join(", ");
      return `${workerProviderLabel(provider.provider)} (${provider.provider}): ${models}`;
    })
    .join("\n");
};

const buildSpawnChildInputSchema = (providers: ReadonlyArray<ServerProvider>) => {
  const sharedProperties = buildSharedSpawnChildProperties();

  if (providers.length === 0) {
    return {
      type: "object",
      properties: {
        provider: { type: "string" },
        model: { type: "string" },
        ...sharedProperties,
      },
      required: ["provider", "model", "title", "task"],
      additionalProperties: false,
    } as const;
  }

  const variants = providers.map((provider) => ({
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: [provider.provider],
        description: `${workerProviderLabel(provider.provider)} worker provider`,
      },
      model: {
        type: "string",
        enum: provider.models.map((model) => model.slug),
        description: `Available ${workerProviderLabel(provider.provider)} worker models`,
      },
      ...sharedProperties,
    },
    required: ["provider", "model", "title", "task"],
    additionalProperties: false,
  }));

  if (variants.length === 1) {
    return variants[0];
  }

  return {
    oneOf: variants,
  } as const;
};

const buildTeamTools = (providers: ReadonlyArray<ServerProvider>) => {
  const workerProviders = getAvailableWorkerProviders(providers);
  const availableModels = formatAvailableWorkerModels(workerProviders);

  return [
    {
      name: "team.spawn_child",
      description: [
        "Spawn a child agent thread on a selected provider/model and hand it a bounded task brief.",
        "Use one of the exact provider/model combinations below.",
        `Available worker models:\n${availableModels}`,
      ].join("\n\n"),
      inputSchema: buildSpawnChildInputSchema(workerProviders),
    },
    {
      name: "team.list_children",
      description: "List child tasks for the current coordinator thread.",
      inputSchema: {
        type: "object",
        properties: {
          statusFilter: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "queued",
                "starting",
                "running",
                "waiting",
                "completed",
                "failed",
                "cancelled",
              ],
            },
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "team.wait_for_children",
      description:
        "Wait for child tasks to settle or until the timeout is reached, then return structured task status.",
      inputSchema: {
        type: "object",
        properties: {
          taskIds: {
            type: "array",
            items: { type: "string" },
          },
          timeoutSeconds: { type: "integer", minimum: 1, maximum: 300 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "team.send_child_message",
      description: "Send a follow-up message to an existing child thread.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          message: { type: "string" },
        },
        required: ["taskId", "message"],
        additionalProperties: false,
      },
    },
    {
      name: "team.close_child",
      description: "Stop a child thread and mark its team task cancelled.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
    },
  ] as const;
};

const readBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
};

const authenticateMcpRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const teamCoordinatorSessionRegistry = yield* TeamCoordinatorSessionRegistry;
  const accessToken = readBearerToken(request.headers.authorization);
  if (!accessToken) {
    return yield* Effect.fail(new Error("Missing bearer token."));
  }
  const threadId =
    yield* teamCoordinatorSessionRegistry.authenticateCoordinatorAccessToken(accessToken);
  if (Option.isNone(threadId)) {
    return yield* Effect.fail(new Error("Invalid bearer token."));
  }
  return threadId.value;
});

const handleToolCall = Effect.fn("handleToolCall")(function* (input: {
  readonly threadId: ThreadId;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}) {
  const teamOrchestration = yield* TeamOrchestrationService;
  switch (input.name) {
    case "team.spawn_child": {
      const roleLabel =
        typeof input.arguments.roleLabel === "string" ? input.arguments.roleLabel : null;
      const contextBrief =
        typeof input.arguments.contextBrief === "string" ? input.arguments.contextBrief : null;
      const relevantFiles = Array.isArray(input.arguments.relevantFiles)
        ? input.arguments.relevantFiles.map(String)
        : null;
      return yield* teamOrchestration.spawnChild({
        parentThreadId: input.threadId,
        provider: input.arguments.provider === "claudeAgent" ? "claudeAgent" : "codex",
        model: String(input.arguments.model ?? ""),
        title: String(input.arguments.title ?? ""),
        task: String(input.arguments.task ?? ""),
        ...(roleLabel !== null ? { roleLabel } : {}),
        ...(contextBrief !== null ? { contextBrief } : {}),
        ...(relevantFiles !== null ? { relevantFiles } : {}),
      });
    }

    case "team.list_children": {
      const statusFilter: ReadonlyArray<OrchestrationTeamTaskStatus> | null = Array.isArray(
        input.arguments.statusFilter,
      )
        ? (input.arguments.statusFilter.map(String) as ReadonlyArray<OrchestrationTeamTaskStatus>)
        : null;
      if (statusFilter === null) {
        return yield* teamOrchestration.listChildren({
          parentThreadId: input.threadId,
        });
      }
      return yield* teamOrchestration.listChildren({
        parentThreadId: input.threadId,
        statusFilter,
      });
    }

    case "team.wait_for_children": {
      const taskIds: ReadonlyArray<OrchestrationTeamTaskId> | null = Array.isArray(
        input.arguments.taskIds,
      )
        ? (input.arguments.taskIds.map(String) as ReadonlyArray<OrchestrationTeamTaskId>)
        : null;
      const timeoutSeconds =
        typeof input.arguments.timeoutSeconds === "number" ? input.arguments.timeoutSeconds : null;
      if (taskIds === null && timeoutSeconds === null) {
        return yield* teamOrchestration.waitForChildren({
          parentThreadId: input.threadId,
        });
      }
      if (taskIds === null && timeoutSeconds !== null) {
        return yield* teamOrchestration.waitForChildren({
          parentThreadId: input.threadId,
          timeoutSeconds,
        });
      }
      if (timeoutSeconds === null && taskIds !== null) {
        return yield* teamOrchestration.waitForChildren({
          parentThreadId: input.threadId,
          taskIds,
        });
      }
      return yield* teamOrchestration.waitForChildren({
        parentThreadId: input.threadId,
        taskIds: taskIds as ReadonlyArray<OrchestrationTeamTaskId>,
        timeoutSeconds: timeoutSeconds as number,
      });
    }

    case "team.send_child_message":
      return yield* teamOrchestration.sendChildMessage({
        parentThreadId: input.threadId,
        taskId: String(input.arguments.taskId) as OrchestrationTeamTaskId,
        message: String(input.arguments.message ?? ""),
      });

    case "team.close_child": {
      const reason = typeof input.arguments.reason === "string" ? input.arguments.reason : null;
      return yield* teamOrchestration.closeChild({
        parentThreadId: input.threadId,
        taskId: String(input.arguments.taskId) as OrchestrationTeamTaskId,
        ...(reason !== null ? { reason } : {}),
      });
    }

    default:
      return yield* Effect.fail(new Error(`Unknown tool '${input.name}'.`));
  }
});

export const teamMcpRouteLayer = HttpRouter.add(
  "POST",
  "/api/team-mcp",
  Effect.gen(function* () {
    const threadId = yield* authenticateMcpRequest;
    const providerRegistry = yield* ProviderRegistry;
    const request = yield* HttpServerRequest.schemaBodyJson(
      Schema.Record(Schema.String, Schema.Unknown),
    );
    const id = request.id ?? null;
    const isNotification = request.id === undefined;
    const method = typeof request.method === "string" ? request.method : null;
    const params =
      request.params && typeof request.params === "object"
        ? (request.params as Record<string, unknown>)
        : {};
    const teamTools = buildTeamTools(yield* providerRegistry.getProviders);

    switch (method) {
      case "initialize":
        return jsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "t3-team-agents",
            version: "1.0.0",
          },
        });

      case "notifications/initialized":
        return HttpServerResponse.empty({ status: 204 });

      case "ping":
        return isNotification ? HttpServerResponse.empty({ status: 204 }) : jsonRpcResult(id, {});

      case "tools/list":
        return jsonRpcResult(id, {
          tools: teamTools,
        });

      case "tools/call": {
        const toolName = typeof params.name === "string" ? params.name : "";
        const toolArguments =
          params.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        const result = yield* handleToolCall({
          threadId,
          name: toolName,
          arguments: toolArguments,
        }).pipe(
          Effect.match({
            onFailure: (error) => toolResultPayload({ error: error.message }, true),
            onSuccess: (value) => toolResultPayload(value),
          }),
        );
        return jsonRpcResult(id, result);
      }

      default:
        return jsonRpcError(id, -32601, `Unknown MCP method '${method ?? "<missing>"}'.`);
    }
  }).pipe(
    Effect.catch((error: unknown) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            error: error instanceof Error ? error.message : "MCP request failed.",
          },
          { status: 401 },
        ),
      ),
    ),
  ),
);

export const teamMcpHealthRouteLayer = HttpRouter.add(
  "GET",
  "/api/team-mcp",
  Effect.succeed(HttpServerResponse.empty({ status: 204 })),
);
