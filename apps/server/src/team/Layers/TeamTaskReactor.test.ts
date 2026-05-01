import {
  CommandId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationTeamTask,
  type OrchestrationThread,
  MessageId,
  ProjectId,
  TeamTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Ref, Stream } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { TeamTaskReactor } from "../Services/TeamTaskReactor.ts";
import { TeamTaskReactorLive } from "./TeamTaskReactor.ts";

const now = "2026-04-29T12:00:00.000Z";
const projectId = ProjectId.make("project-team-task-reactor");
const parentThreadId = ThreadId.make("thread-parent");
const childThreadId = ThreadId.make("thread-child");
const taskId = TeamTaskId.make("task-1");

function makeThread(input: Partial<OrchestrationThread> & Pick<OrchestrationThread, "id">) {
  return {
    id: input.id,
    projectId,
    title: input.title ?? String(input.id),
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: input.latestTurn ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    archivedAt: null,
    deletedAt: null,
    teamParent: input.teamParent ?? null,
    teamTasks: input.teamTasks ?? [],
    contextHandoffs: [],
    messages: input.messages ?? [],
    proposedPlans: [],
    activities: input.activities ?? [],
    checkpoints: [],
    session: input.session ?? null,
  } satisfies OrchestrationThread;
}

function makeTask(input?: Partial<OrchestrationTeamTask>) {
  return {
    id: taskId,
    parentThreadId,
    childThreadId,
    title: "Child task",
    task: "Do the task",
    roleLabel: null,
    kind: "general",
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    modelSelectionMode: "fallback",
    modelSelectionReason: "Default model",
    workspaceMode: "shared",
    resolvedWorkspaceMode: "shared",
    setupMode: "skip",
    resolvedSetupMode: "skip",
    source: "dynamo",
    childThreadMaterialized: true,
    nativeProviderRef: null,
    status: "running",
    latestSummary: "aaaa",
    errorText: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    ...input,
  } satisfies OrchestrationTeamTask;
}

it.effect("TeamTaskReactor uses summary-content hashes for deterministic syncAll command IDs", () =>
  Effect.gen(function* () {
    const summary = yield* Ref.make("bbbb");
    const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    const readModel = () =>
      Ref.get(summary).pipe(
        Effect.map(
          (text): OrchestrationReadModel => ({
            snapshotSequence: 0,
            projects: [],
            updatedAt: now,
            threads: [
              makeThread({
                id: parentThreadId,
                teamTasks: [makeTask()],
              }),
              makeThread({
                id: childThreadId,
                teamParent: {
                  parentThreadId,
                  taskId,
                  roleLabel: null,
                },
                messages: [
                  {
                    id: MessageId.make("message-child-summary"),
                    role: "assistant",
                    text,
                    turnId: null,
                    streaming: false,
                    createdAt: now,
                    updatedAt: now,
                  },
                ],
              }),
            ],
          }),
        ),
      );
    const layer = TeamTaskReactorLive.pipe(
      Layer.provide(
        Layer.succeed(OrchestrationEngineService, {
          getReadModel: readModel,
          readEvents: () => Stream.empty,
          getLatestSequence: () => Effect.succeed(0),
          readEventsRange: () => Stream.empty,
          streamDomainEvents: Stream.empty,
          subscribeDomainEvents: () => Effect.die("unused"),
          dispatch: (command: OrchestrationCommand) =>
            Ref.update(commands, (existing) => [...existing, command]).pipe(
              Effect.as({ sequence: 1 }),
            ),
        }),
      ),
    );

    yield* Effect.gen(function* () {
      const reactor = yield* TeamTaskReactor;
      yield* reactor.syncAll?.() ?? Effect.die("syncAll missing");
      yield* Ref.set(summary, "cccc");
      yield* reactor.syncAll?.() ?? Effect.die("syncAll missing");
    }).pipe(Effect.provide(layer));

    const summaryCommands = (yield* Ref.get(commands)).filter(
      (
        command,
      ): command is Extract<OrchestrationCommand, { type: "thread.team-task.update-summary" }> =>
        command.type === "thread.team-task.update-summary",
    );
    assert.equal(summaryCommands.length, 2);
    assert.notEqual(
      String(summaryCommands[0]?.commandId ?? CommandId.make("missing-1")),
      String(summaryCommands[1]?.commandId ?? CommandId.make("missing-2")),
    );
  }),
);
