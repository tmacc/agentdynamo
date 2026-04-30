import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import { ProviderSessionRecoveryReconciler } from "../Services/ProviderSessionRecoveryReconciler.ts";
import { ProviderSessionRecoveryReconcilerLive } from "./ProviderSessionRecoveryReconciler.ts";

const now = "2026-04-28T12:00:00.000Z";
const threadId = ThreadId.make("thread-recover");
const turnId = TurnId.make("turn-recover");

function makeReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: now,
    projects: [
      {
        id: ProjectId.make("project-recover"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        scripts: [],
        worktreeSetup: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project-recover"),
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          assistantMessageId: null,
        },
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
        teamParent: null,
        teamTasks: [],
        messages: [],
        proposedPlans: [],
        contextHandoffs: [],
        activities: [],
        checkpoints: [],
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: turnId,
          lastError: null,
          updatedAt: now,
        },
      },
    ],
  };
}

describe("ProviderSessionRecoveryReconciler", () => {
  it("settles persisted active work before publishing stopped when provider recovers ready without an active turn", async () => {
    const dispatched: OrchestrationCommand[] = [];
    const directoryUpserts: ProviderRuntimeBinding[] = [];
    const engine: OrchestrationEngineShape = {
      getReadModel: () => Effect.succeed(makeReadModel()),
      readEvents: () => Stream.empty,
      getLatestSequence: () => Effect.succeed(0),
      readEventsRange: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          return { sequence: dispatched.length };
        }),
      streamDomainEvents: Stream.empty,
      subscribeDomainEvents: () => Effect.die("unused"),
    };
    const providerService: ProviderServiceShape = {
      startSession: () => Effect.die("unused"),
      sendTurn: () => Effect.die("unused"),
      interruptTurn: () => Effect.die("unused"),
      respondToRequest: () => Effect.die("unused"),
      respondToUserInput: () => Effect.die("unused"),
      stopSession: () => Effect.die("unused"),
      recoverSession: () =>
        Effect.succeed({
          provider: "codex",
          status: "ready",
          runtimeMode: "approval-required",
          threadId,
          createdAt: now,
          updatedAt: now,
        }),
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
      rollbackConversation: () => Effect.die("unused"),
      streamEvents: Stream.empty,
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* ProviderSessionRecoveryReconciler;
        yield* reconciler.reconcileNow();
      }).pipe(
        Effect.provide(
          ProviderSessionRecoveryReconcilerLive.pipe(
            Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
            Layer.provide(Layer.succeed(ProviderService, providerService)),
            Layer.provide(
              Layer.succeed(ProviderSessionDirectory, {
                upsert: (binding) =>
                  Effect.sync(() => {
                    directoryUpserts.push(binding);
                  }),
                getProvider: () => Effect.succeed("codex"),
                getBinding: () => Effect.succeed(Option.none()),
                listThreadIds: () => Effect.succeed([]),
                listBindings: () =>
                  Effect.succeed([
                    {
                      threadId,
                      provider: "codex",
                      status: "running",
                      runtimeMode: "approval-required",
                      runtimePayload: { activeTurnId: turnId },
                      resumeCursor: { cursor: "resume" },
                      lastSeenAt: now,
                    },
                  ]),
              }),
            ),
          ),
        ),
      ),
    );

    const turnCompleteIndex = dispatched.findIndex(
      (command) => command.type === "thread.turn.complete",
    );
    const finalSessionIndex = dispatched.findIndex(
      (command) =>
        command.type === "thread.session.set" &&
        command.session.status === "stopped" &&
        command.session.activeTurnId === null,
    );
    expect(turnCompleteIndex).toBeGreaterThanOrEqual(0);
    expect(finalSessionIndex).toBeGreaterThan(turnCompleteIndex);
    expect(dispatched).not.toContainEqual(
      expect.objectContaining({
        type: "thread.session.set",
        session: expect.objectContaining({
          status: "ready",
          activeTurnId: turnId,
        }),
      }),
    );
    expect(dispatched[turnCompleteIndex]).toEqual(
      expect.objectContaining({
        type: "thread.turn.complete",
        commandId: CommandId.make(`recovery:turn-complete:${threadId}:${turnId}:interrupted`),
        turnId,
        state: "interrupted",
      }),
    );
    expect(directoryUpserts).toContainEqual(
      expect.objectContaining({
        threadId,
        provider: "codex",
        runtimeMode: "approval-required",
        status: "stopped",
        resumeCursor: null,
        runtimePayload: expect.objectContaining({
          activeTurnId: null,
          lastRuntimeEvent: "provider.recovery.finalized",
        }),
      }),
    );
  });

  it("continues reconciling later bindings when one thread fails", async () => {
    const failedThreadId = ThreadId.make("thread-recover-failed");
    const failedTurnId = TurnId.make("turn-recover-failed");
    const successfulThreadId = ThreadId.make("thread-recover-success");
    const successfulTurnId = TurnId.make("turn-recover-success");
    const base = makeReadModel();
    const baseThread = base.threads[0]!;
    const readModel: OrchestrationReadModel = {
      ...base,
      threads: [
        {
          ...baseThread,
          id: failedThreadId,
          latestTurn: { ...baseThread.latestTurn!, turnId: failedTurnId },
          session: { ...baseThread.session!, threadId: failedThreadId, activeTurnId: failedTurnId },
        },
        {
          ...baseThread,
          id: successfulThreadId,
          latestTurn: { ...baseThread.latestTurn!, turnId: successfulTurnId },
          session: {
            ...baseThread.session!,
            threadId: successfulThreadId,
            activeTurnId: successfulTurnId,
          },
        },
      ],
    };
    const dispatched: OrchestrationCommand[] = [];
    const directoryUpserts: ProviderRuntimeBinding[] = [];
    const engine: OrchestrationEngineShape = {
      getReadModel: () => Effect.succeed(readModel),
      readEvents: () => Stream.empty,
      getLatestSequence: () => Effect.succeed(0),
      readEventsRange: () => Stream.empty,
      dispatch: (command) =>
        "threadId" in command && command.threadId === failedThreadId
          ? Effect.die("simulated dispatch failure")
          : Effect.sync(() => {
              dispatched.push(command);
              return { sequence: dispatched.length };
            }),
      streamDomainEvents: Stream.empty,
      subscribeDomainEvents: () => Effect.die("unused"),
    };
    const providerService: ProviderServiceShape = {
      startSession: () => Effect.die("unused"),
      sendTurn: () => Effect.die("unused"),
      interruptTurn: () => Effect.die("unused"),
      respondToRequest: () => Effect.die("unused"),
      respondToUserInput: () => Effect.die("unused"),
      stopSession: () => Effect.die("unused"),
      recoverSession: ({ threadId: recoveredThreadId }) =>
        Effect.succeed({
          provider: "codex",
          status: "ready",
          runtimeMode: "approval-required",
          threadId: recoveredThreadId,
          createdAt: now,
          updatedAt: now,
        }),
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
      rollbackConversation: () => Effect.die("unused"),
      streamEvents: Stream.empty,
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciler = yield* ProviderSessionRecoveryReconciler;
        yield* reconciler.reconcileNow();
      }).pipe(
        Effect.provide(
          ProviderSessionRecoveryReconcilerLive.pipe(
            Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
            Layer.provide(Layer.succeed(ProviderService, providerService)),
            Layer.provide(
              Layer.succeed(ProviderSessionDirectory, {
                upsert: (binding) =>
                  Effect.sync(() => {
                    directoryUpserts.push(binding);
                  }),
                getProvider: () => Effect.succeed("codex"),
                getBinding: () => Effect.succeed(Option.none()),
                listThreadIds: () => Effect.succeed([]),
                listBindings: () =>
                  Effect.succeed([
                    {
                      threadId: failedThreadId,
                      provider: "codex",
                      status: "running",
                      runtimeMode: "approval-required",
                      runtimePayload: { activeTurnId: failedTurnId },
                      resumeCursor: { cursor: "failed" },
                      lastSeenAt: now,
                    },
                    {
                      threadId: successfulThreadId,
                      provider: "codex",
                      status: "running",
                      runtimeMode: "approval-required",
                      runtimePayload: { activeTurnId: successfulTurnId },
                      resumeCursor: { cursor: "successful" },
                      lastSeenAt: now,
                    },
                  ]),
              }),
            ),
          ),
        ),
      ),
    );

    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: "thread.turn.complete",
        threadId: successfulThreadId,
        turnId: successfulTurnId,
      }),
    );
    expect(directoryUpserts).toContainEqual(
      expect.objectContaining({
        threadId: successfulThreadId,
        status: "stopped",
        resumeCursor: null,
      }),
    );
    expect(directoryUpserts).not.toContainEqual(
      expect.objectContaining({
        threadId: failedThreadId,
      }),
    );
  });
});
