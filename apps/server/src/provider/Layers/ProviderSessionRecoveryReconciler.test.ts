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
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
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
    const engine: OrchestrationEngineShape = {
      getReadModel: () => Effect.succeed(makeReadModel()),
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          return { sequence: dispatched.length };
        }),
      streamDomainEvents: Stream.empty,
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
                upsert: () => Effect.void,
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
  });
});
