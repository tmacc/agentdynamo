import { spawn } from "node:child_process";
import * as Crypto from "node:crypto";

import type { DesktopWslDistribution, DesktopWslEnvironmentTarget } from "@t3tools/contracts";

import { WslCommandError, WslInvalidTargetError } from "./errors.ts";

const DEFAULT_WSL_COMMAND_TIMEOUT_MS = 60_000;

export interface WslCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunWslCommandOptions {
  readonly stdin?: string;
  readonly shellArgs?: readonly string[];
  readonly timeoutMs?: number;
}

export function normalizeWslOutput(stdout: string): string {
  return stdout.split(String.fromCharCode(0)).join("").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeWslState(value: string): DesktopWslDistribution["state"] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "running") return "running";
  if (normalized === "stopped") return "stopped";
  if (normalized === "installing") return "installing";
  return "unknown";
}

export function parseWslListVerboseOutput(stdout: string): readonly DesktopWslDistribution[] {
  const lines = normalizeWslOutput(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rows = lines.filter(
    (line) => !/^name\s+state\s+version$/iu.test(line.replace(/^\*\s*/u, "")),
  );

  return rows.flatMap((line) => {
    const isDefault = line.startsWith("*");
    const content = line.replace(/^\*\s*/u, "").trim();
    const match = /^(?<name>.+?)\s{2,}(?<state>\S+)\s+(?<version>[12])$/u.exec(content);
    const name = match?.groups?.name;
    const state = match?.groups?.state;
    const version = match?.groups?.version;
    if (!name || !state || !version) return [];
    return [
      {
        name: name.trim(),
        isDefault,
        state: normalizeWslState(state),
        version: version === "1" ? 1 : 2,
      } satisfies DesktopWslDistribution,
    ];
  });
}

export function parseWslListQuietOutput(stdout: string): readonly DesktopWslDistribution[] {
  return normalizeWslOutput(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name, index) => ({
      name,
      isDefault: index === 0,
      state: "unknown",
      version: null,
    }));
}

export function resolveDefaultWslDistribution(
  distributions: readonly DesktopWslDistribution[],
): DesktopWslDistribution | null {
  return (
    distributions.find(
      (distribution) => distribution.isDefault && distribution.state !== "installing",
    ) ??
    distributions.find((distribution) => distribution.state !== "installing") ??
    null
  );
}

export function wslTargetConnectionKey(target: DesktopWslEnvironmentTarget): string {
  return target.distributionName.trim();
}

export function wslRemoteStateKey(target: DesktopWslEnvironmentTarget): string {
  return Crypto.createHash("sha256")
    .update(wslTargetConnectionKey(target))
    .digest("hex")
    .slice(0, 16);
}

export async function runWslExe(
  args: readonly string[],
  options: RunWslCommandOptions = {},
): Promise<WslCommandResult> {
  const command = ["wsl.exe", ...args];
  return await new Promise<WslCommandResult>((resolve, reject) => {
    const child = spawn("wsl.exe", [...args], {
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new WslCommandError({
          command,
          exitCode: null,
          stderr: "",
          message: `WSL command timed out after ${options.timeoutMs ?? DEFAULT_WSL_COMMAND_TIMEOUT_MS}ms.`,
        }),
      );
    }, options.timeoutMs ?? DEFAULT_WSL_COMMAND_TIMEOUT_MS);
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.once("error", (cause) => {
      clearTimeout(timeout);
      reject(
        new WslCommandError({
          command,
          exitCode: null,
          stderr: "",
          message:
            process.platform === "win32"
              ? "WSL is not installed or wsl.exe is unavailable on PATH."
              : "WSL launch is only available on Windows.",
          cause,
        }),
      );
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const looksUtf16 = stdoutBuffer.some((byte, index) => index % 2 === 1 && byte === 0);
      const stdout = normalizeWslOutput(stdoutBuffer.toString(looksUtf16 ? "utf16le" : "utf8"));
      const utf8Stdout = normalizeWslOutput(Buffer.concat(stdoutChunks).toString("utf8"));
      const stderr = normalizeWslOutput(Buffer.concat(stderrChunks).toString("utf8"));
      const effectiveStdout = stdout.replace(/\uFFFD/g, "").trim().length > 0 ? stdout : utf8Stdout;
      if (exitCode !== 0) {
        reject(
          new WslCommandError({
            command,
            exitCode,
            stderr,
            message: stderr.trim() || `WSL command failed (exit ${exitCode ?? "unknown"}).`,
          }),
        );
        return;
      }
      resolve({ stdout: effectiveStdout, stderr });
    });
    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export async function discoverWslDistributions(): Promise<readonly DesktopWslDistribution[]> {
  try {
    const verbose = await runWslExe(["--list", "--verbose"], { timeoutMs: 10_000 });
    const parsed = parseWslListVerboseOutput(verbose.stdout);
    if (parsed.length > 0) return parsed;
  } catch {
    // Fall back to quiet discovery below for older or noisy WSL installs.
  }
  const quiet = await runWslExe(["--list", "--quiet"], { timeoutMs: 10_000 });
  return parseWslListQuietOutput(quiet.stdout);
}

export async function validateWslTarget(
  target: DesktopWslEnvironmentTarget,
): Promise<DesktopWslEnvironmentTarget> {
  const distributionName = target.distributionName.trim();
  if (distributionName.length === 0) {
    throw new WslInvalidTargetError("WSL distribution name is required.");
  }
  const distributions = await discoverWslDistributions();
  const distribution = distributions.find((entry) => entry.name === distributionName);
  if (!distribution) {
    throw new WslInvalidTargetError(`WSL distribution ${distributionName} was not found.`);
  }
  if (distribution.state === "installing") {
    throw new WslInvalidTargetError(`WSL distribution ${distributionName} is still installing.`);
  }
  return { distributionName };
}

export async function runWslShell(
  target: DesktopWslEnvironmentTarget,
  options: RunWslCommandOptions = {},
): Promise<WslCommandResult> {
  const validated = await validateWslTarget(target);
  return await runWslExe(
    ["-d", validated.distributionName, "--", "sh", "-s", "--", ...(options.shellArgs ?? [])],
    options,
  );
}
