import { Link, useNavigate } from "@tanstack/react-router";
import { TerminalIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  connectDesktopWslEnvironment,
  getSavedEnvironmentDesktopTarget,
  useSavedEnvironmentRegistryStore,
} from "~/environments/runtime";
import { useProviderProbe } from "~/hooks/useProviderProbe";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";

const DISMISS_KEY = "dynamo:wsl-suggestion-dismissed-at";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isDismissed(): boolean {
  const value = Number(window.localStorage.getItem(DISMISS_KEY) ?? "");
  return Number.isFinite(value) && Date.now() - value < DISMISS_TTL_MS;
}

export function WslSuggestionBanner() {
  const navigate = useNavigate();
  const { status, result } = useProviderProbe();
  const [dismissed, setDismissed] = useState(() => isDismissed());
  const [connecting, setConnecting] = useState(false);
  const hasSavedWslEnvironment = useSavedEnvironmentRegistryStore((state) =>
    Object.values(state.byId).some(
      (record) => getSavedEnvironmentDesktopTarget(record)?.kind === "wsl",
    ),
  );

  const suggestedDistro = useMemo(() => {
    if (!result || result.windowsHost.providers.length > 0) return null;
    const reachable = result.distros.filter((distro) => distro.reachable);
    return reachable.find((distro) => distro.providers.length > 0) ?? reachable[0] ?? null;
  }, [result]);

  if (
    dismissed ||
    hasSavedWslEnvironment ||
    status !== "ready" ||
    !suggestedDistro ||
    !window.desktopBridge?.probeProviderAvailability
  ) {
    return null;
  }

  const hasProviders = suggestedDistro.providers.length > 0;
  const title = hasProviders
    ? `Claude Code detected in ${suggestedDistro.distributionName}`
    : "WSL detected on this machine";
  const body = hasProviders
    ? "Connect Dynamo to your existing WSL setup."
    : "Set up Claude Code or Codex inside WSL to run AI agents natively on Linux.";

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  return (
    <div className="w-full max-w-lg rounded-lg border border-border/70 bg-card/45 px-4 py-3 text-left shadow-sm/5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
          <TerminalIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {hasProviders ? (
              <Button
                size="xs"
                disabled={connecting}
                onClick={() => {
                  setConnecting(true);
                  void connectDesktopWslEnvironment({
                    distributionName: suggestedDistro.distributionName,
                  })
                    .then(() => setDismissed(true))
                    .catch((error) => {
                      toastManager.add(
                        stackedThreadToast({
                          type: "error",
                          title: "Could not connect WSL",
                          description:
                            error instanceof Error ? error.message : "Failed to connect WSL.",
                        }),
                      );
                    })
                    .finally(() => setConnecting(false));
                }}
              >
                {connecting ? "Connecting..." : "Connect to WSL"}
              </Button>
            ) : (
              <Button size="xs" onClick={() => void navigate({ to: "/settings/connections" })}>
                Set up WSL
              </Button>
            )}
            {hasProviders ? (
              <Button size="xs" variant="outline" render={<Link to="/settings/connections" />}>
                Customize
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={dismiss}>
              Dismiss
            </Button>
          </div>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Dismiss WSL suggestion"
          onClick={dismiss}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
