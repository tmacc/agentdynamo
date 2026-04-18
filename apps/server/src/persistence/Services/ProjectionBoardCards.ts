import {
  FeatureCard,
  FeatureCardId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const GetProjectionBoardCardInput = Schema.Struct({
  cardId: FeatureCardId,
});
export type GetProjectionBoardCardInput = typeof GetProjectionBoardCardInput.Type;

export const ListProjectionBoardCardsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionBoardCardsByProjectInput =
  typeof ListProjectionBoardCardsByProjectInput.Type;

export const GetProjectionBoardCardByLinkedThreadInput = Schema.Struct({
  linkedThreadId: ThreadId,
});
export type GetProjectionBoardCardByLinkedThreadInput =
  typeof GetProjectionBoardCardByLinkedThreadInput.Type;

export const DeleteProjectionBoardCardInput = Schema.Struct({
  cardId: FeatureCardId,
});
export type DeleteProjectionBoardCardInput = typeof DeleteProjectionBoardCardInput.Type;

export interface ProjectionBoardCardRepositoryShape {
  readonly upsert: (row: FeatureCard) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionBoardCardInput,
  ) => Effect.Effect<Option.Option<FeatureCard>, ProjectionRepositoryError>;
  readonly getByLinkedThreadId: (
    input: GetProjectionBoardCardByLinkedThreadInput,
  ) => Effect.Effect<Option.Option<FeatureCard>, ProjectionRepositoryError>;
  readonly listByProject: (
    input: ListProjectionBoardCardsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<FeatureCard>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteProjectionBoardCardInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionBoardCardRepository extends Context.Service<
  ProjectionBoardCardRepository,
  ProjectionBoardCardRepositoryShape
>()("t3/persistence/Services/ProjectionBoardCards/ProjectionBoardCardRepository") {}
