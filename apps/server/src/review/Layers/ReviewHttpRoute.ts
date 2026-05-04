import { ReviewCancelInput, ReviewStartInput } from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "../../auth/Services/ServerAuth.ts";
import { respondToAuthError } from "../../auth/http.ts";
import { ReviewOrchestrator } from "../Services/ReviewOrchestrator.ts";

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* Effect.fail(new Error("Only owner sessions can start code reviews."));
  }
  return session;
});

const respondToReviewRouteError = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "AuthError"
  ) {
    return respondToAuthError(error as Parameters<typeof respondToAuthError>[0]);
  }
  return Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    ),
  );
};

const startReviewRoute = HttpRouter.add(
  "POST",
  "/api/threads/:threadId/review/start",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const body = (yield* request.json.pipe(Effect.catch(() => Effect.succeed({})))) as {
      readonly prRef?: unknown;
    };
    const input = yield* Schema.decodeUnknownEffect(ReviewStartInput)({
      threadId: params.threadId,
      ...(typeof body.prRef === "string" && body.prRef.trim() ? { prRef: body.prRef.trim() } : {}),
    }).pipe(
      Effect.mapError((cause) => new Error(`Invalid review start payload: ${String(cause)}`)),
    );
    const review = yield* ReviewOrchestrator;
    const result = yield* review.start(input);
    return HttpServerResponse.jsonUnsafe(result, { status: 202 });
  }).pipe(Effect.catch(respondToReviewRouteError)),
);

const cancelReviewRoute = HttpRouter.add(
  "POST",
  "/api/threads/:threadId/review/cancel",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const params = yield* HttpRouter.params;
    const input = yield* Schema.decodeUnknownEffect(ReviewCancelInput)({
      threadId: params.threadId,
    }).pipe(
      Effect.mapError((cause) => new Error(`Invalid review cancel payload: ${String(cause)}`)),
    );
    const review = yield* ReviewOrchestrator;
    const result = yield* review.cancel(input);
    return HttpServerResponse.jsonUnsafe(result, { status: 200 });
  }).pipe(Effect.catch(respondToReviewRouteError)),
);

const getReviewRoute = HttpRouter.add(
  "GET",
  "/api/threads/:threadId/review",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const params = yield* HttpRouter.params;
    const input = yield* Schema.decodeUnknownEffect(ReviewCancelInput)({
      threadId: params.threadId,
    }).pipe(
      Effect.mapError((cause) => new Error(`Invalid review lookup payload: ${String(cause)}`)),
    );
    const review = yield* ReviewOrchestrator;
    const result = yield* review.getResult(input.threadId);
    return HttpServerResponse.jsonUnsafe(result, { status: 200 });
  }).pipe(Effect.catch(respondToReviewRouteError)),
);

export const reviewHttpRoutesLayer = Layer.mergeAll(
  startReviewRoute,
  cancelReviewRoute,
  getReviewRoute,
);
