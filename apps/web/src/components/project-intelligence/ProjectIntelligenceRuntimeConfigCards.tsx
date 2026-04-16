import type {
  EnvironmentId,
  ProjectIntelligenceProviderRuntimeSummary,
  ProjectIntelligenceSurfaceSummary,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  FolderIcon,
  GlobeIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { formatProviderLabel, isProjectScopedSurface } from "../../projectIntelligencePresentation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { ScopeGroupEmpty, ScopeGroupHeader } from "./ProjectIntelligenceSurfaceList";
import { ProjectIntelligenceSurfacePreview } from "./ProjectIntelligenceSurfacePreview";

interface ProjectIntelligenceRuntimeConfigCardsProps {
  readonly environmentId: EnvironmentId | null;
  readonly providerRuntime: ReadonlyArray<ProjectIntelligenceProviderRuntimeSummary>;
  readonly settingsSurfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  readonly workspaceCwd?: string | null | undefined;
}

/** Strip common @-suffixes from plugin IDs for display. */
function shortPluginId(id: string): string {
  const atIdx = id.indexOf("@");
  return atIdx > 0 ? id.slice(0, atIdx) : id;
}

/** Map scope string to a human-readable label and icon. */
function getScopeInfo(scope: string): {
  label: string;
  description: string;
  badgeVariant: "outline" | "info" | "secondary";
} {
  switch (scope) {
    case "user":
      return {
        label: "Global",
        description: "Applies across all projects",
        badgeVariant: "outline",
      };
    case "local":
    case "project":
      return {
        label: "Project",
        description: "Applies to this project only",
        badgeVariant: "info",
      };
    case "system":
      return {
        label: "System",
        description: "System-level defaults",
        badgeVariant: "secondary",
      };
    default:
      return { label: scope, description: "Settings file", badgeVariant: "outline" };
  }
}

function RuntimeProviderCard(props: { provider: ProjectIntelligenceProviderRuntimeSummary }) {
  const modelSummary = props.provider.models
    .slice(0, 5)
    .map((model) => model.name)
    .join(", ");

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 p-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/40">
              <ShieldCheckIcon className="size-4 text-muted-foreground" />
            </div>
            <div>
              <div className="text-[15px] font-semibold leading-snug">
                {formatProviderLabel(props.provider)}
              </div>
              <div className="text-[12px] text-muted-foreground">
                Runtime availability and provider-discovered capabilities
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <Badge variant="outline" size="sm">
              {props.provider.status}
            </Badge>
            <Badge variant="outline" size="sm">
              {props.provider.auth.status}
            </Badge>
          </div>
        </div>

        {/* Key stats grid */}
        <div className="grid grid-cols-2 gap-px border-y border-border/50 bg-border/50 sm:grid-cols-4">
          {[
            {
              label: "Auth",
              value:
                props.provider.auth.label ?? props.provider.auth.type ?? props.provider.auth.status,
            },
            {
              label: "Models",
              value: modelSummary || "None",
            },
            {
              label: "Skills",
              value: props.provider.discoveredSkillCount.toLocaleString(),
            },
            {
              label: "Commands",
              value: props.provider.discoveredSlashCommandCount.toLocaleString(),
            },
          ].map((stat) => (
            <div key={stat.label} className="bg-popover px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {stat.label}
              </div>
              <div className="mt-0.5 truncate text-[13px] font-medium">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Permissions */}
        {props.provider.permissionsSummary ? (
          <div className="border-b border-border/50 px-5 py-3 text-[13px]">
            <span className="text-muted-foreground">Permissions:</span>{" "}
            <span className="font-medium">{props.provider.permissionsSummary.defaultMode}</span>
            <span className="mx-2 text-border">·</span>
            <span className="text-muted-foreground">allow</span>{" "}
            <span className="font-medium">{props.provider.permissionsSummary.allowCount}</span>
            <span className="mx-2 text-border">·</span>
            <span className="text-muted-foreground">ask</span>{" "}
            <span className="font-medium">{props.provider.permissionsSummary.askCount}</span>
            <span className="mx-2 text-border">·</span>
            <span className="text-muted-foreground">deny</span>{" "}
            <span className="font-medium">{props.provider.permissionsSummary.denyCount}</span>
          </div>
        ) : null}

        {/* Plugins */}
        {props.provider.enabledPluginIds.length > 0 ? (
          <div className="border-b border-border/50 px-5 py-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Plugins
            </div>
            <div className="flex flex-wrap gap-1.5">
              {props.provider.enabledPluginIds.map((id) => (
                <Badge key={id} variant="secondary" size="sm" className="font-mono text-[10px]">
                  {shortPluginId(id)}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {/* Feature flags */}
        {props.provider.featureFlags.length > 0 ? (
          <div className="px-5 py-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Feature flags
            </div>
            <div className="flex flex-wrap gap-1.5">
              {props.provider.featureFlags.map((flag) => (
                <Badge key={flag} variant="outline" size="sm" className="font-mono text-[10px]">
                  {flag}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RuntimeSettingsCard(props: {
  readonly environmentId: EnvironmentId | null;
  readonly surface: ProjectIntelligenceSurfaceSummary;
  readonly workspaceCwd?: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const summary = props.surface.settingsSummary;
  const scopeInfo = getScopeInfo(props.surface.scope);
  const relativePath = formatWorkspaceRelativePath(
    props.surface.path,
    props.workspaceCwd ?? undefined,
  );

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/40">
              <SlidersHorizontalIcon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold leading-snug">
                  {props.surface.label}
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
                {relativePath}
              </div>
            </div>
          </div>
          {/* Scope badge — prominently labeled */}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant={scopeInfo.badgeVariant} size="sm" className="gap-1">
              {scopeInfo.label === "Global" ? <GlobeIcon className="size-2.5" /> : null}
              {scopeInfo.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{scopeInfo.description}</span>
          </div>
        </div>

        {/* Permissions summary */}
        {summary ? (
          <>
            <div className="grid grid-cols-2 gap-px border-y border-border/50 bg-border/50 sm:grid-cols-4">
              {[
                {
                  label: "Mode",
                  value: summary.permissionsMode ?? "Default",
                },
                {
                  label: "Allow",
                  value: summary.allowCount.toLocaleString(),
                },
                {
                  label: "Ask",
                  value: summary.askCount.toLocaleString(),
                },
                {
                  label: "Deny",
                  value: summary.denyCount.toLocaleString(),
                },
              ].map((stat) => (
                <div key={stat.label} className="bg-popover px-4 py-3">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {stat.label}
                  </div>
                  <div className="mt-0.5 truncate text-[13px] font-medium">{stat.value}</div>
                </div>
              ))}
            </div>

            {/* Plugins */}
            {summary.enabledPluginIds.length > 0 ? (
              <div className="border-b border-border/50 px-5 py-3">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Plugins
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {summary.enabledPluginIds.map((id) => (
                    <Badge key={id} variant="secondary" size="sm" className="font-mono text-[10px]">
                      {shortPluginId(id)}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Feature flags */}
            {summary.featureFlags.length > 0 ? (
              <div className="border-b border-border/50 px-5 py-3">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Feature flags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {summary.featureFlags.map((flag) => (
                    <Badge key={flag} variant="outline" size="sm" className="font-mono text-[10px]">
                      {flag}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {/* View redacted config */}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                className="w-full justify-between rounded-none border-t border-border/50 px-5 py-3 text-left text-[12px] text-muted-foreground hover:text-foreground"
              />
            }
          >
            <span>{open ? "Hide redacted config" : "View redacted config"}</span>
            <ChevronDownIcon
              className={`size-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-5 pb-4 pt-3">
              <ProjectIntelligenceSurfacePreview
                environmentId={props.environmentId}
                surfaceId={props.surface.id}
                open={open}
                cwd={props.workspaceCwd}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function ProjectIntelligenceRuntimeConfigCards(
  props: ProjectIntelligenceRuntimeConfigCardsProps,
) {
  const { projectSettings, globalSettings } = useMemo(() => {
    const project = props.settingsSurfaces.filter(isProjectScopedSurface);
    const global = props.settingsSurfaces.filter((s) => !isProjectScopedSurface(s));
    return { projectSettings: project, globalSettings: global };
  }, [props.settingsSurfaces]);

  if (props.providerRuntime.length === 0 && props.settingsSurfaces.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {props.providerRuntime.map((provider) => (
        <RuntimeProviderCard key={provider.provider} provider={provider} />
      ))}
      {props.settingsSurfaces.length > 0 ? (
        <>
          <ScopeGroupHeader
            icon={<FolderIcon className="size-3" />}
            label="Project"
            count={projectSettings.length}
          />
          {projectSettings.length > 0 ? (
            projectSettings.map((surface) => (
              <RuntimeSettingsCard
                key={surface.id}
                environmentId={props.environmentId}
                surface={surface}
                workspaceCwd={props.workspaceCwd}
              />
            ))
          ) : (
            <ScopeGroupEmpty message="No project-scoped settings" />
          )}
          <div className="pt-2">
            <div className="space-y-3">
              <ScopeGroupHeader
                icon={<GlobeIcon className="size-3" />}
                label="Global"
                count={globalSettings.length}
              />
              {globalSettings.length > 0 ? (
                globalSettings.map((surface) => (
                  <RuntimeSettingsCard
                    key={surface.id}
                    environmentId={props.environmentId}
                    surface={surface}
                    workspaceCwd={props.workspaceCwd}
                  />
                ))
              ) : (
                <ScopeGroupEmpty message="No global settings" />
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
