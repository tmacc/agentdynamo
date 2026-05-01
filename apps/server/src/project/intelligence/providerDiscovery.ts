import type {
  ProjectIntelligenceHealth,
  ProjectIntelligenceProviderSummary,
  ProjectIntelligenceSurfaceSummary,
  ServerProvider,
} from "@t3tools/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";

import { createProjectIntelligenceSurfaceId } from "./surfaceIds.ts";
import type { DiscoveredProjectIntelligenceSurface } from "./types.ts";

function providerHealth(provider: ServerProvider): ProjectIntelligenceHealth {
  if (!provider.enabled || provider.status === "disabled") return "info";
  if (!provider.installed || provider.status === "error") return "error";
  if (provider.status === "warning" || provider.auth.status === "unauthenticated") return "warning";
  return "ok";
}

function providerLabel(provider: ServerProvider): string {
  return PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
}

function virtualSurface(input: {
  readonly provider: ServerProvider;
  readonly kind: ProjectIntelligenceSurfaceSummary["kind"];
  readonly label: string;
  readonly path: string;
  readonly activation: ProjectIntelligenceSurfaceSummary["activation"];
  readonly enabled: boolean;
  readonly description?: string;
  readonly triggerLabel?: string;
  readonly sourceLabel: string;
  readonly content: string;
  readonly metadata?: ProjectIntelligenceSurfaceSummary["metadata"];
}): DiscoveredProjectIntelligenceSurface {
  const summary: ProjectIntelligenceSurfaceSummary = {
    id: createProjectIntelligenceSurfaceId([
      "provider",
      input.provider.driver,
      input.kind,
      input.path,
      input.label,
    ]),
    owner: input.provider.driver,
    provider: input.provider.driver,
    kind: input.kind,
    label: input.label,
    path: input.path,
    scope: "provider-runtime",
    activation: input.activation,
    enabled: input.enabled,
    health: input.enabled ? "ok" : "info",
    ...(input.description ? { description: input.description } : {}),
    ...(input.triggerLabel ? { triggerLabel: input.triggerLabel } : {}),
    sourceLabel: input.sourceLabel,
    excerpt: input.content,
    metadata: input.metadata ?? [],
  };
  return {
    summary,
    readTarget: {
      mode: "virtual",
      contentType: "markdown",
      content: input.content,
    },
  };
}

export function summarizeProviders(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProjectIntelligenceProviderSummary> {
  return providers.map((provider) => ({
    provider: provider.driver,
    enabled: provider.enabled,
    installed: provider.installed,
    status: provider.status,
    auth: provider.auth,
    version: provider.version,
    ...(provider.message ? { message: provider.message } : {}),
    modelCount: provider.models.length,
    skillCount: provider.skills.length,
    slashCommandCount: provider.slashCommands.length,
    supportsCoordinatorTools: provider.teamCapabilities?.supportsCoordinatorTools ?? false,
    supportsWorker: provider.teamCapabilities?.supportsWorker ?? true,
    health: providerHealth(provider),
  }));
}

export function discoverProviderSurfaces(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<DiscoveredProjectIntelligenceSurface> {
  const surfaces: DiscoveredProjectIntelligenceSurface[] = [];

  for (const provider of providers) {
    const label = providerLabel(provider);
    for (const model of provider.models) {
      const surfaceMetadata: Array<ProjectIntelligenceSurfaceSummary["metadata"][number]> = [
        { label: "Provider", value: label },
        { label: "Custom", value: model.isCustom ? "yes" : "no" },
      ];
      if (model.shortName) surfaceMetadata.push({ label: "Short name", value: model.shortName });
      if (model.subProvider)
        surfaceMetadata.push({ label: "Sub-provider", value: model.subProvider });
      if (model.teamCapabilities) {
        surfaceMetadata.push({
          label: "Worker rank",
          value: String(model.teamCapabilities.workerRank),
        });
      }
      surfaces.push(
        virtualSurface({
          provider,
          kind: "model",
          label: model.name,
          path: `provider://${provider.driver}/model/${model.slug}`,
          activation: "runtime-config",
          enabled: provider.enabled,
          sourceLabel: `${label} model`,
          description: `Model slug: ${model.slug}`,
          content: [
            `# ${model.name}`,
            "",
            `Provider: ${label}`,
            `Slug: ${model.slug}`,
            `Custom: ${model.isCustom ? "yes" : "no"}`,
          ].join("\n"),
          metadata: surfaceMetadata,
        }),
      );
    }

    for (const skill of provider.skills) {
      const description = skill.shortDescription ?? skill.description;
      surfaces.push(
        virtualSurface({
          provider,
          kind: "skill",
          label: skill.displayName ?? skill.name,
          path:
            skill.path.trim().length > 0
              ? skill.path
              : `provider://${provider.driver}/skill/${skill.name}`,
          activation: "on-skill-match",
          enabled: skill.enabled,
          triggerLabel: skill.name,
          sourceLabel: `${label} provider discovery`,
          ...(description ? { description } : {}),
          content: [
            `# ${skill.displayName ?? skill.name}`,
            "",
            `Provider: ${label}`,
            `Skill: ${skill.name}`,
            ...(skill.description ? ["", skill.description] : []),
          ].join("\n"),
          metadata: [
            { label: "Provider", value: label },
            { label: "Enabled", value: skill.enabled ? "yes" : "no" },
            ...(skill.scope ? [{ label: "Scope", value: skill.scope }] : []),
          ],
        }),
      );
    }

    for (const command of provider.slashCommands) {
      surfaces.push(
        virtualSurface({
          provider,
          kind: "slash-command",
          label: command.name,
          path: `provider://${provider.driver}/command/${command.name}`,
          activation: "on-command",
          enabled: provider.enabled,
          triggerLabel: `/${command.name}`,
          sourceLabel: `${label} provider discovery`,
          ...(command.description ? { description: command.description } : {}),
          content: [
            `# /${command.name}`,
            "",
            `Provider: ${label}`,
            ...(command.input?.hint ? [`Input hint: ${command.input.hint}`] : []),
            ...(command.description ? ["", command.description] : []),
          ].join("\n"),
          metadata: [
            { label: "Provider", value: label },
            ...(command.input?.hint ? [{ label: "Input", value: command.input.hint }] : []),
          ],
        }),
      );
    }

    if (provider.teamCapabilities) {
      const content = [
        `# ${label} team capabilities`,
        "",
        `Coordinator tools: ${provider.teamCapabilities.supportsCoordinatorTools ? "yes" : "no"}`,
        `Worker: ${provider.teamCapabilities.supportsWorker ? "yes" : "no"}`,
      ].join("\n");
      surfaces.push(
        virtualSurface({
          provider,
          kind: "team-capability",
          label: `${label} team capabilities`,
          path: `provider://${provider.driver}/team-capabilities`,
          activation: "runtime-config",
          enabled: provider.enabled,
          sourceLabel: `${label} runtime`,
          content,
          metadata: [
            {
              label: "Coordinator tools",
              value: provider.teamCapabilities.supportsCoordinatorTools ? "yes" : "no",
            },
            { label: "Worker", value: provider.teamCapabilities.supportsWorker ? "yes" : "no" },
          ],
        }),
      );
    }
  }

  return surfaces;
}
