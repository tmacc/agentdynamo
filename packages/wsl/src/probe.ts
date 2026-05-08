import type { ProviderId, ProviderProbeDistro } from "@t3tools/contracts";

import { runWslExe } from "./command.ts";

const PROVIDERS: readonly ProviderId[] = ["claude", "codex", "t3"];

export interface ProbeWslDistroResult extends ProviderProbeDistro {}

export async function probeWslDistro(distributionName: string): Promise<ProbeWslDistroResult> {
  try {
    const result = await runWslExe(
      [
        "-d",
        distributionName,
        "--",
        "sh",
        "-c",
        'for bin in claude codex t3 node; do if command -v "$bin" >/dev/null 2>&1; then printf \'%s=1\\n\' "$bin"; else printf \'%s=0\\n\' "$bin"; fi; done',
      ],
      { timeoutMs: 3_000 },
    );
    const present = new Set(
      result.stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.endsWith("=1"))
        .map((line) => line.slice(0, -2)),
    );
    return {
      distributionName,
      reachable: true,
      providers: PROVIDERS.filter((provider) => present.has(provider)),
      hasNode: present.has("node"),
    };
  } catch {
    return {
      distributionName,
      reachable: false,
      providers: [],
      hasNode: false,
    };
  }
}
