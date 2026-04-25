import { Effect, Exit, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { ServerProvider } from "@t3tools/contracts";

import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { TeamCoordinatorAccess } from "./Services/TeamCoordinatorAccess.ts";
import { TeamOrchestrationService } from "./Services/TeamOrchestrationService.ts";

const MCP_PROTOCOL_VERSION = "2025-03-26";

function jsonRpcResult(id: unknown, result: unknown) {
  return HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id: id ?? null, result }, { status: 200 });
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return HttpServerResponse.jsonUnsafe(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    },
    { status: 200 },
  );
}

function readBearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function emptyResponse() {
  return HttpServerResponse.empty({ status: 204 });
}

const toolResult = (result: unknown, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  structuredContent: result,
  isError,
});

function spawnChildSchema() {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      task: { type: "string" },
      roleLabel: { type: "string" },
      taskKind: {
        type: "string",
        enum: ["coding", "exploration", "review", "test", "ui", "docs", "general"],
      },
      contextBrief: { type: "string" },
      relevantFiles: { type: "array", items: { type: "string" } },
      provider: { type: "string", enum: ["codex", "claudeAgent", "cursor", "opencode"] },
      model: { type: "string" },
      workspaceMode: { type: "string", enum: ["auto", "worktree", "shared"] },
      setupMode: { type: "string", enum: ["auto", "run", "skip"] },
    },
    required: ["title", "task"],
    additionalProperties: false,
  };
}

function describeWorkerModels(providers: ReadonlyArray<ServerProvider>): string {
  const lines = providers
    .filter(
      (provider) =>
        provider.enabled &&
        provider.installed &&
        provider.status !== "disabled" &&
        provider.teamCapabilities?.supportsWorker !== false &&
        provider.models.length > 0,
    )
    .map((provider) => {
      const models = provider.models
        .slice(0, 8)
        .map((model) => model.slug)
        .join(", ");
      return `${provider.provider}: ${models}`;
    });

  return lines.length > 0
    ? `Available worker models: ${lines.join("; ")}. Model aliases are accepted for known provider models, for example Claude Opus 4.7 can be requested as provider claudeAgent with model opus-4.7.`
    : "No worker models are currently available; omit provider/model only when Dynamo should return a clear selection error.";
}

function buildTools(providers: ReadonlyArray<ServerProvider>) {
  const workerModelDescription = describeWorkerModels(providers);
  return [
    {
      name: "team.spawn_child",
      description: `Spawn a bounded child agent task. Provider and model are optional; Dynamo chooses the best available worker when omitted. ${workerModelDescription}`,
      inputSchema: spawnChildSchema(),
    },
    {
      name: "team_spawn_child",
      description: `Spawn a bounded Dynamo child agent task. Use this for team/delegation/subagent requests. Provider and model are optional; Dynamo chooses the best available worker when omitted. ${workerModelDescription}`,
      inputSchema: spawnChildSchema(),
    },
    {
      name: "team.list_children",
      description: "List child agent tasks for this coordinator thread.",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
    },
    {
      name: "team_list_children",
      description: "List Dynamo child agent tasks for this coordinator thread.",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
    },
    {
      name: "team.wait_for_children",
      description: "Wait for child agent tasks to settle or until timeout.",
      inputSchema: {
        type: "object",
        properties: { timeoutSeconds: { type: "integer", minimum: 1, maximum: 300 } },
        additionalProperties: true,
      },
    },
    {
      name: "team_wait_for_children",
      description: "Wait for Dynamo child agent tasks to settle or until timeout.",
      inputSchema: {
        type: "object",
        properties: { timeoutSeconds: { type: "integer", minimum: 1, maximum: 300 } },
        additionalProperties: true,
      },
    },
    {
      name: "team.send_child_message",
      description: "Send a follow-up message to a child agent task.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string" }, message: { type: "string" } },
        required: ["taskId", "message"],
        additionalProperties: false,
      },
    },
    {
      name: "team_send_child_message",
      description: "Send a follow-up message to a Dynamo child agent task.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string" }, message: { type: "string" } },
        required: ["taskId", "message"],
        additionalProperties: false,
      },
    },
    {
      name: "team.close_child",
      description: "Stop a child agent task.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string" }, reason: { type: "string" } },
        required: ["taskId"],
        additionalProperties: false,
      },
    },
    {
      name: "team_close_child",
      description: "Stop a Dynamo child agent task.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string" }, reason: { type: "string" } },
        required: ["taskId"],
        additionalProperties: false,
      },
    },
  ];
}

export const teamMcpRouteLayer = HttpRouter.add(
  "POST",
  "/api/team-mcp",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const access = yield* TeamCoordinatorAccess;
    const team = yield* TeamOrchestrationService;
    const providerRegistry = yield* ProviderRegistry;
    const body = (yield* request.json) as {
      readonly id?: unknown;
      readonly method?: string;
      readonly params?: { readonly name?: string; readonly arguments?: Record<string, unknown> };
    };
    const id = body.id ?? null;
    const isNotification = body.id === undefined;

    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      return jsonRpcError(id, -32001, "Missing bearer token.");
    }
    const parentThreadId = yield* access.authenticate({ token });
    if (Option.isNone(parentThreadId)) {
      return jsonRpcError(id, -32001, "Invalid bearer token.");
    }

    if (body.method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: "dynamo-team", version: "1.0.0" },
        capabilities: { tools: {} },
      });
    }
    if (body.method === "notifications/initialized") {
      return emptyResponse();
    }
    if (body.method === "ping") {
      return isNotification ? emptyResponse() : jsonRpcResult(id, {});
    }
    if (body.method === "tools/list" || body.method === "tools/call") {
      const parentAccess = yield* Effect.exit(
        team.listChildren({ parentThreadId: parentThreadId.value }),
      );
      if (Exit.isFailure(parentAccess)) {
        return jsonRpcError(id, -32001, "Team coordinator access is no longer valid.");
      }
    }
    if (body.method === "tools/list") {
      const providers = yield* providerRegistry.getProviders;
      return jsonRpcResult(id, { tools: buildTools(providers) });
    }
    if (body.method !== "tools/call") {
      return isNotification
        ? emptyResponse()
        : jsonRpcError(id, -32601, `Unsupported method '${body.method ?? "unknown"}'.`);
    }

    const args = body.params?.arguments ?? {};
    const name = body.params?.name;
    const runTool = Effect.gen(function* () {
      switch (name) {
        case "team.spawn_child":
        case "team_spawn_child":
          return yield* team.spawnChild({
            parentThreadId: parentThreadId.value,
            title: String(args.title ?? "Child task"),
            task: String(args.task ?? ""),
            ...(typeof args.roleLabel === "string" ? { roleLabel: args.roleLabel } : {}),
            ...(typeof args.taskKind === "string" ? { taskKind: args.taskKind as never } : {}),
            ...(typeof args.contextBrief === "string" ? { contextBrief: args.contextBrief } : {}),
            ...(Array.isArray(args.relevantFiles)
              ? {
                  relevantFiles: args.relevantFiles.filter(
                    (entry): entry is string => typeof entry === "string",
                  ),
                }
              : {}),
            ...(typeof args.provider === "string" ? { provider: args.provider as never } : {}),
            ...(typeof args.model === "string" ? { model: args.model } : {}),
            ...(typeof args.workspaceMode === "string"
              ? { workspaceMode: args.workspaceMode as never }
              : {}),
            ...(typeof args.setupMode === "string" ? { setupMode: args.setupMode as never } : {}),
          });
        case "team.list_children":
        case "team_list_children":
          return yield* team.listChildren({ parentThreadId: parentThreadId.value });
        case "team.wait_for_children":
        case "team_wait_for_children":
          return yield* team.waitForChildren({
            parentThreadId: parentThreadId.value,
            ...(typeof args.timeoutSeconds === "number"
              ? { timeoutSeconds: args.timeoutSeconds }
              : {}),
          });
        case "team.send_child_message":
        case "team_send_child_message":
          return yield* team.sendChildMessage({
            parentThreadId: parentThreadId.value,
            taskId: String(args.taskId ?? "") as never,
            message: String(args.message ?? ""),
          });
        case "team.close_child":
        case "team_close_child":
          return yield* team.closeChild({
            parentThreadId: parentThreadId.value,
            taskId: String(args.taskId ?? "") as never,
            ...(typeof args.reason === "string" ? { reason: args.reason } : {}),
          });
        default:
          throw new Error(`Unknown tool '${name ?? "unknown"}'.`);
      }
    });

    const result = yield* Effect.exit(runTool);
    if (Exit.isFailure(result)) {
      return jsonRpcResult(id, toolResult({ error: "Team tool failed." }, true));
    }
    return jsonRpcResult(id, toolResult(result.value));
  }),
);

const teamMcpHealthRouteLayer = HttpRouter.add(
  "GET",
  "/api/team-mcp",
  Effect.succeed(emptyResponse()),
);

export const teamMcpRoutesLayer = Layer.mergeAll(teamMcpRouteLayer, teamMcpHealthRouteLayer);
