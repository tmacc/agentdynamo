import type { ModelSelection, ProviderKind, ServerProvider } from "@t3tools/contracts";

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
};

// Sensible per-provider fallback when no contextWindow option is configured on
// the model's capabilities. These match commonly-cited public windows; if a
// future model exposes a different capability, the explicit option wins.
const PROVIDER_DEFAULT_WINDOW: Record<ProviderKind, number> = {
  codex: 400_000,
  claudeAgent: 200_000,
  cursor: 200_000,
  opencode: 128_000,
};

const FALLBACK_WINDOW = 200_000;

function parseTokenLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const match = label.trim().toLowerCase().match(/^([0-9]+(?:\.[0-9]+)?)\s*([km])?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2] === "k") return Math.round(value * 1_000);
  if (match[2] === "m") return Math.round(value * 1_000_000);
  return Math.round(value);
}

export function resolveModelContextWindowTokens(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection | null | undefined,
): number {
  if (!selection) return FALLBACK_WINDOW;
  const providerEntry = providers.find((entry) => entry.provider === selection.provider);
  const model = providerEntry?.models.find((entry) => entry.slug === selection.model);
  const caps = model?.capabilities;

  // 1) Explicit option set on this thread/project's selection. Not all
  //    providers expose `contextWindow` on their options struct (e.g. Codex
  //    options have only `reasoningEffort`/`fastMode`); access defensively.
  const optionsAny = selection.options as { contextWindow?: string } | undefined;
  const explicit = parseTokenLabel(optionsAny?.contextWindow);
  if (explicit) return explicit;

  // 2) Model's default contextWindow option, if it has one.
  if (caps?.contextWindowOptions && caps.contextWindowOptions.length > 0) {
    const defaultOption =
      caps.contextWindowOptions.find((entry) => entry.isDefault) ?? caps.contextWindowOptions[0];
    const fromOption = parseTokenLabel(defaultOption?.value);
    if (fromOption) return fromOption;
  }

  // 3) Provider default.
  return PROVIDER_DEFAULT_WINDOW[selection.provider] ?? FALLBACK_WINDOW;
}

export function describeModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection | null | undefined,
): { providerLabel: string; modelLabel: string; maxTokens: number } | null {
  if (!selection) return null;
  const providerEntry = providers.find((entry) => entry.provider === selection.provider);
  const model = providerEntry?.models.find((entry) => entry.slug === selection.model);
  return {
    providerLabel: PROVIDER_LABELS[selection.provider] ?? selection.provider,
    modelLabel: model?.name ?? selection.model,
    maxTokens: resolveModelContextWindowTokens(providers, selection),
  };
}
