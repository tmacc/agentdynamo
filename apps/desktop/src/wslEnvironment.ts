import { spawn } from "node:child_process";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type {
  AuthBearerBootstrapResult,
  AuthSessionState,
  AuthWebSocketTokenResult,
  DesktopWslEnvironmentTarget,
  ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import { fetchLoopbackSshJson, type RemoteT3RunnerOptions } from "@t3tools/ssh/tunnel";
import { discoverWslDistributions } from "@t3tools/wsl/command";
import { WslEnvironmentManager } from "@t3tools/wsl/tunnel";
import { Effect, Layer, ManagedRuntime } from "effect";

const DISCOVER_WSL_DISTRIBUTIONS_CHANNEL = "desktop:discover-wsl-distributions";
const ENSURE_WSL_ENVIRONMENT_CHANNEL = "desktop:ensure-wsl-environment";
const DISCONNECT_WSL_ENVIRONMENT_CHANNEL = "desktop:disconnect-wsl-environment";
const FETCH_WSL_ENVIRONMENT_DESCRIPTOR_CHANNEL = "desktop:fetch-wsl-environment-descriptor";
const BOOTSTRAP_WSL_BEARER_SESSION_CHANNEL = "desktop:bootstrap-wsl-bearer-session";
const FETCH_WSL_SESSION_STATE_CHANNEL = "desktop:fetch-wsl-session-state";
const ISSUE_WSL_WEBSOCKET_TOKEN_CHANNEL = "desktop:issue-wsl-websocket-token";
const OPEN_WSL_PATH_IN_EDITOR_CHANNEL = "desktop:open-wsl-path-in-editor";

const wslRuntime = ManagedRuntime.make(
  Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici),
);

export interface DesktopWslEnvironmentManagerOptions {
  readonly resolveCliRunner?: () => RemoteT3RunnerOptions;
}

export class DesktopWslEnvironmentManager {
  private readonly manager: WslEnvironmentManager;

  constructor(options: DesktopWslEnvironmentManagerOptions = {}) {
    this.manager = new WslEnvironmentManager(options);
  }

  async discoverDistributions() {
    return await discoverWslDistributions();
  }

  async ensureEnvironment(
    target: DesktopWslEnvironmentTarget,
    options?: { readonly issuePairingToken?: boolean },
  ) {
    return await this.manager.ensureEnvironment(target, options);
  }

  async disconnectEnvironment(target: DesktopWslEnvironmentTarget): Promise<void> {
    await this.manager.disconnectEnvironment(target);
  }
}

export interface DesktopWslBridgeIpcMain {
  removeHandler(channel: string): void;
  handle(
    channel: string,
    listener: (event: unknown, ...args: readonly unknown[]) => unknown | Promise<unknown>,
  ): void;
}

export interface DesktopWslEnvironmentBridgeOptions {
  readonly resolveCliRunner?: () => RemoteT3RunnerOptions;
}

function getSafeDesktopWslTarget(rawTarget: unknown): DesktopWslEnvironmentTarget | null {
  if (typeof rawTarget !== "object" || rawTarget === null) return null;
  const distributionName = (rawTarget as Partial<DesktopWslEnvironmentTarget>).distributionName;
  if (typeof distributionName !== "string" || distributionName.trim().length === 0) return null;
  return { distributionName: distributionName.trim() };
}

function runEditorCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: process.platform === "win32",
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", () => {
      reject(new Error("VS Code is required to open WSL paths from the Windows desktop app."));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function splitPathAndLine(path: string): { readonly path: string; readonly line: string | null } {
  const match = /^(?<path>.+):(?<line>\d+)$/u.exec(path);
  const parsedPath = match?.groups?.path;
  const line = match?.groups?.line;
  return parsedPath && line ? { path: parsedPath, line } : { path, line: null };
}

export class DesktopWslEnvironmentBridge {
  private readonly manager: DesktopWslEnvironmentManager;

  constructor(options: DesktopWslEnvironmentBridgeOptions = {}) {
    this.manager = new DesktopWslEnvironmentManager(options);
  }

  registerIpcHandlers(ipcMain: DesktopWslBridgeIpcMain): void {
    ipcMain.removeHandler(DISCOVER_WSL_DISTRIBUTIONS_CHANNEL);
    ipcMain.handle(DISCOVER_WSL_DISTRIBUTIONS_CHANNEL, async () =>
      this.manager.discoverDistributions(),
    );

    ipcMain.removeHandler(ENSURE_WSL_ENVIRONMENT_CHANNEL);
    ipcMain.handle(ENSURE_WSL_ENVIRONMENT_CHANNEL, async (_event, rawTarget, rawOptions) => {
      const target = getSafeDesktopWslTarget(rawTarget);
      if (!target) throw new Error("Invalid desktop WSL target.");
      const issuePairingToken =
        typeof rawOptions === "object" &&
        rawOptions !== null &&
        (rawOptions as { issuePairingToken?: unknown }).issuePairingToken === true;
      return await this.manager.ensureEnvironment(target, { issuePairingToken });
    });

    ipcMain.removeHandler(DISCONNECT_WSL_ENVIRONMENT_CHANNEL);
    ipcMain.handle(DISCONNECT_WSL_ENVIRONMENT_CHANNEL, async (_event, rawTarget) => {
      const target = getSafeDesktopWslTarget(rawTarget);
      if (!target) throw new Error("Invalid desktop WSL target.");
      await this.manager.disconnectEnvironment(target);
    });

    ipcMain.removeHandler(FETCH_WSL_ENVIRONMENT_DESCRIPTOR_CHANNEL);
    ipcMain.handle(FETCH_WSL_ENVIRONMENT_DESCRIPTOR_CHANNEL, async (_event, rawHttpBaseUrl) =>
      wslRuntime.runPromise(
        fetchLoopbackSshJson<ExecutionEnvironmentDescriptor>({
          httpBaseUrl: rawHttpBaseUrl,
          pathname: "/.well-known/t3/environment",
        }),
      ),
    );

    ipcMain.removeHandler(BOOTSTRAP_WSL_BEARER_SESSION_CHANNEL);
    ipcMain.handle(
      BOOTSTRAP_WSL_BEARER_SESSION_CHANNEL,
      async (_event, rawHttpBaseUrl, rawCredential) =>
        wslRuntime.runPromise(
          fetchLoopbackSshJson<AuthBearerBootstrapResult>({
            httpBaseUrl: rawHttpBaseUrl,
            pathname: "/api/auth/bootstrap/bearer",
            method: "POST",
            body: { credential: rawCredential },
          }),
        ),
    );

    ipcMain.removeHandler(FETCH_WSL_SESSION_STATE_CHANNEL);
    ipcMain.handle(
      FETCH_WSL_SESSION_STATE_CHANNEL,
      async (_event, rawHttpBaseUrl, rawBearerToken) =>
        wslRuntime.runPromise(
          fetchLoopbackSshJson<AuthSessionState>({
            httpBaseUrl: rawHttpBaseUrl,
            pathname: "/api/auth/session",
            bearerToken: rawBearerToken,
          }),
        ),
    );

    ipcMain.removeHandler(ISSUE_WSL_WEBSOCKET_TOKEN_CHANNEL);
    ipcMain.handle(
      ISSUE_WSL_WEBSOCKET_TOKEN_CHANNEL,
      async (_event, rawHttpBaseUrl, rawBearerToken) =>
        wslRuntime.runPromise(
          fetchLoopbackSshJson<AuthWebSocketTokenResult>({
            httpBaseUrl: rawHttpBaseUrl,
            pathname: "/api/auth/ws-token",
            method: "POST",
            bearerToken: rawBearerToken,
          }),
        ),
    );

    ipcMain.removeHandler(OPEN_WSL_PATH_IN_EDITOR_CHANNEL);
    ipcMain.handle(OPEN_WSL_PATH_IN_EDITOR_CHANNEL, async (_event, rawInput) => {
      if (typeof rawInput !== "object" || rawInput === null) {
        throw new Error("Invalid WSL editor open request.");
      }
      const input = rawInput as {
        target?: unknown;
        path?: unknown;
        editor?: unknown;
      };
      const target = getSafeDesktopWslTarget(input.target);
      if (!target || typeof input.path !== "string") {
        throw new Error("Invalid WSL editor open request.");
      }
      if (input.editor !== "vscode" && input.editor !== "vscode-insiders") {
        throw new Error(
          "Only VS Code and VS Code Insiders support WSL editor opens in this release.",
        );
      }
      const command = input.editor === "vscode-insiders" ? "code-insiders" : "code";
      const parsed = splitPathAndLine(input.path);
      const remote = `wsl+${target.distributionName}`;
      const args = parsed.line
        ? ["--remote", remote, "--goto", `${parsed.path}:${parsed.line}`]
        : ["--remote", remote, parsed.path];
      await runEditorCommand(command, args);
    });
  }

  async dispose(): Promise<void> {
    await wslRuntime.runPromise(Effect.void);
    await wslRuntime.dispose();
  }
}
