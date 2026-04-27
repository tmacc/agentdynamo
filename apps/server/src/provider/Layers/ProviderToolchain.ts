import {
  DEFAULT_SERVER_SETTINGS,
  ProviderToolchainError,
  type ProviderToolchainCheckInput,
  type ProviderToolchainKind,
  type ProviderToolchainStatus,
  type ProviderToolchainUpdateInput,
  type ProviderToolchainUpdateMethod,
  type ServerProvider,
} from "@t3tools/contracts";
import { Duration, Effect, Layer, PubSub, Ref, Result, Stream } from "effect";
import * as Semaphore from "effect/Semaphore";

import { runProcess, type ProcessRunResult } from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { compareCliVersions } from "../cliVersion.ts";
import { ProviderRegistry } from "../Services/ProviderRegistry.ts";
import { ProviderToolchain } from "../Services/ProviderToolchain.ts";

const SUPPORTED_PROVIDERS = ["codex", "claudeAgent"] as const;
const LATEST_VERSION_CACHE_TTL_MS = Duration.toMillis(Duration.minutes(15));
const LATEST_VERSION_TIMEOUT_MS = 4_000;
const UPDATE_TIMEOUT_MS = 180_000;
const UPDATE_OUTPUT_LIMIT_BYTES = 64 * 1024;

const NPM_LATEST_URLS: Record<ProviderToolchainKind, string> = {
  codex: "https://registry.npmjs.org/@openai%2Fcodex/latest",
  claudeAgent: "https://registry.npmjs.org/@anthropic-ai%2Fclaude-code/latest",
};

interface CachedLatestVersion {
  readonly version: string;
  readonly checkedAtMs: number;
}

export interface ProviderToolchainCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly method: ProviderToolchainUpdateMethod;
  readonly manualCommand: string;
}

const initialStatus = (provider: ProviderToolchainKind): ProviderToolchainStatus => ({
  provider,
  currentVersion: null,
  latestVersion: null,
  updateAvailable: null,
  checkState: "idle",
  updateState: "idle",
  method: null,
  checkedAt: null,
  updatedAt: null,
  message: null,
});

const displayProviderName = (provider: ProviderToolchainKind): string =>
  provider === "codex" ? "Codex" : "Claude";

const providerVersion = (
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderToolchainKind,
): string | null => providers.find((candidate) => candidate.provider === provider)?.version ?? null;

const providerInstalled = (
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderToolchainKind,
): boolean => providers.find((candidate) => candidate.provider === provider)?.installed === true;

function shellQuoteForDisplay(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function resolveProviderToolchainCommand(input: {
  readonly provider: ProviderToolchainKind;
  readonly binaryPath: string;
}): ProviderToolchainCommand {
  if (input.provider === "codex") {
    const defaultBinary = DEFAULT_SERVER_SETTINGS.providers.codex.binaryPath;
    const displayBinary =
      input.binaryPath === defaultBinary ? "codex" : shellQuoteForDisplay(input.binaryPath);
    return {
      command: input.binaryPath,
      args: ["--upgrade"],
      method: {
        kind: "self-updater",
        label: "Codex self-updater",
        displayCommand: `${displayBinary} --upgrade`,
        canRunInDynamo: true,
      },
      manualCommand: "npm i -g @openai/codex@latest",
    };
  }

  const defaultBinary = DEFAULT_SERVER_SETTINGS.providers.claudeAgent.binaryPath;
  const displayBinary =
    input.binaryPath === defaultBinary ? "claude" : shellQuoteForDisplay(input.binaryPath);
  return {
    command: input.binaryPath,
    args: ["update"],
    method: {
      kind: "self-updater",
      label: "Claude self-updater",
      displayCommand: `${displayBinary} update`,
      canRunInDynamo: true,
    },
    manualCommand: "claude update",
  };
}

export function parseNpmLatestVersion(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const version = (value as { readonly version?: unknown }).version;
  return typeof version === "string" && version.trim().length > 0 ? version.trim() : null;
}

function summarizeProcessResult(result: ProcessRunResult): string | null {
  const stderr = result.stderr.trim();
  if (stderr) return stderr;
  const stdout = result.stdout.trim();
  if (stdout) return stdout;
  if (result.timedOut) return "Updater command timed out.";
  if (result.code !== 0) return `Updater command exited with code ${result.code ?? "null"}.`;
  return null;
}

function truncateMessage(value: string): string {
  return value.length <= 1_000 ? value : `${value.slice(0, 1_000)}...`;
}

const latestVersionFromNpm = (provider: ProviderToolchainKind) =>
  Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LATEST_VERSION_TIMEOUT_MS);
      try {
        const response = await fetch(NPM_LATEST_URLS[provider], {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`npm registry returned HTTP ${response.status}`);
        }
        const latest = parseNpmLatestVersion(await response.json());
        if (!latest) {
          throw new Error("npm registry response did not include a version.");
        }
        return latest;
      } finally {
        clearTimeout(timeout);
      }
    },
    catch: (cause) =>
      new ProviderToolchainError({
        provider,
        message:
          cause instanceof Error ? cause.message : "Could not fetch latest provider version.",
      }),
  }) as Effect.Effect<string, ProviderToolchainError, never>;

export const ProviderToolchainLive = Layer.effect(
  ProviderToolchain,
  Effect.gen(function* () {
    const providerRegistry = yield* ProviderRegistry;
    const serverSettings = yield* ServerSettingsService;
    const changesPubSub = yield* PubSub.unbounded<ReadonlyArray<ProviderToolchainStatus>>();
    const statusesRef = yield* Ref.make<ReadonlyArray<ProviderToolchainStatus>>(
      SUPPORTED_PROVIDERS.map(initialStatus),
    );
    const latestCacheRef = yield* Ref.make(new Map<ProviderToolchainKind, CachedLatestVersion>());
    const updateSemaphore = yield* Semaphore.make(1);

    const updateStatus = Effect.fn("updateProviderToolchainStatus")(function* (
      provider: ProviderToolchainKind,
      update: (status: ProviderToolchainStatus) => ProviderToolchainStatus,
    ) {
      const statuses = yield* Ref.updateAndGet(statusesRef, (current) =>
        current.map((status) => (status.provider === provider ? update(status) : status)),
      );
      yield* PubSub.publish(changesPubSub, statuses);
      return statuses.find((status) => status.provider === provider)!;
    });

    const getCachedLatest = Effect.fn("getCachedLatest")(function* (
      provider: ProviderToolchainKind,
      force: boolean,
    ) {
      const now = Date.now();
      const cached = (yield* Ref.get(latestCacheRef)).get(provider);
      if (!force && cached && now - cached.checkedAtMs < LATEST_VERSION_CACHE_TTL_MS) {
        return cached.version;
      }
      const latest = yield* latestVersionFromNpm(provider);
      yield* Ref.update(latestCacheRef, (cache) => {
        const next = new Map(cache);
        next.set(provider, { version: latest, checkedAtMs: now });
        return next;
      });
      return latest;
    });

    const buildCheckedStatus = Effect.fn("buildCheckedStatus")(function* (
      provider: ProviderToolchainKind,
      force: boolean,
    ) {
      const checkedAt = new Date().toISOString();
      const providers = yield* providerRegistry.getProviders;
      const settings = yield* serverSettings.getSettings.pipe(Effect.orDie);
      const currentVersion = providerVersion(providers, provider);
      const installed = providerInstalled(providers, provider);
      const binaryPath = settings.providers[provider].binaryPath;
      const command = resolveProviderToolchainCommand({ provider, binaryPath });

      if (!installed) {
        return {
          ...initialStatus(provider),
          checkedAt,
          checkState: "unknown",
          message: `${displayProviderName(provider)} is not installed. Install it before checking updates.`,
        } satisfies ProviderToolchainStatus;
      }

      const latest = yield* getCachedLatest(provider, force).pipe(Effect.result);
      if (Result.isFailure(latest)) {
        return {
          provider,
          currentVersion,
          latestVersion: null,
          updateAvailable: null,
          checkState: "error",
          updateState: "idle",
          method: command.method,
          checkedAt,
          updatedAt: null,
          message: `Could not check latest ${displayProviderName(provider)} version: ${latest.failure.message}`,
        } satisfies ProviderToolchainStatus;
      }

      if (!currentVersion) {
        return {
          provider,
          currentVersion,
          latestVersion: latest.success,
          updateAvailable: null,
          checkState: "unknown",
          updateState: "idle",
          method: command.method,
          checkedAt,
          updatedAt: null,
          message: `Could not determine installed ${displayProviderName(provider)} version.`,
        } satisfies ProviderToolchainStatus;
      }

      const updateAvailable = compareCliVersions(currentVersion, latest.success) < 0;
      return {
        provider,
        currentVersion,
        latestVersion: latest.success,
        updateAvailable,
        checkState: updateAvailable ? "update-available" : "up-to-date",
        updateState: "idle",
        method: command.method,
        checkedAt,
        updatedAt: null,
        message: updateAvailable
          ? `${displayProviderName(provider)} ${latest.success} is available. Existing sessions keep using their current process.`
          : `${displayProviderName(provider)} is up to date.`,
      } satisfies ProviderToolchainStatus;
    });

    const checkOne = Effect.fn("checkProviderToolchainOne")(function* (
      provider: ProviderToolchainKind,
      force: boolean,
    ) {
      yield* updateStatus(provider, (status) => ({
        ...status,
        checkState: "checking",
        message: `Checking latest ${displayProviderName(provider)} version...`,
      }));
      const nextStatus = yield* buildCheckedStatus(provider, force);
      yield* updateStatus(provider, () => nextStatus);
      return nextStatus;
    });

    const check = Effect.fn("checkProviderToolchain")(function* (
      input: ProviderToolchainCheckInput,
    ) {
      const providers = input.provider ? [input.provider] : SUPPORTED_PROVIDERS;
      yield* Effect.forEach(providers, (provider) => checkOne(provider, input.force === true), {
        concurrency: "unbounded",
        discard: true,
      });
      return { statuses: yield* Ref.get(statusesRef) };
    });

    const update = (input: ProviderToolchainUpdateInput) =>
      updateSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const settings = yield* serverSettings.getSettings.pipe(Effect.orDie);
          const previous = (yield* Ref.get(statusesRef)).find(
            (status) => status.provider === input.provider,
          );
          const command = resolveProviderToolchainCommand({
            provider: input.provider,
            binaryPath: settings.providers[input.provider].binaryPath,
          });

          yield* updateStatus(input.provider, (status) => ({
            ...status,
            updateState: "updating",
            method: command.method,
            message: `Running ${command.method.displayCommand} on the connected backend environment...`,
          }));

          const result = yield* Effect.tryPromise({
            try: () =>
              runProcess(command.command, command.args, {
                timeoutMs: UPDATE_TIMEOUT_MS,
                allowNonZeroExit: true,
                maxBufferBytes: UPDATE_OUTPUT_LIMIT_BYTES,
                outputMode: "truncate",
              }),
            catch: (cause) =>
              new ProviderToolchainError({
                provider: input.provider,
                message: cause instanceof Error ? cause.message : "Updater command failed.",
              }),
          }).pipe(Effect.result);

          if (Result.isFailure(result) || result.success.timedOut || result.success.code !== 0) {
            const message = Result.isFailure(result)
              ? result.failure.message
              : (summarizeProcessResult(result.success) ?? "Updater command failed.");
            return yield* updateStatus(input.provider, (status) => ({
              ...status,
              updateState: "error",
              message: `${displayProviderName(input.provider)} update failed. ${truncateMessage(message)}`,
            }));
          }

          yield* providerRegistry.refresh(input.provider);
          const checked = yield* buildCheckedStatus(input.provider, true);
          const unchanged =
            previous?.currentVersion &&
            checked.currentVersion &&
            previous.currentVersion === checked.currentVersion;
          const finalStatus = {
            ...checked,
            updateState: unchanged ? ("error" as const) : ("updated" as const),
            updatedAt: new Date().toISOString(),
            message: unchanged
              ? `Updater finished, but ${displayProviderName(input.provider)} still appears to be v${checked.currentVersion}.`
              : `${displayProviderName(input.provider)} updated. New sessions use the refreshed provider binary.`,
          } satisfies ProviderToolchainStatus;
          yield* updateStatus(input.provider, () => finalStatus);
          if (unchanged) {
            return yield* new ProviderToolchainError({
              provider: input.provider,
              message:
                finalStatus.message ?? "Provider update did not change the installed version.",
            });
          }
          return finalStatus;
        }),
      );

    return {
      getStatuses: Ref.get(statusesRef),
      check,
      update,
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    };
  }),
);
