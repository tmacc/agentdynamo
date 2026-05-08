import type {
  DesktopWslEnvironmentBootstrap,
  DesktopWslEnvironmentTarget,
} from "@t3tools/contracts";
import {
  buildRemoteLaunchScript,
  buildRemotePairingScript,
  buildRemoteStopScript,
  type RemoteT3RunnerOptions,
} from "@t3tools/ssh/tunnel";
import { remoteStateKey } from "@t3tools/ssh/command";

import { runWslShell, validateWslTarget } from "./command.ts";
import { WslLaunchError } from "./errors.ts";

function decodeLastJsonLine(stdout: string): unknown {
  const line =
    stdout
      .trim()
      .split(/\r?\n/u)
      .findLast((entry) => entry.trim().length > 0) ?? "";
  return JSON.parse(line);
}

function wslPairingScript(target: DesktopWslEnvironmentTarget, runner?: RemoteT3RunnerOptions) {
  return buildRemotePairingScript(toSshLikeTarget(target), runner).replaceAll(
    "$HOME/.t3/ssh-launch/",
    "$HOME/.t3/wsl-launch/",
  );
}

function wslStopScript(target: DesktopWslEnvironmentTarget) {
  return buildRemoteStopScript(toSshLikeTarget(target)).replaceAll(
    "$HOME/.t3/ssh-launch/",
    "$HOME/.t3/wsl-launch/",
  );
}

function toSshLikeTarget(target: DesktopWslEnvironmentTarget) {
  return {
    alias: target.distributionName,
    hostname: target.distributionName,
    username: null,
    port: null,
  };
}

export interface WslEnvironmentManagerOptions {
  readonly resolveCliRunner?: () => RemoteT3RunnerOptions;
}

export class WslEnvironmentManager {
  private readonly resolveCliRunner: (() => RemoteT3RunnerOptions) | undefined;

  constructor(options: WslEnvironmentManagerOptions = {}) {
    this.resolveCliRunner = options.resolveCliRunner;
  }

  async ensureEnvironment(
    target: DesktopWslEnvironmentTarget,
    options?: { readonly issuePairingToken?: boolean },
  ): Promise<DesktopWslEnvironmentBootstrap> {
    const validated = await validateWslTarget(target);
    const runner = this.resolveCliRunner?.();
    const launchScript = buildRemoteLaunchScript(runner).replaceAll(
      "$HOME/.t3/ssh-launch/",
      "$HOME/.t3/wsl-launch/",
    );
    const launchResult = await runWslShell(validated, {
      stdin: launchScript,
      shellArgs: [remoteStateKey(toSshLikeTarget(validated))],
      timeoutMs: 30_000,
    });
    const parsed = decodeLastJsonLine(launchResult.stdout);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Number.isInteger((parsed as { remotePort?: unknown }).remotePort)
    ) {
      throw new WslLaunchError("WSL backend launch returned an invalid port.");
    }
    const remotePort = (parsed as { remotePort: number }).remotePort;
    const serverKind =
      (parsed as { serverKind?: unknown }).serverKind === "external" ||
      (parsed as { serverKind?: unknown }).serverKind === "managed"
        ? (parsed as { serverKind: "external" | "managed" }).serverKind
        : "managed";

    const httpBaseUrl = `http://127.0.0.1:${remotePort}`;
    const wsBaseUrl = `ws://127.0.0.1:${remotePort}`;
    const pairingToken = options?.issuePairingToken
      ? await this.issuePairingToken(validated, runner)
      : null;

    return {
      target: validated,
      httpBaseUrl,
      wsBaseUrl,
      pairingToken,
      remotePort,
      remoteServerKind: serverKind,
    };
  }

  async disconnectEnvironment(target: DesktopWslEnvironmentTarget): Promise<void> {
    const validated = await validateWslTarget(target);
    await runWslShell(validated, {
      stdin: wslStopScript(validated),
      timeoutMs: 15_000,
    });
  }

  private async issuePairingToken(
    target: DesktopWslEnvironmentTarget,
    runner?: RemoteT3RunnerOptions,
  ): Promise<string> {
    const result = await runWslShell(target, {
      stdin: wslPairingScript(target, runner),
      timeoutMs: 30_000,
    });
    const parsed = decodeLastJsonLine(result.stdout);
    const credential =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { credential?: unknown }).credential
        : null;
    if (typeof credential !== "string" || credential.trim().length === 0) {
      throw new WslLaunchError("WSL pairing command returned an empty credential.");
    }
    return credential;
  }
}
