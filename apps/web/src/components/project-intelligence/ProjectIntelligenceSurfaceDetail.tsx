import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ProjectIntelligenceSurfaceSummary,
  ProjectIntelligenceViewMode,
} from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import { openInPreferredEditor } from "../../editorPreferences";
import { projectIntelligenceSurfaceQueryOptions } from "../../lib/projectIntelligenceReactQuery";
import {
  formatNumber,
  formatPath,
  formatTokenCount,
  getActivationLabel,
  getOwnerLabel,
  getProviderLabel,
  getScopeLabel,
  getSurfaceKindLabel,
  HEALTH_BADGE_CLASS,
  HEALTH_LABELS,
  shouldShowOpenInEditor,
} from "../../projectIntelligencePresentation";
import { readLocalApi } from "../../localApi";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { stackedThreadToast, toastManager } from "../ui/toast";

import { ProjectIntelligenceHealthDot } from "./ProjectIntelligenceHealthDot";

export interface ProjectIntelligenceSurfaceDetailProps {
  surface: ProjectIntelligenceSurfaceSummary;
  environmentId: EnvironmentId | null;
  projectCwd: string;
  effectiveCwd: string | null;
  viewMode: ProjectIntelligenceViewMode;
  onClose: () => void;
}

export function ProjectIntelligenceSurfaceDetail(props: ProjectIntelligenceSurfaceDetailProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const { surface } = props;

  const previewQuery = useQuery(
    projectIntelligenceSurfaceQueryOptions({
      environmentId: props.environmentId,
      projectCwd: props.projectCwd,
      effectiveCwd: props.effectiveCwd,
      viewMode: props.viewMode,
      surfaceId: surface.id,
      enabled: previewOpen,
    }),
  );

  const handleOpenInEditor = useCallback(async () => {
    if (!shouldShowOpenInEditor(surface) || !surface.openPath) return;
    const api = readLocalApi();
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open in editor",
          description: "Editor integration is unavailable in this environment.",
        }),
      );
      return;
    }
    try {
      await openInPreferredEditor(api, surface.openPath);
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open in editor",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    }
  }, [surface]);

  return (
    <aside
      data-testid="project-intelligence-surface-detail"
      className="flex max-h-[60vh] min-h-0 flex-col gap-3 border-t border-border bg-card/50 px-3 py-3"
      aria-label={`Details for ${surface.label}`}
    >
      <header className="flex items-start gap-2">
        <ProjectIntelligenceHealthDot health={surface.health} size="md" className="mt-1.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{surface.label}</h3>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium",
                HEALTH_BADGE_CLASS[surface.health],
              )}
            >
              {HEALTH_LABELS[surface.health]}
            </span>
            {!surface.enabled ? (
              <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-px text-[10px] text-muted-foreground">
                Disabled
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="rounded bg-muted/60 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-foreground">
              {getSurfaceKindLabel(surface.kind)}
            </span>
            <span>{getOwnerLabel(surface.owner)}</span>
            {surface.provider ? <span>- {getProviderLabel(surface.provider)}</span> : null}
            <span>- {getScopeLabel(surface.scope)}</span>
            <span>- {getActivationLabel(surface.activation)}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close details" onClick={props.onClose}>
          <XIcon className="size-3.5" />
        </Button>
      </header>

      {surface.description ? (
        <p className="text-xs leading-relaxed text-foreground/85">{surface.description}</p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        <DetailRow
          label="Path"
          value={<code className="font-mono">{formatPath(surface.path, 80)}</code>}
        />
        {surface.triggerLabel ? (
          <DetailRow label="Trigger" value={<span>{surface.triggerLabel}</span>} />
        ) : null}
        {surface.sourceLabel ? (
          <DetailRow label="Source" value={<span>{surface.sourceLabel}</span>} />
        ) : null}
        {surface.lineCount !== undefined ? (
          <DetailRow
            label="Lines"
            value={<span className="tabular-nums">{formatNumber(surface.lineCount)}</span>}
          />
        ) : null}
        {surface.approxTokenCount !== undefined ? (
          <DetailRow
            label="Approx tokens"
            value={
              <span className="tabular-nums">{formatTokenCount(surface.approxTokenCount)}</span>
            }
          />
        ) : null}
        {surface.metadata.map((entry) => (
          <DetailRow key={entry.label} label={entry.label} value={<span>{entry.value}</span>} />
        ))}
      </dl>

      {surface.excerpt ? (
        <div className="rounded-md border border-border/60 bg-background/60 p-2 text-[11px] leading-relaxed">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Excerpt
            </span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-foreground/90">
            {surface.excerpt}
          </pre>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => setPreviewOpen((current) => !current)}
          aria-expanded={previewOpen}
        >
          {previewOpen ? (
            <ChevronDownIcon className="size-3" aria-hidden="true" />
          ) : (
            <ChevronRightIcon className="size-3" aria-hidden="true" />
          )}
          {previewOpen ? "Hide preview" : "Load full preview"}
        </Button>
        {shouldShowOpenInEditor(surface) ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              void handleOpenInEditor();
            }}
          >
            <ExternalLinkIcon className="size-3" aria-hidden="true" />
            Open in editor
          </Button>
        ) : null}
      </div>

      {previewOpen ? (
        <SurfacePreview
          status={previewQuery.status}
          isFetching={previewQuery.isFetching}
          data={previewQuery.data}
          error={previewQuery.error}
          onRetry={() => {
            void previewQuery.refetch();
          }}
        />
      ) : null}
    </aside>
  );
}

function DetailRow(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 truncate text-foreground/90">{props.value}</dd>
    </div>
  );
}

interface SurfacePreviewProps {
  status: "pending" | "error" | "success";
  isFetching: boolean;
  data:
    | {
        readonly content: string;
        readonly truncated: boolean;
        readonly maxBytes: number;
        readonly warning?: string | undefined;
      }
    | undefined;
  error: unknown;
  onRetry: () => void;
}

function SurfacePreview(props: SurfacePreviewProps) {
  if (props.status === "pending") {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-background/60 p-3">
        <Skeleton className="h-3 w-full rounded-full" />
        <Skeleton className="h-3 w-11/12 rounded-full" />
        <Skeleton className="h-3 w-9/12 rounded-full" />
        <Skeleton className="h-3 w-10/12 rounded-full" />
      </div>
    );
  }
  if (props.status === "error") {
    const message =
      props.error instanceof Error ? props.error.message : "Unable to load surface preview.";
    return (
      <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        <div className="flex items-start gap-2">
          <AlertCircleIcon className="mt-0.5 size-3.5" aria-hidden="true" />
          <span>{message}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="self-start"
          onClick={props.onRetry}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (!props.data) return null;
  return (
    <div className="rounded-md border border-border/60 bg-background/60">
      <div className="flex items-center justify-between border-b border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
        <span>
          {props.data.truncated
            ? `Truncated to ${(props.data.maxBytes / 1024).toFixed(0)}KB`
            : "Full content"}
        </span>
        {props.isFetching ? <span>Refreshing...</span> : null}
      </div>
      {props.data.warning ? (
        <div className="border-b border-border/60 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          {props.data.warning}
        </div>
      ) : null}
      <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
        {props.data.content}
      </pre>
    </div>
  );
}
