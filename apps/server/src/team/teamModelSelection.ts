import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  type OrchestrationProject,
  type OrchestrationThread,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
  type ServerSettings,
  type TeamTaskKind,
  type TeamTaskModelSelectionMode,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";

export interface SelectTeamWorkerModelInput {
  readonly taskKind: TeamTaskKind;
  readonly requestedProvider?: ProviderKind;
  readonly requestedModel?: string;
  readonly parentThread: OrchestrationThread;
  readonly project: OrchestrationProject;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: ServerSettings;
}

export interface TeamModelSelectionResult {
  readonly modelSelection: ModelSelection;
  readonly mode: TeamTaskModelSelectionMode;
  readonly reason: string;
}

export class TeamModelSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamModelSelectionError";
  }
}

function createSelection(instanceId: ProviderInstanceId, model: string): ModelSelection {
  return { instanceId, model };
}

function enabledWorkerProviders(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.status !== "disabled" &&
      provider.models.length > 0 &&
      provider.teamCapabilities?.supportsWorker !== false,
  );
}

function resolveRequestedModel(
  provider: ServerProvider | undefined,
  model: string | undefined,
): string | null {
  if (!provider || !model) return null;
  return resolveSelectableModel(provider.driver, model, provider.models);
}

function isValidSelection(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection | null | undefined,
): selection is ModelSelection {
  if (!selection) return false;
  const provider = enabledWorkerProviders(providers).find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  return resolveRequestedModel(provider, selection.model) === selection.model;
}

function taskKindScore(taskKind: TeamTaskKind, provider: ProviderKind): number {
  switch (taskKind) {
    case "coding":
    case "test":
    case "ui":
      return provider === "codex"
        ? 40
        : provider === "claudeAgent"
          ? 35
          : provider === "cursor"
            ? 30
            : 20;
    case "review":
      return provider === "claudeAgent"
        ? 40
        : provider === "codex"
          ? 35
          : provider === "cursor"
            ? 25
            : 20;
    case "exploration":
    case "docs":
      return provider === "codex"
        ? 35
        : provider === "claudeAgent"
          ? 30
          : provider === "opencode"
            ? 25
            : 20;
    case "general":
    default:
      return 20;
  }
}

function modelScore(model: ServerProvider["models"][number], taskKind: TeamTaskKind): number {
  const caps = model.capabilities;
  const teamCaps = model.teamCapabilities;
  const preferred = teamCaps?.preferredTaskKinds.includes(taskKind) ? 30 : 0;
  const rank = teamCaps?.workerRank ?? 50;
  const effortScore =
    (caps?.optionDescriptors?.find((descriptor) => descriptor.id === "effort")?.type === "select"
      ? 1
      : 0) * 3;
  const thinkingScore =
    caps?.optionDescriptors?.some((descriptor) => descriptor.id === "thinking") === true ? 4 : 0;
  const fastScore =
    taskKind === "exploration" || taskKind === "docs"
      ? caps?.optionDescriptors?.some((descriptor) => descriptor.id === "fastMode") === true
        ? 8
        : 0
      : 0;
  const customPenalty = model.isCustom ? -5 : 0;
  return preferred + rank + effortScore + thinkingScore + fastScore + customPenalty;
}

function bestAvailableSelection(
  providers: ReadonlyArray<ServerProvider>,
  taskKind: TeamTaskKind,
): {
  readonly driver: ProviderKind;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
} | null {
  let best: {
    driver: ProviderKind;
    instanceId: ProviderInstanceId;
    model: string;
    score: number;
  } | null = null;
  for (const provider of enabledWorkerProviders(providers)) {
    for (const model of provider.models) {
      const score = taskKindScore(taskKind, provider.driver) + modelScore(model, taskKind);
      if (!best || score > best.score) {
        best = {
          driver: provider.driver,
          instanceId: provider.instanceId,
          model: model.slug,
          score,
        };
      }
    }
  }
  return best;
}

export function selectTeamWorkerModel(input: SelectTeamWorkerModelInput): TeamModelSelectionResult {
  const providers = enabledWorkerProviders(input.providers);
  if (providers.length === 0) {
    throw new TeamModelSelectionError("No enabled provider models are available for team workers.");
  }

  if (input.requestedProvider || input.requestedModel) {
    const provider = providers.find((entry) => entry.driver === input.requestedProvider);
    const requestedModel = resolveRequestedModel(provider, input.requestedModel);
    if (provider && requestedModel) {
      return {
        modelSelection: createSelection(provider.instanceId, requestedModel),
        mode: "user-specified",
        reason:
          requestedModel === input.requestedModel
            ? `Coordinator requested ${provider.driver}/${requestedModel}.`
            : `Coordinator requested ${provider.driver}/${input.requestedModel}; normalized to ${requestedModel}.`,
      };
    }
    throw new TeamModelSelectionError(
      `Requested team worker model is unavailable: ${input.requestedProvider ?? "any"}/${input.requestedModel ?? "default"}.`,
    );
  }

  const best = bestAvailableSelection(providers, input.taskKind);
  if (best) {
    return {
      modelSelection: createSelection(best.instanceId, best.model),
      mode: "coordinator-selected",
      reason: `Selected as the best available ${input.taskKind} worker from installed providers.`,
    };
  }

  if (isValidSelection(providers, input.project.defaultModelSelection)) {
    return {
      modelSelection: input.project.defaultModelSelection,
      mode: "fallback",
      reason: "Fell back to the project default model.",
    };
  }
  if (isValidSelection(providers, input.parentThread.modelSelection)) {
    return {
      modelSelection: input.parentThread.modelSelection,
      mode: "fallback",
      reason: "Fell back to the coordinator thread model.",
    };
  }

  const provider = providers[0];
  const model = provider?.models.find((candidate) => !candidate.isCustom) ?? provider?.models[0];
  if (provider && model) {
    return {
      modelSelection: createSelection(
        provider.instanceId,
        model.slug ?? DEFAULT_MODEL_BY_PROVIDER[provider.driver] ?? model.slug,
      ),
      mode: "fallback",
      reason: "Fell back to the first available worker model.",
    };
  }

  throw new TeamModelSelectionError("No available worker model could be selected.");
}
