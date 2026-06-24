// @ts-nocheck
import {
  TeamTaskId,
  ThreadId,
  type GitStatusResult,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect, Option, Stream } from "effect";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { VcsStatusBroadcasterShape } from "../vcs/VcsStatusBroadcaster.ts";

export function makeGitStatusResult(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  const refName = overrides.refName ?? overrides.branch ?? "main";
  const hasPrimaryRemote = overrides.hasPrimaryRemote ?? overrides.hasOriginRemote ?? true;
  const isDefaultRef = overrides.isDefaultRef ?? overrides.isDefaultBranch ?? false;

  return {
    isRepo: true,
    hasPrimaryRemote,
    isDefaultRef,
    refName,
    hasOriginRemote: hasPrimaryRemote,
    isDefaultBranch: isDefaultRef,
    branch: refName,
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    aheadOfDefaultCount: 0,
    pr: null,
    ...overrides,
  };
}

export function makeOrchestrationReadModel(
  overrides: Partial<OrchestrationReadModel> = {},
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    projects: [],
    threads: [],
    ...overrides,
  };
}

export function makeProjectionSnapshotQueryMock(
  overrides: Partial<ProjectionSnapshotQueryShape> = {},
): ProjectionSnapshotQueryShape {
  return {
    getCommandReadModel: () => Effect.succeed(makeOrchestrationReadModel()),
    getSnapshot: () => Effect.succeed(makeOrchestrationReadModel()),
    getShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
        projects: [],
        threads: [],
      }),
    getArchivedShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
        projects: [],
        threads: [],
      }),
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
    getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    getFullThreadDiffContext: () => Effect.succeed(Option.none()),
    getThreadShellById: () => Effect.succeed(Option.none()),
    getThreadDetailById: () => Effect.succeed(Option.none()),
    getTeamTaskTrace: (input) =>
      Effect.succeed({
        snapshotSequence: 0,
        parentThreadId: input.parentThreadId ?? ThreadId.make("thread-test"),
        taskId: input.taskId ?? TeamTaskId.make("team-task-test"),
        items: [],
      }),
    ...overrides,
  };
}

export function makeOrchestrationEngineMock(
  overrides: Partial<OrchestrationEngineShape> = {},
): OrchestrationEngineShape {
  return {
    getReadModel: () => Effect.succeed(makeOrchestrationReadModel()),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    dispatch: () => Effect.succeed({ sequence: 0 }),
    ...overrides,
  };
}

export function makeVcsStatusBroadcasterMock(
  overrides: Partial<VcsStatusBroadcasterShape> = {},
): VcsStatusBroadcasterShape {
  return {
    getStatus: () => Effect.succeed(makeGitStatusResult()),
    refreshLocalStatus: () => Effect.succeed(makeGitStatusResult()),
    refreshStatus: () => Effect.succeed(makeGitStatusResult()),
    streamStatus: () => Stream.empty,
    ...overrides,
  };
}
