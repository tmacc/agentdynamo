import type { ProjectGetIntelligenceResult } from "@t3tools/contracts";

import {
  formatProviderLabel,
  getAlwaysLoadedSurfaces,
  getPreferredCodeStats,
} from "../../projectIntelligencePresentation";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export function ProjectIntelligenceOverviewSection(props: {
  readonly result: ProjectGetIntelligenceResult;
}) {
  const loadedNow = getAlwaysLoadedSurfaces(props.result);
  const runtimeConfigCount =
    props.result.providerRuntime.length +
    props.result.surfaces.filter((surface) => surface.activation === "runtime-config").length;
  const availableOnDemand = props.result.surfaces.length - loadedNow.length;
  const activeCodeStats = getPreferredCodeStats(props.result);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="bg-muted/12 shadow-none">
          <CardContent className="p-4">
            <div className="text-2xl font-semibold tabular-nums">{loadedNow.length}</div>
            <div className="mt-0.5 text-[13px] font-medium text-foreground/80">Loaded now</div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Surfaces that directly shape default behavior.
            </div>
          </CardContent>
        </Card>
        <Card className="bg-muted/12 shadow-none">
          <CardContent className="p-4">
            <div className="text-2xl font-semibold tabular-nums">{availableOnDemand}</div>
            <div className="mt-0.5 text-[13px] font-medium text-foreground/80">
              Available surfaces
            </div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Skills, commands, hooks, plugins, and memory on demand.
            </div>
          </CardContent>
        </Card>
        <Card className="bg-muted/12 shadow-none">
          <CardContent className="p-4">
            <div className="text-2xl font-semibold tabular-nums">{runtimeConfigCount}</div>
            <div className="mt-0.5 text-[13px] font-medium text-foreground/80">Runtime config</div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Provider state and settings that shape behavior.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
              Runtime snapshot
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-3 text-[13px]">
            <div>
              <span className="text-muted-foreground">Base project:</span>{" "}
              <span className="break-all font-mono text-[11px]">{props.result.projectCwd}</span>
            </div>
            {props.result.effectiveCwd ? (
              <div>
                <span className="text-muted-foreground">Thread workspace:</span>{" "}
                <span className="break-all font-mono text-[11px]">{props.result.effectiveCwd}</span>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {props.result.providerRuntime.map((provider) => (
                <Badge key={provider.provider} variant="outline" size="sm">
                  {formatProviderLabel(provider)} · {provider.status}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
              Authored code stats
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-3 text-[13px]">
            {activeCodeStats ? (
              <>
                <div>
                  <span className="text-muted-foreground">Files:</span>{" "}
                  <span className="font-medium tabular-nums">
                    {activeCodeStats.fileCount.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">LOC:</span>{" "}
                  <span className="font-medium tabular-nums">
                    {activeCodeStats.loc.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Approx tokens:</span>{" "}
                  <span className="font-medium tabular-nums">
                    {activeCodeStats.approxTokenCount.toLocaleString()}
                  </span>
                </div>
                <div className="pt-1 text-[11px] text-muted-foreground/70">
                  Basis: {activeCodeStats.basis}
                  {activeCodeStats.partial ? " · partial" : ""}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">No code stats available.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
