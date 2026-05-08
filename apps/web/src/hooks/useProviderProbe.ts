import type { ProviderProbeResult } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

let sharedResult: ProviderProbeResult | null = null;
let sharedPromise: Promise<ProviderProbeResult> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function runProbe(options?: { readonly force?: boolean }) {
  if (!options?.force && sharedResult) return Promise.resolve(sharedResult);
  if (!options?.force && sharedPromise) return sharedPromise;
  const bridge = window.desktopBridge;
  if (!bridge?.probeProviderAvailability) {
    return Promise.reject(new Error("Provider probe is not available."));
  }
  sharedPromise = bridge
    .probeProviderAvailability(options)
    .then((result) => {
      sharedResult = result;
      emit();
      return result;
    })
    .finally(() => {
      sharedPromise = null;
    });
  return sharedPromise;
}

export function useProviderProbe(): {
  status: "idle" | "loading" | "ready" | "error";
  result: ProviderProbeResult | undefined;
  refresh: (options?: { force?: boolean }) => void;
} {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    sharedResult ? "ready" : "idle",
  );
  const [result, setResult] = useState<ProviderProbeResult | undefined>(sharedResult ?? undefined);

  const refresh = useCallback((options?: { force?: boolean }) => {
    setStatus("loading");
    void runProbe(options).then(
      (nextResult) => {
        setResult(nextResult);
        setStatus("ready");
      },
      () => setStatus("error"),
    );
  }, []);

  useEffect(() => {
    const listener = () => {
      setResult(sharedResult ?? undefined);
      setStatus(sharedResult ? "ready" : "idle");
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (sharedResult || !window.desktopBridge?.probeProviderAvailability) return;
    const callback = () => refresh();
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(callback);
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(callback, 0);
    return () => globalThis.clearTimeout(id);
  }, [refresh]);

  return { status, result, refresh };
}
