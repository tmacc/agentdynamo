import type {
  ProjectGetIntelligenceInput,
  ProjectGetIntelligenceResult,
  ProjectGetSurfaceOverridesInput,
  ProjectGetSurfaceOverridesResult,
  ProjectReadIntelligenceSurfaceInput,
  ProjectReadIntelligenceSurfaceResult,
  ProjectSetSurfaceEnabledInput,
  ProjectSetSurfaceEnabledResult,
} from "@t3tools/contracts";
import { Context, Schema, type Effect } from "effect";

export class ProjectIntelligenceResolverError extends Schema.TaggedErrorClass<ProjectIntelligenceResolverError>()(
  "ProjectIntelligenceResolverError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface ProjectIntelligenceResolverShape {
  readonly getIntelligence: (
    input: ProjectGetIntelligenceInput,
  ) => Effect.Effect<ProjectGetIntelligenceResult, ProjectIntelligenceResolverError>;
  readonly readSurface: (
    input: ProjectReadIntelligenceSurfaceInput,
  ) => Effect.Effect<ProjectReadIntelligenceSurfaceResult, ProjectIntelligenceResolverError>;
  readonly getSurfaceOverrides: (
    input: ProjectGetSurfaceOverridesInput,
  ) => Effect.Effect<ProjectGetSurfaceOverridesResult, ProjectIntelligenceResolverError>;
  readonly setSurfaceEnabled: (
    input: ProjectSetSurfaceEnabledInput,
  ) => Effect.Effect<ProjectSetSurfaceEnabledResult, ProjectIntelligenceResolverError>;
}

export class ProjectIntelligenceResolver extends Context.Service<
  ProjectIntelligenceResolver,
  ProjectIntelligenceResolverShape
>()("t3/project/Services/ProjectIntelligenceResolver") {}
