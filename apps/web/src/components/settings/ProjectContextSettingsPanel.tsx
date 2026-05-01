import type {
  ModelSelection,
  ProjectIntelligenceSurfaceId,
  ProviderKind,
} from "@t3tools/contracts";
import { LayersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  describeModelSelection,
  resolveModelContextWindowTokens,
} from "../../lib/modelContextWindow";
import { useServerConfig } from "../../rpc/serverState";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import type { Project } from "../../types";
import { ProjectIntelligencePanel } from "../project-intelligence/ProjectIntelligencePanel";

interface ModelOption {
  readonly providerKind: ProviderKind;
  readonly providerLabel: string;
  readonly modelSlug: string;
  readonly modelLabel: string;
}

/**
 * Settings sub-page that wraps ProjectIntelligencePanel in `viewMode="project"`,
 * defaulting to the new context-inspector section. When multiple projects exist,
 * shows a small picker so the user can pick which project's defaults to manage.
 *
 * The model picker on this page is a "what if" lever: it changes the displayed
 * context window (so users can see how their loadout reads against Sonnet vs.
 * Opus vs. GPT-5) without changing the project's actual default model.
 */
export function ProjectContextSettingsPanel() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const serverConfig = useServerConfig();
  const providers = serverConfig?.providers ?? [];

  // Default selection: first project in the active environment, then any first project.
  const defaultProject = useMemo<Project | null>(() => {
    if (projects.length === 0) return null;
    if (activeEnvironmentId) {
      const inEnv = projects.find((p) => p.environmentId === activeEnvironmentId);
      if (inEnv) return inEnv;
    }
    return projects[0] ?? null;
  }, [projects, activeEnvironmentId]);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? defaultProject ?? null;

  // What-if model. null means "use the project's default model".
  const [whatIfSelection, setWhatIfSelection] = useState<ModelSelection | null>(null);

  const effectiveSelection: ModelSelection | null =
    whatIfSelection ?? selectedProject?.defaultModelSelection ?? null;

  const modelOptions = useMemo<ModelOption[]>(() => {
    const out: ModelOption[] = [];
    for (const provider of providers) {
      if (!provider.enabled) continue;
      for (const model of provider.models) {
        if (model.isCustom) continue;
        out.push({
          providerKind: provider.provider,
          providerLabel:
            { codex: "Codex", claudeAgent: "Claude", cursor: "Cursor", opencode: "OpenCode" }[
              provider.provider
            ] ?? provider.provider,
          modelSlug: model.slug,
          modelLabel: model.name,
        });
      }
    }
    return out;
  }, [providers]);

  const contextMaxTokens = useMemo(
    () => resolveModelContextWindowTokens(providers, effectiveSelection),
    [providers, effectiveSelection],
  );
  const activeModel = useMemo(
    () => describeModelSelection(providers, effectiveSelection),
    [providers, effectiveSelection],
  );

  const [section, setSection] = useState<
    Parameters<React.ComponentProps<typeof ProjectIntelligencePanel>["onSelectSection"]>[0]
  >("context-inspector");
  const [surfaceId, setSurfaceId] = useState<ProjectIntelligenceSurfaceId | null>(null);

  if (!selectedProject) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center text-muted-foreground">
        <LayersIcon className="size-6" aria-hidden="true" />
        <p className="text-sm">
          Add a project from the sidebar to manage its context defaults.
        </p>
      </div>
    );
  }

  // Cycle through model options on pill click. Cheap "what-if" picker — for a
  // full picker UI we'd reach for the existing ProviderModelPicker, but a
  // single-button cycler keeps the surface tiny for v1.
  const handlePickModel = () => {
    if (modelOptions.length === 0) return;
    const currentIdx = modelOptions.findIndex(
      (option) =>
        effectiveSelection != null &&
        option.providerKind === effectiveSelection.provider &&
        option.modelSlug === effectiveSelection.model,
    );
    const nextIdx = (currentIdx + 1) % modelOptions.length;
    const next = modelOptions[nextIdx];
    if (!next) return;
    setWhatIfSelection({
      provider: next.providerKind,
      model: next.modelSlug,
    } as ModelSelection);
  };

  const handleResetWhatIf = () => setWhatIfSelection(null);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs">
        {projects.length > 1 ? (
          <div className="flex items-center gap-2">
            <span className="font-mono uppercase tracking-[0.16em] text-muted-foreground">
              Project
            </span>
            <select
              value={selectedProject.id}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {modelOptions.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="font-mono uppercase tracking-[0.16em] text-muted-foreground">
              Model
            </span>
            <select
              value={
                effectiveSelection
                  ? `${effectiveSelection.provider}::${effectiveSelection.model}`
                  : ""
              }
              onChange={(event) => {
                const [providerKind, modelSlug] = event.target.value.split("::");
                if (!providerKind || !modelSlug) {
                  setWhatIfSelection(null);
                  return;
                }
                setWhatIfSelection({
                  provider: providerKind as ProviderKind,
                  model: modelSlug,
                } as ModelSelection);
              }}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              {modelOptions.map((option) => (
                <option
                  key={`${option.providerKind}::${option.modelSlug}`}
                  value={`${option.providerKind}::${option.modelSlug}`}
                >
                  {option.providerLabel} · {option.modelLabel}
                </option>
              ))}
            </select>
            {whatIfSelection ? (
              <button
                type="button"
                onClick={handleResetWhatIf}
                className="rounded border border-border bg-background px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                Use default
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ProjectIntelligencePanel
          viewMode="project"
          environmentId={selectedProject.environmentId}
          projectCwd={selectedProject.cwd}
          effectiveCwd={null}
          projectTitle={selectedProject.name}
          section={section}
          surfaceId={surfaceId}
          canSwitchToThread={false}
          contextMaxTokens={contextMaxTokens}
          {...(activeModel
            ? {
                contextActiveModel: {
                  providerLabel: activeModel.providerLabel,
                  modelLabel: activeModel.modelLabel,
                },
              }
            : {})}
          contextOnPickModel={handlePickModel}
          onClose={() => undefined}
          onSelectSection={(next) => {
            setSection(next);
            setSurfaceId(null);
          }}
          onSelectSurface={setSurfaceId}
        />
      </div>
    </div>
  );
}
