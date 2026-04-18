import { BoardDismissedGhost, ProjectId, ThreadId } from "@t3tools/contracts";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ListBoardDismissedGhostsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListBoardDismissedGhostsByProjectInput =
  typeof ListBoardDismissedGhostsByProjectInput.Type;

export const DeleteBoardDismissedGhostInput = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
});
export type DeleteBoardDismissedGhostInput = typeof DeleteBoardDismissedGhostInput.Type;

export interface ProjectionBoardDismissedGhostRepositoryShape {
  readonly upsert: (
    row: BoardDismissedGhost,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByProject: (
    input: ListBoardDismissedGhostsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<BoardDismissedGhost>, ProjectionRepositoryError>;
  readonly delete: (
    input: DeleteBoardDismissedGhostInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionBoardDismissedGhostRepository extends Context.Service<
  ProjectionBoardDismissedGhostRepository,
  ProjectionBoardDismissedGhostRepositoryShape
>()(
  "t3/persistence/Services/ProjectionBoardDismissedGhosts/ProjectionBoardDismissedGhostRepository",
) {}
