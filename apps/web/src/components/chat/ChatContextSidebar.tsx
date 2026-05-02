import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationThreadActivity,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import type { ProjectIntelligenceSurfaceId } from "@t3tools/contracts";
import { PanelRightCloseIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { Button } from "../ui/button";
import { ProjectIntelligencePanel } from "../project-intelligence/ProjectIntelligencePanel";
import { useProjectIntelligenceNavigation } from "../../hooks/useProjectIntelligenceNavigation";
import { deriveLatestContextWindowSnapshot } from "~/lib/contextWindow";
import {
  buildContextModelOptions,
  modelSelectionFromContextOption,
  resolveContextModelOptionKey,
} from "~/lib/contextModelOptions";
import { describeModelSelection, resolveModelContextWindowTokens } from "~/lib/modelContextWindow";

/**
 * Thin wrapper that mounts ProjectIntelligencePanel docked inside the chat
 * RightPanelDock in `viewMode="thread"`, defaulting to the new
 * `"context-inspector"` section. Read-only on the project loadout, with an
 * action that opens the docked project context manager.
 */
export const ChatContextSidebar = memo(function ChatContextSidebar(props: {
  environmentId: EnvironmentId | null;
  projectCwd: string | null;
  effectiveCwd: string | null;
  projectTitle: string | null;
  threadId: ThreadId | null;
  threadModelSelection: ModelSelection | null;
  threadActivities: ReadonlyArray<OrchestrationThreadActivity> | null;
  providers: ReadonlyArray<ServerProvider>;
  onClose: () => void;
}) {
  const projectIntelligenceNavigation = useProjectIntelligenceNavigation();
  const { environmentId, onClose, projectCwd } = props;
  const [section, setSection] =
    useState<
      Parameters<React.ComponentProps<typeof ProjectIntelligencePanel>["onSelectSection"]>[0]
    >("context-inspector");
  const [surfaceId, setSurfaceId] = useState<ProjectIntelligenceSurfaceId | null>(null);
  const [whatIfSelection, setWhatIfSelection] = useState<ModelSelection | null>(null);
  const effectiveSelection = whatIfSelection ?? props.threadModelSelection;
  const modelOptions = useMemo(() => buildContextModelOptions(props.providers), [props.providers]);
  const selectedModelOptionKey = useMemo(
    () => resolveContextModelOptionKey(modelOptions, effectiveSelection),
    [effectiveSelection, modelOptions],
  );

  const handleSelectSection = useCallback((next: typeof section) => {
    setSection(next);
    // Drop the focused surface when switching to/from the inspector to avoid
    // re-opening the surface detail drawer on top of the inspector.
    setSurfaceId(null);
  }, []);

  // Resolve the active context window: prefer the live `maxTokens` reported
  // in the latest context-window activity event (server-derived, accounts for
  // chosen options). Fall back to a static lookup against the model selection.
  const contextMaxTokens = useMemo(() => {
    if (!whatIfSelection) {
      const snapshot = deriveLatestContextWindowSnapshot(props.threadActivities ?? []);
      if (snapshot?.maxTokens && snapshot.maxTokens > 0) return snapshot.maxTokens;
    }
    return resolveModelContextWindowTokens(props.providers, effectiveSelection);
  }, [effectiveSelection, props.providers, props.threadActivities, whatIfSelection]);

  const activeModel = useMemo(
    () => describeModelSelection(props.providers, effectiveSelection),
    [props.providers, effectiveSelection],
  );

  const handlePickModel = useCallback(() => {
    if (modelOptions.length === 0) return;
    const currentIdx = modelOptions.findIndex((option) => option.key === selectedModelOptionKey);
    const next = modelOptions[(currentIdx + 1) % modelOptions.length];
    if (!next) return;
    setWhatIfSelection(modelSelectionFromContextOption(next));
  }, [modelOptions, selectedModelOptionKey]);

  const handleOpenProjectContext = useCallback(() => {
    if (!projectCwd) return;
    projectIntelligenceNavigation.open({
      viewMode: "project",
      environmentId,
      projectCwd,
      effectiveCwd: null,
      section: "context-inspector",
      surfaceId: null,
    });
    onClose();
  }, [environmentId, onClose, projectCwd, projectIntelligenceNavigation]);

  if (!props.projectCwd) {
    return (
      <div className="flex h-full w-full flex-col bg-card/50">
        <SidebarHeader onClose={props.onClose} />
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
          Open a thread inside a project to inspect its context.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-card/50">
      {modelOptions.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-background px-3 py-2 text-xs">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Preview
          </span>
          <select
            value={selectedModelOptionKey}
            onChange={(event) => {
              const next = modelOptions.find((option) => option.key === event.target.value);
              if (!next) {
                setWhatIfSelection(null);
                return;
              }
              setWhatIfSelection(modelSelectionFromContextOption(next));
            }}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            aria-label="Preview context window by model"
          >
            {modelOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.providerLabel} · {option.modelLabel}
                {option.contextWindowLabel ? ` · ${option.contextWindowLabel}` : ""}
              </option>
            ))}
          </select>
          {whatIfSelection ? (
            <button
              type="button"
              onClick={() => setWhatIfSelection(null)}
              className="rounded border border-border bg-background px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              Use thread
            </button>
          ) : null}
        </div>
      ) : null}
      <ProjectIntelligencePanel
        viewMode="thread"
        environmentId={props.environmentId}
        projectCwd={props.projectCwd}
        effectiveCwd={props.effectiveCwd}
        projectTitle={props.projectTitle}
        section={section}
        surfaceId={surfaceId}
        canSwitchToThread={false}
        threadId={props.threadId}
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
        onOpenProjectContext={handleOpenProjectContext}
        contextThreadActivities={props.threadActivities ?? []}
        onClose={props.onClose}
        onSelectSection={handleSelectSection}
        onSelectSurface={setSurfaceId}
      />
    </div>
  );
});

function SidebarHeader(props: { onClose: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Context
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={props.onClose}
        aria-label="Close context sidebar"
        className="text-muted-foreground/60 hover:text-foreground"
      >
        <PanelRightCloseIcon className="size-3.5" />
      </Button>
    </div>
  );
}
