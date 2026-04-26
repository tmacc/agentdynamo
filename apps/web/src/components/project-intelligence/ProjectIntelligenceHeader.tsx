import type { ProjectIntelligenceViewMode } from "@t3tools/contracts";
import { RefreshCcwIcon, ScanSearchIcon, XIcon } from "lucide-react";

import { formatPath } from "../../projectIntelligencePresentation";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

export interface ProjectIntelligenceHeaderProps {
  viewMode: ProjectIntelligenceViewMode;
  projectTitle?: string | null | undefined;
  projectCwd: string;
  effectiveCwd?: string | null | undefined;
  resolvedAtIso?: string | undefined;
  isRefreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onSwitchViewMode?: ((next: ProjectIntelligenceViewMode) => void) | undefined;
  canSwitchToThread: boolean;
}

export function ProjectIntelligenceHeader(props: ProjectIntelligenceHeaderProps) {
  const showThreadToggle = Boolean(props.onSwitchViewMode);
  const resolvedAtLabel = props.resolvedAtIso ? formatRelativeAge(props.resolvedAtIso) : null;
  const isThreadView = props.viewMode === "thread";
  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-border/60 bg-background px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ScanSearchIcon className="size-3.5" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="font-heading text-sm font-semibold leading-tight">
              Project intelligence
            </h2>
            <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              v2
            </span>
          </div>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            {props.projectTitle ? (
              <span className="font-medium text-foreground">{props.projectTitle}</span>
            ) : null}
            {props.projectTitle ? <span> - </span> : null}
            <code className="font-mono">{formatPath(props.projectCwd, 72)}</code>
          </p>
          {isThreadView && props.effectiveCwd ? (
            <p className="truncate text-[10px] text-muted-foreground">
              <span className="font-semibold text-foreground/80">Thread workspace:</span>{" "}
              <code className="font-mono">{formatPath(props.effectiveCwd, 72)}</code>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh project intelligence"
            disabled={props.isRefreshing}
            onClick={props.onRefresh}
          >
            <RefreshCcwIcon
              className={cn("size-3.5", props.isRefreshing && "animate-spin")}
              aria-hidden="true"
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close project intelligence panel"
            onClick={props.onClose}
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 ps-8 text-[10px] text-muted-foreground">
        {showThreadToggle ? (
          <div
            role="tablist"
            aria-label="View mode"
            className="inline-flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5"
          >
            <ViewModeButton
              isActive={props.viewMode === "project"}
              onClick={() => props.onSwitchViewMode?.("project")}
            >
              Project
            </ViewModeButton>
            <ViewModeButton
              isActive={props.viewMode === "thread"}
              onClick={() => props.onSwitchViewMode?.("thread")}
              disabled={!props.canSwitchToThread}
              title={
                props.canSwitchToThread
                  ? undefined
                  : "Open from a thread with a worktree to inspect thread context."
              }
            >
              Thread
            </ViewModeButton>
          </div>
        ) : null}
        {resolvedAtLabel ? (
          <span className="ms-auto">
            Resolved{" "}
            <time dateTime={props.resolvedAtIso} className="font-medium text-foreground/80">
              {resolvedAtLabel}
            </time>
          </span>
        ) : null}
      </div>
    </header>
  );
}

function ViewModeButton(props: {
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.isActive}
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        props.disabled
          ? "cursor-not-allowed text-muted-foreground/60"
          : props.isActive
            ? "bg-primary/10 text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
      )}
    >
      {props.children}
    </button>
  );
}

function formatRelativeAge(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "";
  const ageMs = Date.now() - timestamp;
  if (ageMs < 0) return "just now";
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
