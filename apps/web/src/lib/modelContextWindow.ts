import type { ModelSelection, ProviderDriverKind, ServerProvider } from "@t3tools/contracts";

const FALLBACK_WINDOW = 200_000;

function defaultWindowForDriver(driver: ProviderDriverKind | undefined): number {
  switch (driver) {
    case "codex":
      return 400_000;
    case "claudeAgent":
      return 200_000;
    case "cursor":
      return 200_000;
    case "opencode":
      return 128_000;
    default:
      return FALLBACK_WINDOW;
  }
}

function parseTokenLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const match = label
    .trim()
    .toLowerCase()
    .match(/^([0-9]+(?:\.[0-9]+)?)\s*([km])?$/);
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
  const providerEntry = providers.find((entry) => entry.instanceId === selection.instanceId);
  const model = providerEntry?.models.find((entry) => entry.slug === selection.model);
  const caps = model?.capabilities;

  // 1) Explicit option set on this thread/project's selection.
  const explicit = parseTokenLabel(
    selection.options?.find((entry) => entry.id === "contextWindow")?.value.toString(),
  );
  if (explicit) return explicit;

  // 2) Model's default contextWindow option, if it has one.
  const contextDescriptor = caps?.optionDescriptors?.find(
    (descriptor) => descriptor.id === "contextWindow",
  );
  if (contextDescriptor?.type === "select" && contextDescriptor.options.length > 0) {
    const defaultOption =
      contextDescriptor.options.find((entry) => entry.isDefault) ??
      contextDescriptor.options.find((entry) => entry.id === contextDescriptor.currentValue) ??
      contextDescriptor.options[0];
    const fromOption = parseTokenLabel(defaultOption?.id ?? defaultOption?.label);
    if (fromOption) return fromOption;
  }

  // 3) Provider default.
  return defaultWindowForDriver(providerEntry?.driver);
}

export function describeModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection | null | undefined,
): { providerLabel: string; modelLabel: string; maxTokens: number } | null {
  if (!selection) return null;
  const providerEntry = providers.find((entry) => entry.instanceId === selection.instanceId);
  const model = providerEntry?.models.find((entry) => entry.slug === selection.model);
  return {
    providerLabel: providerEntry?.displayName ?? selection.instanceId,
    modelLabel: model?.name ?? selection.model,
    maxTokens: resolveModelContextWindowTokens(providers, selection),
  };
}
