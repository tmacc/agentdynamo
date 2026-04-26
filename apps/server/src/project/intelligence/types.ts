import type {
  ProjectIntelligenceContentType,
  ProjectIntelligenceSurfaceKind,
  ProjectIntelligenceSurfaceSummary,
} from "@t3tools/contracts";

export type ProjectIntelligenceReadTarget =
  | {
      readonly mode: "file";
      readonly path: string;
      readonly contentType: ProjectIntelligenceContentType;
      readonly kind: ProjectIntelligenceSurfaceKind;
    }
  | {
      readonly mode: "virtual";
      readonly content: string;
      readonly contentType: ProjectIntelligenceContentType;
    };

export interface DiscoveredProjectIntelligenceSurface {
  readonly summary: ProjectIntelligenceSurfaceSummary;
  readonly readTarget: ProjectIntelligenceReadTarget;
}
