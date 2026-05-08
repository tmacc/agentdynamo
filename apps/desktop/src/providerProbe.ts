import { spawn } from "node:child_process";

import type { ProviderId, ProviderProbeResult, ProviderProbeWindowsHost } from "@t3tools/contracts";
import { discoverWslDistributions } from "@t3tools/wsl/command";
import { probeWslDistro } from "@t3tools/wsl/probe";

const PROVIDERS: readonly ProviderId[] = ["claude", "codex", "t3"];
const CACHE_TTL_MS = 10 * 60 * 1000;
let cachedProbe: ProviderProbeResult | null = null;

function runWhere(provider: ProviderId): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("where.exe", [provider], {
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timeout = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 1_000);
    timeout.unref();
    child.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

export async function probeWindowsHostProviders(): Promise<ProviderProbeWindowsHost> {
  if (process.platform !== "win32") {
    return { providers: [] };
  }
  const results = await Promise.all(
    PROVIDERS.map(async (provider) => [provider, await runWhere(provider)] as const),
  );
  return { providers: results.filter(([, found]) => found).map(([provider]) => provider) };
}

export async function probeProviderAvailability(options?: {
  readonly force?: boolean;
}): Promise<ProviderProbeResult> {
  if (!options?.force && cachedProbe && Date.now() - cachedProbe.collectedAt < CACHE_TTL_MS) {
    return cachedProbe;
  }
  const windowsHost = await probeWindowsHostProviders().catch(() => ({ providers: [] }));
  const distributions =
    process.platform === "win32" ? await discoverWslDistributions().catch(() => []) : [];
  const distros = await Promise.all(
    distributions
      .filter((distribution) => distribution.state !== "installing")
      .map((distribution) => probeWslDistro(distribution.name)),
  );
  cachedProbe = {
    windowsHost,
    distros,
    collectedAt: Date.now(),
  };
  return cachedProbe;
}
