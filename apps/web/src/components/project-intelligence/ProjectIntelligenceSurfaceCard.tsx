import type { EnvironmentId, ProjectIntelligenceSurfaceSummary } from "@t3tools/contracts";
import { ChevronDownIcon, ExternalLinkIcon, FileTextIcon, SparklesIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { openInPreferredEditor } from "../../editorPreferences";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { readLocalApi } from "../../localApi";
import {
  formatActivationLabel,
  formatOwnerLabel,
  formatScopeLabel,
  isProjectScopedSurface,
} from "../../projectIntelligencePresentation";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { ProjectIntelligenceSurfacePreview } from "./ProjectIntelligenceSurfacePreview";

interface ProjectIntelligenceSurfaceCardProps {
  readonly surface: ProjectIntelligenceSurfaceSummary;
  readonly environmentId: EnvironmentId | null;
  readonly workspaceCwd?: string | null | undefined;
}

function canOpenSurfaceInEditor(surface: ProjectIntelligenceSurfaceSummary): boolean {
  const candidate = surface.openPath ?? surface.path;
  return !candidate.includes("://");
}

export function ProjectIntelligenceSurfaceCard(props: ProjectIntelligenceSurfaceCardProps) {
  const { resolvedTheme } = useTheme();
  const [previewOpen, setPreviewOpen] = useState(false);
  const isProject = isProjectScopedSurface(props.surface);
  const displayPath = useMemo(
    () =>
      props.surface.path.includes("://")
        ? props.surface.path
        : formatWorkspaceRelativePath(props.surface.path, props.workspaceCwd ?? undefined),
    [props.surface.path, props.workspaceCwd],
  );
  const openInEditor = useCallback(() => {
    const api = readLocalApi();
    const targetPath = props.surface.openPath ?? props.surface.path;
    if (!api || !canOpenSurfaceInEditor(props.surface)) {
      return;
    }
    void openInPreferredEditor(api, targetPath);
  }, [props.surface]);

  const frontmatterEntries = Object.entries(props.surface.frontmatter).slice(0, 4);

  return (
    <Card
      className={cn(
        "overflow-hidden",
        isProject ? "border-l-[3px] border-l-primary/50" : "border-l-[3px] border-l-border/30",
      )}
    >
      <CardHeader className="gap-0 pb-0">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40">
            {canOpenSurfaceInEditor(props.surface) ? (
              <VscodeEntryIcon
                pathValue={props.surface.openPath ?? props.surface.path}
                kind="file"
                theme={resolvedTheme === "dark" ? "dark" : "light"}
                className="size-4"
              />
            ) : (
              <FileTextIcon className="size-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <CardTitle className="truncate text-[15px] leading-snug">
                  {props.surface.label}
                </CardTitle>
                <div className="truncate font-mono text-[11px] text-muted-foreground/70">
                  {displayPath}
                </div>
              </div>
              {canOpenSurfaceInEditor(props.surface) ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Open ${props.surface.label} in editor`}
                  onClick={openInEditor}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLinkIcon className="size-3.5" />
                </Button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="secondary" size="sm">
                {props.surface.kind}
              </Badge>
              <Badge variant="outline" size="sm">
                {formatOwnerLabel(props.surface)}
              </Badge>
              <Badge variant="outline" size="sm">
                {formatActivationLabel(props.surface)}
              </Badge>
              <Badge variant={isProject ? "info" : "outline"} size="sm">
                {formatScopeLabel(props.surface)}
              </Badge>
            </div>
          </div>
        </div>
        {props.surface.description ? (
          <div className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            {props.surface.description}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 pt-3 text-[11px] text-muted-foreground/80">
          <span>{props.surface.approxTokenCount.toLocaleString()} tokens</span>
          <span className="text-border">·</span>
          <span>{props.surface.lineCount.toLocaleString()} lines</span>
          {props.surface.triggerLabel ? (
            <>
              <span className="text-border">·</span>
              <span>Trigger: {props.surface.triggerLabel}</span>
            </>
          ) : null}
          {props.surface.sourceLabel ? (
            <>
              <span className="text-border">·</span>
              <span>Source: {props.surface.sourceLabel}</span>
            </>
          ) : null}
        </div>

        {props.surface.aliases.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {props.surface.aliases.map((alias) => (
              <Badge key={alias} variant="info" size="sm">
                Alias: {alias}
              </Badge>
            ))}
          </div>
        ) : null}

        {frontmatterEntries.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {frontmatterEntries.map(([key, value]) => (
              <Badge key={key} variant="outline" size="sm" className="font-mono text-[10px]">
                {key}: {value}
              </Badge>
            ))}
          </div>
        ) : null}

        {props.surface.hookConfig ? (
          <div className="grid gap-1.5 rounded-lg border border-border/50 bg-muted/18 p-3 text-[13px]">
            <div>
              <span className="text-muted-foreground">Event:</span>{" "}
              <span className="font-medium">{props.surface.hookConfig.event}</span>
            </div>
            {props.surface.hookConfig.matcher ? (
              <div>
                <span className="text-muted-foreground">Matcher:</span>{" "}
                <span className="font-medium">{props.surface.hookConfig.matcher}</span>
              </div>
            ) : null}
            <div>
              <span className="text-muted-foreground">Enabled:</span>{" "}
              <span className="font-medium">{props.surface.hookConfig.enabled ? "Yes" : "No"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Actions:</span>{" "}
              <span className="font-medium">{props.surface.hookConfig.actionSummary}</span>
            </div>
          </div>
        ) : null}

        {props.surface.promptExcerpt ? (
          <div className="rounded-lg border border-border/50 bg-muted/18 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              <SparklesIcon className="size-3" />
              Preview excerpt
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90">
              {props.surface.promptExcerpt}
            </pre>
          </div>
        ) : null}

        <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
          <div className="space-y-3">
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="w-full justify-between text-left text-muted-foreground hover:text-foreground"
                />
              }
            >
              <span className="text-xs">
                {previewOpen ? "Hide full preview" : "Expand full preview"}
              </span>
              <ChevronDownIcon
                className={`size-3.5 transition-transform duration-200 ${previewOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ProjectIntelligenceSurfacePreview
                environmentId={props.environmentId}
                surfaceId={props.surface.id}
                open={previewOpen}
                cwd={props.workspaceCwd}
              />
            </CollapsibleContent>
          </div>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
