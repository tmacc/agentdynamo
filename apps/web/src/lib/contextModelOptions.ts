import type { ModelSelection, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";

export interface ContextModelOption {
  readonly key: string;
  readonly instanceId: ProviderInstanceId;
  readonly providerLabel: string;
  readonly modelSlug: string;
  readonly modelLabel: string;
  readonly contextWindowValue?: string | undefined;
  readonly contextWindowLabel?: string | undefined;
  readonly isDefaultContextWindow?: boolean | undefined;
}

const CONTEXT_WINDOW_OPTION_ID = "contextWindow";

function contextWindowValue(selection: ModelSelection | null | undefined): string | undefined {
  const value = selection?.options?.find((entry) => entry.id === CONTEXT_WINDOW_OPTION_ID)?.value;
  return typeof value === "string" ? value : undefined;
}

export function contextModelOptionKey(input: {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly contextWindowValue?: string | undefined;
}): string {
  return `${input.instanceId}::${input.model}::${input.contextWindowValue ?? ""}`;
}

export function modelSelectionKey(selection: ModelSelection | null | undefined): string {
  if (!selection) return "";
  return contextModelOptionKey({
    instanceId: selection.instanceId,
    model: selection.model,
    contextWindowValue: contextWindowValue(selection),
  });
}

export function resolveContextModelOptionKey(
  options: ReadonlyArray<ContextModelOption>,
  selection: ModelSelection | null | undefined,
): string {
  if (!selection) return "";
  const exact = modelSelectionKey(selection);
  if (options.some((option) => option.key === exact)) return exact;
  const sameModel = options.filter(
    (option) => option.instanceId === selection.instanceId && option.modelSlug === selection.model,
  );
  return (
    sameModel.find((option) => option.isDefaultContextWindow)?.key ?? sameModel[0]?.key ?? exact
  );
}

export function modelSelectionFromContextOption(option: ContextModelOption): ModelSelection {
  return {
    instanceId: option.instanceId,
    model: option.modelSlug,
    ...(option.contextWindowValue
      ? {
          options: [
            {
              id: CONTEXT_WINDOW_OPTION_ID,
              value: option.contextWindowValue,
            },
          ],
        }
      : {}),
  };
}

export function buildContextModelOptions(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ContextModelOption> {
  const options: ContextModelOption[] = [];
  for (const provider of providers) {
    // This picker is a what-if context-window preview, not a dispatch target.
    // Keep configured provider/model metadata visible even when the provider is
    // temporarily unavailable so the sidebar can still preview the thread's
    // model/window shape.
    if (!provider.enabled || provider.models.length === 0) {
      continue;
    }
    const providerLabel = provider.displayName ?? provider.instanceId;
    for (const model of provider.models) {
      if (model.isCustom) continue;
      const descriptor = model.capabilities?.optionDescriptors?.find(
        (entry) => entry.id === CONTEXT_WINDOW_OPTION_ID,
      );
      if (descriptor?.type === "select" && descriptor.options.length > 0) {
        for (const choice of descriptor.options) {
          options.push({
            key: contextModelOptionKey({
              instanceId: provider.instanceId,
              model: model.slug,
              contextWindowValue: choice.id,
            }),
            instanceId: provider.instanceId,
            providerLabel,
            modelSlug: model.slug,
            modelLabel: model.name,
            contextWindowValue: choice.id,
            contextWindowLabel: choice.label,
            isDefaultContextWindow:
              choice.isDefault === true || choice.id === descriptor.currentValue,
          });
        }
        continue;
      }
      options.push({
        key: contextModelOptionKey({
          instanceId: provider.instanceId,
          model: model.slug,
        }),
        instanceId: provider.instanceId,
        providerLabel,
        modelSlug: model.slug,
        modelLabel: model.name,
      });
    }
  }
  return options;
}
