import type { EnvironmentId, ProjectIntelligenceSurfaceId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";

import ChatMarkdown from "../ChatMarkdown";
import { projectIntelligenceSurfaceQueryOptions } from "../../lib/projectIntelligenceReactQuery";

interface ProjectIntelligenceSurfacePreviewProps {
  readonly environmentId: EnvironmentId | null;
  readonly surfaceId: ProjectIntelligenceSurfaceId;
  readonly open: boolean;
  readonly cwd?: string | null | undefined;
}

export function ProjectIntelligenceSurfacePreview(props: ProjectIntelligenceSurfacePreviewProps) {
  const surfaceQuery = useQuery(
    projectIntelligenceSurfaceQueryOptions({
      environmentId: props.environmentId,
      surfaceId: props.surfaceId,
      enabled: props.open,
    }),
  );

  if (!props.open) {
    return null;
  }

  if (surfaceQuery.isPending) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
        Loading surface content…
      </div>
    );
  }

  if (surfaceQuery.isError || !surfaceQuery.data) {
    return (
      <div className="rounded-xl border border-dashed border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Unable to load this surface preview.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/50 bg-muted/18 p-3">
      {surfaceQuery.data.warning ? (
        <div className="text-[11px] text-muted-foreground/70">{surfaceQuery.data.warning}</div>
      ) : null}
      {surfaceQuery.data.contentType === "markdown" ? (
        <ChatMarkdown text={surfaceQuery.data.content} cwd={props.cwd ?? undefined} />
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90">
          {surfaceQuery.data.content}
        </pre>
      )}
    </div>
  );
}
