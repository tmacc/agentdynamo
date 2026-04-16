import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type {
  ProjectGetIntelligenceInput,
  ProjectGetIntelligenceResult,
  ProjectReadIntelligenceSurfaceInput,
  ProjectReadIntelligenceSurfaceResult,
} from "@t3tools/contracts";

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
}

export class ProjectIntelligenceResolver extends Context.Service<
  ProjectIntelligenceResolver,
  ProjectIntelligenceResolverShape
>()("t3/project/Services/ProjectIntelligenceResolver") {}
