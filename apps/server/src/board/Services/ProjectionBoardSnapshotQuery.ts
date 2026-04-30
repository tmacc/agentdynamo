import { BoardDismissedGhost, FeatureCard, ProjectId } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionBoardProjectSnapshot {
  readonly cards: ReadonlyArray<FeatureCard>;
  readonly dismissedGhosts: ReadonlyArray<BoardDismissedGhost>;
  readonly cardSequence: number;
  readonly dismissedGhostSequence: number;
  readonly snapshotSequence: number;
}

export interface ProjectionBoardSnapshotQueryShape {
  readonly getProjectSnapshot: (input: {
    readonly projectId: ProjectId;
  }) => Effect.Effect<ProjectionBoardProjectSnapshot, ProjectionRepositoryError>;
}

export class ProjectionBoardSnapshotQuery extends Context.Service<
  ProjectionBoardSnapshotQuery,
  ProjectionBoardSnapshotQueryShape
>()("t3/board/Services/ProjectionBoardSnapshotQuery") {}
