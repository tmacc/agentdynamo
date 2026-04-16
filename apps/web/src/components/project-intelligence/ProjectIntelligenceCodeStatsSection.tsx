import type { ProjectGetIntelligenceResult } from "@t3tools/contracts";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export function ProjectIntelligenceCodeStatsSection(props: {
  readonly result: ProjectGetIntelligenceResult;
}) {
  const scopes = props.result.scopeSummaries.filter((scope) => scope.codeStats !== undefined);

  if (scopes.length === 0) {
    return (
      <Empty className="min-h-52 rounded-2xl border border-dashed border-border/70 bg-muted/18">
        <EmptyHeader>
          <EmptyTitle>No code stats available</EmptyTitle>
          <EmptyDescription>
            Authored-source LOC and token counts could not be derived for this project.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {scopes.map((scope) => (
        <Card key={scope.kind}>
          <CardHeader className="pb-0">
            <CardTitle className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
              {scope.kind === "effective-project" ? "Thread workspace" : "Base project"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-3 text-[13px]">
            <div className="break-all font-mono text-[11px] text-muted-foreground/70">
              {scope.cwd}
            </div>
            <div>
              <span className="text-muted-foreground">Files:</span>{" "}
              <span className="font-medium tabular-nums">
                {scope.codeStats?.fileCount.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">LOC:</span>{" "}
              <span className="font-medium tabular-nums">
                {scope.codeStats?.loc.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Approx tokens:</span>{" "}
              <span className="font-medium tabular-nums">
                {scope.codeStats?.approxTokenCount.toLocaleString()}
              </span>
            </div>
            <div className="pt-1 text-[11px] text-muted-foreground/70">
              {scope.codeStats?.basis}
              {scope.codeStats?.partial ? " · partial scan" : ""}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
