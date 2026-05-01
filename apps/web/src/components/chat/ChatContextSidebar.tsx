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
import { deriveLatestContextWindowSnapshot } from "~/lib/contextWindow";
import {
  describeModelSelection,
  resolveModelContextWindowTokens,
} from "~/lib/modelContextWindow";

/**
 * Thin wrapper that mounts ProjectIntelligencePanel docked inside the chat
 * RightPanelDock in `viewMode="thread"`, defaulting to the new
 * `"context-inspector"` section. Read-only on the project loadout (with a link
 * out to the Project Context Manager) plus additive overrides for this thread.
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
  const [section, setSection] = useState<
    Parameters<React.ComponentProps<typeof ProjectIntelligencePanel>["onSelectSection"]>[0]
  >("context-inspector");
  const [surfaceId, setSurfaceId] = useState<ProjectIntelligenceSurfaceId | null>(null);

  const handleSelectSection = useCallback(
    (next: typeof section) => {
      setSection(next);
      // Drop the focused surface when switching to/from the inspector to avoid
      // re-opening the surface detail drawer on top of the inspector.
      setSurfaceId(null);
    },
    [],
  );

  // Resolve the active context window: prefer the live `maxTokens` reported
  // in the latest context-window activity event (server-derived, accounts for
  // chosen options). Fall back to a static lookup against the model selection.
  const contextMaxTokens = useMemo(() => {
    const snapshot = deriveLatestContextWindowSnapshot(props.threadActivities ?? []);
    if (snapshot?.maxTokens && snapshot.maxTokens > 0) return snapshot.maxTokens;
    return resolveModelContextWindowTokens(props.providers, props.threadModelSelection);
  }, [props.providers, props.threadActivities, props.threadModelSelection]);

  const activeModel = useMemo(
    () => describeModelSelection(props.providers, props.threadModelSelection),
    [props.providers, props.threadModelSelection],
  );

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
