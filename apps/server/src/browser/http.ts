import { Effect, Exit, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { BrowserMcpAccess } from "./Services/BrowserMcpAccess.ts";
import { BrowserService } from "./Services/BrowserService.ts";

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

function buildTools() {
  const emptySchema = { type: "object", properties: {}, additionalProperties: false };
  return [
    {
      name: "browser_experience",
      description:
        "Run Dynamo's intent-level browser experience primitive. Prefer this for synthetic user feedback, visual QA, onboarding/user-flow exploration, and friction discovery. Dynamo compiles the goal into deterministic local browser probes and returns objective observations, friction hypotheses, evidence, and decision boundaries without using a separate LLM.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          persona: { type: "string" },
          goal: { type: "string" },
          mode: { type: "string" },
          budget: {
            type: "object",
            properties: {
              maxMinutes: { type: "number", minimum: 0 },
              maxBranches: { type: "integer", minimum: 0 },
              viewports: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
    {
      name: "browser.open",
      description: "Open a localhost URL in Dynamo's thread-scoped browser and return a compact semantic snapshot.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "browser_open",
      description: "Open a localhost URL in Dynamo's thread-scoped browser and return a compact semantic snapshot.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "browser.snapshot",
      description: "Return the current browser semantic UI graph, compact summary, console errors, and failed requests.",
      inputSchema: emptySchema,
    },
    {
      name: "browser_snapshot",
      description: "Return the current browser semantic UI graph, compact summary, console errors, and failed requests.",
      inputSchema: emptySchema,
    },
    {
      name: "browser.screenshot",
      description: "Capture a full-page screenshot artifact for the current browser page.",
      inputSchema: emptySchema,
    },
    {
      name: "browser_screenshot",
      description: "Capture a full-page screenshot artifact for the current browser page.",
      inputSchema: emptySchema,
    },
    {
      name: "browser.reset",
      description: "Reset this thread's browser session and create a fresh browser page.",
      inputSchema: emptySchema,
    },
    {
      name: "browser_reset",
      description: "Reset this thread's browser session and create a fresh browser page.",
      inputSchema: emptySchema,
    },
    {
      name: "browser.close",
      description: "Close this thread's browser session.",
      inputSchema: emptySchema,
    },
    {
      name: "browser_close",
      description: "Close this thread's browser session.",
      inputSchema: emptySchema,
    },
  ];
}

export const browserMcpRouteLayer = HttpRouter.add(
  "POST",
  "/api/browser-mcp",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const access = yield* BrowserMcpAccess;
    const browser = yield* BrowserService;
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
    const grant = yield* access.authenticate({ token });
    if (Option.isNone(grant)) {
      return jsonRpcError(id, -32001, "Invalid bearer token.");
    }

    if (body.method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: "dynamo-browser", version: "1.0.0" },
        capabilities: { tools: {} },
      });
    }
    if (body.method === "notifications/initialized") {
      return emptyResponse();
    }
    if (body.method === "ping") {
      return isNotification ? emptyResponse() : jsonRpcResult(id, {});
    }
    if (body.method === "tools/list") {
      return jsonRpcResult(id, { tools: buildTools() });
    }
    if (body.method !== "tools/call") {
      return isNotification
        ? emptyResponse()
        : jsonRpcError(id, -32601, `Unsupported method '${body.method ?? "unknown"}'.`);
    }

    const args = body.params?.arguments ?? {};
    const name = body.params?.name;
    const threadId = grant.value.threadId;
    const runTool = Effect.gen(function* () {
      switch (name) {
        case "browser_experience":
          return yield* browser.experience({
            threadId,
            target: String(args.target ?? ""),
            ...(typeof args.persona === "string" ? { persona: args.persona } : {}),
            ...(typeof args.goal === "string" ? { goal: args.goal } : {}),
            ...(typeof args.mode === "string" ? { mode: args.mode } : {}),
            ...(typeof args.budget === "object" && args.budget !== null
              ? { budget: args.budget as never }
              : {}),
          });
        case "browser.open":
        case "browser_open":
          return yield* browser.open({ threadId, url: String(args.url ?? "") });
        case "browser.snapshot":
        case "browser_snapshot":
          return yield* browser.snapshot({ threadId });
        case "browser.screenshot":
        case "browser_screenshot":
          return yield* browser.screenshot({ threadId });
        case "browser.reset":
        case "browser_reset":
          return yield* browser.reset({ threadId });
        case "browser.close":
        case "browser_close":
          yield* browser.close({ threadId });
          return { closed: true };
        default:
          throw new Error(`Unknown tool '${name ?? "unknown"}'.`);
      }
    });

    const result = yield* Effect.exit(runTool);
    if (Exit.isFailure(result)) {
      return jsonRpcResult(id, toolResult({ error: "Browser tool failed." }, true));
    }
    return jsonRpcResult(id, toolResult(result.value));
  }),
);

const browserMcpHealthRouteLayer = HttpRouter.add(
  "GET",
  "/api/browser-mcp",
  Effect.succeed(emptyResponse()),
);

export const browserMcpRoutesLayer = Layer.mergeAll(
  browserMcpRouteLayer,
  browserMcpHealthRouteLayer,
);
