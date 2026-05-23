/**
 * AnalyticsServiceLive - Anonymous PostHog telemetry layer.
 *
 * Persists a random installation-scoped anonymous id to state dir, buffers
 * events in memory, and flushes batches to PostHog over Effect HttpClient.
 *
 * @module AnalyticsServiceLive
 */

import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ServerConfig } from "../../config.ts";
import { AnalyticsService, type AnalyticsServiceShape } from "../Services/AnalyticsService.ts";
import { getTelemetryIdentifier } from "../Identify.ts";
import packageJson from "../../../package.json" with { type: "json" };

interface BufferedAnalyticsEvent {
  readonly event: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
}

const TelemetryEnvConfig = Config.all({
  dynamoPosthogKey: Config.string("DYNAMO_POSTHOG_KEY").pipe(Config.option),
  legacyPosthogKey: Config.string("T3CODE_POSTHOG_KEY").pipe(Config.option),
  dynamoPosthogHost: Config.string("DYNAMO_POSTHOG_HOST").pipe(Config.option),
  legacyPosthogHost: Config.string("T3CODE_POSTHOG_HOST").pipe(Config.option),
  dynamoEnabled: Config.boolean("DYNAMO_TELEMETRY_ENABLED").pipe(Config.option),
  legacyEnabled: Config.boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.option),
  flushBatchSize: Config.number("T3CODE_TELEMETRY_FLUSH_BATCH_SIZE").pipe(Config.withDefault(20)),
  maxBufferedEvents: Config.number("T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS").pipe(
    Config.withDefault(1_000),
  ),
});

const DEFAULT_POSTHOG_KEY = "phc_zjcrAS9WAN5dhkiPKF8WeJJvdNbHrkwTtyNp9b9rdPbr";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const optionStringToNonEmpty = (value: Option.Option<string>) => {
  const trimmed = Option.getOrUndefined(value)?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const optionStringToUndefined = (value: Option.Option<string>) =>
  Option.getOrUndefined(value)?.trim();

const optionBooleanToUndefined = (value: Option.Option<boolean>) => Option.getOrUndefined(value);

const normalizePosthogHost = (value: string) => value.replace(/\/+$/, "");

const makeAnalyticsService = Effect.gen(function* () {
  const rawTelemetryConfig = yield* TelemetryEnvConfig.asEffect();
  const posthogKey =
    optionStringToNonEmpty(rawTelemetryConfig.dynamoPosthogKey) ??
    optionStringToNonEmpty(rawTelemetryConfig.legacyPosthogKey) ??
    DEFAULT_POSTHOG_KEY;
  const posthogHost = normalizePosthogHost(
    optionStringToUndefined(rawTelemetryConfig.dynamoPosthogHost) ??
      optionStringToUndefined(rawTelemetryConfig.legacyPosthogHost) ??
      DEFAULT_POSTHOG_HOST,
  );
  const telemetryEnabled =
    optionBooleanToUndefined(rawTelemetryConfig.dynamoEnabled) ??
    optionBooleanToUndefined(rawTelemetryConfig.legacyEnabled) ??
    true;
  const httpClient = yield* HttpClient.HttpClient;
  const serverConfig = yield* ServerConfig;
  const identifier = yield* getTelemetryIdentifier;
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedAnalyticsEvent>>([]);
  const clientType = serverConfig.mode === "desktop" ? "desktop-app" : "cli-web-client";

  const enqueueBufferedEvent = (event: string, properties?: Readonly<Record<string, unknown>>) =>
    Effect.flatMap(DateTime.now, (now) =>
      Ref.modify(bufferRef, (current) => {
        const appended = [
          ...current,
          {
            event,
            ...(properties ? { properties } : {}),
            capturedAt: DateTime.formatIso(now),
          } satisfies BufferedAnalyticsEvent,
        ];

        const next =
          appended.length > rawTelemetryConfig.maxBufferedEvents
            ? appended.slice(appended.length - rawTelemetryConfig.maxBufferedEvents)
            : appended;

        return [
          {
            size: next.length,
            dropped: next.length !== appended.length,
          } as const,
          next,
        ] as const;
      }),
    );

  const sendBatch = Effect.fn("sendBatch")(function* (
    events: ReadonlyArray<BufferedAnalyticsEvent>,
  ) {
    if (!telemetryEnabled || !identifier) return;

    const payload = {
      api_key: posthogKey,
      batch: events.map((event) => ({
        event: event.event,
        distinct_id: identifier,
        properties: {
          ...event.properties,
          $process_person_profile: false,
          platform: process.platform,
          wsl: process.env.WSL_DISTRO_NAME,
          arch: process.arch,
          t3CodeVersion: packageJson.version,
          clientType,
        },
        timestamp: event.capturedAt,
      })),
    };

    yield* HttpClientRequest.post(`${posthogHost}/batch/`).pipe(
      HttpClientRequest.bodyJson(payload),
      Effect.flatMap(httpClient.execute),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
  });

  const flush: AnalyticsServiceShape["flush"] = Effect.gen(function* () {
    while (true) {
      const batch = yield* Ref.modify(bufferRef, (current) => {
        if (current.length === 0) {
          return [[] as ReadonlyArray<BufferedAnalyticsEvent>, current] as const;
        }
        const nextBatch = current.slice(0, rawTelemetryConfig.flushBatchSize);
        const remaining = current.slice(nextBatch.length);
        return [nextBatch, remaining] as const;
      });

      if (batch.length === 0) {
        return;
      }

      yield* sendBatch(batch).pipe(
        Effect.catch((error) =>
          Ref.update(bufferRef, (current) => [...batch, ...current]).pipe(
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );
    }
  }).pipe(
    Effect.catch((cause) =>
      Effect.logDebug("Failed to flush telemetry; buffered events will be retried.", { cause }),
    ),
  );

  const record: AnalyticsServiceShape["record"] = Effect.fn("record")(
    function* (event, properties) {
      if (!telemetryEnabled || !identifier) return;

      const enqueueResult = yield* enqueueBufferedEvent(event, properties);
      if (enqueueResult.dropped) {
        yield* Effect.logDebug("analytics buffer full; dropping oldest event", {
          size: enqueueResult.size,
          event,
        });
      }
    },
  );

  yield* Effect.forever(Effect.sleep(1000).pipe(Effect.flatMap(() => flush)), {
    disableYield: true,
  }).pipe(Effect.forkScoped);

  yield* Effect.addFinalizer(() => flush);

  return {
    record,
    flush,
  } satisfies AnalyticsServiceShape;
});

export const AnalyticsServiceLayerLive = Layer.effect(AnalyticsService, makeAnalyticsService);
