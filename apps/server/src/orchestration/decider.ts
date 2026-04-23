import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@t3tools/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  listThreadsByProjectId,
  requireBoardCardColumnAllowsThreadLink,
  requireBoardCardInProject,
  requireBoardCardLinkedThreadMatches,
  requireBoardCardMoveAllowed,
  requireBoardThreadLinkAvailable,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadInProject,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
} from "./commandInvariants.ts";
import { projectEvent } from "./projector.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import type { ProjectionBoardCardRepositoryShape } from "../persistence/Services/ProjectionBoardCards.ts";

const nowIso = () => new Date().toISOString();
const defaultMetadata: Omit<OrchestrationEvent, "sequence" | "type" | "payload"> = {
  eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
  aggregateKind: "thread",
  aggregateId: "" as OrchestrationEvent["aggregateId"],
  occurredAt: nowIso(),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
};

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Omit<OrchestrationEvent, "sequence" | "type" | "payload"> {
  return {
    ...defaultMetadata,
    eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.commandId,
    metadata: input.metadata ?? {},
  };
}

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

function providerDisplayName(provider: keyof typeof PROVIDER_DISPLAY_NAMES): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  readModel,
  boardCardRepository,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly readModel: OrchestrationReadModel;
  readonly boardCardRepository?: ProjectionBoardCardRepositoryShape;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | ProjectionRepositoryError
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
      ...(boardCardRepository ? { boardCardRepository } : {}),
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(Effect.orDie);
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
  boardCardRepository,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
  readonly boardCardRepository?: ProjectionBoardCardRepositoryShape;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | ProjectionRepositoryError
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });

      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeThreads = listThreadsByProjectId(readModel, command.projectId).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.fork": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });

      const threadCreatedEvent = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.created" as const,
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          forkOrigin: command.forkOrigin,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };

      const messageEvents = command.clonedMessages.map((message) => ({
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: message.updatedAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent" as const,
        payload: {
          threadId: command.threadId,
          messageId: message.id,
          role: message.role,
          text: message.text,
          ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
          turnId: null,
          streaming: message.streaming,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        },
      }));

      const proposedPlanEvents = command.clonedProposedPlans.map((proposedPlan) => ({
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: proposedPlan.updatedAt,
          commandId: command.commandId,
        }),
        type: "thread.proposed-plan-upserted" as const,
        payload: {
          threadId: command.threadId,
          proposedPlan,
        },
      }));

      const contextHandoffPreparedEvent = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.context-handoff-prepared" as const,
        payload: {
          handoffId: command.handoffId,
          threadId: command.threadId,
          reason: "fork" as const,
          sourceThreadId: command.forkOrigin.sourceThreadId,
          sourceThreadTitle: command.forkOrigin.sourceThreadTitle,
          sourceUserMessageId: command.forkOrigin.sourceUserMessageId,
          targetProvider: command.modelSelection.provider,
          importedUntilAt: command.forkOrigin.importedUntilAt,
          createdAt: command.createdAt,
        },
      };

      return [
        threadCreatedEvent,
        ...messageEvents,
        ...proposedPlanEvents,
        contextHandoffPreparedEvent,
      ];
    }

    case "thread.context-handoff.mark-delivered": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });

      const deliveredEvent = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.context-handoff-delivered" as const,
        payload: {
          handoffId: command.handoffId,
          threadId: command.threadId,
          liveMessageId: command.liveMessageId,
          provider: command.provider,
          turnId: command.turnId,
          renderStats: command.renderStats,
          deliveredAt: command.createdAt,
        },
      };

      const handoff = thread.contextHandoffs.find((entry) => entry.id === command.handoffId);
      if (handoff?.reason !== "provider-switch") {
        return deliveredEvent;
      }

      const sourceProvider = handoff.sourceProvider;
      const targetProvider =
        command.modelSelection?.provider ?? handoff.targetProvider ?? command.provider;
      const targetModel = command.modelSelection?.model;
      const sourceProviderLabel =
        sourceProvider === undefined ? undefined : providerDisplayName(sourceProvider);
      const targetProviderLabel = providerDisplayName(targetProvider);
      const providerSwitchActivityEvent = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.activity-appended" as const,
        payload: {
          threadId: command.threadId,
          activity: {
            id: crypto.randomUUID() as OrchestrationEvent["eventId"],
            tone: "info" as const,
            kind: "provider.session.switched",
            summary:
              sourceProviderLabel === undefined
                ? `Switched to ${targetProviderLabel}`
                : `Switched from ${sourceProviderLabel} to ${targetProviderLabel}`,
            payload: {
              handoffId: command.handoffId,
              messageId: command.liveMessageId,
              ...(sourceProvider !== undefined ? { fromProvider: sourceProvider } : {}),
              toProvider: targetProvider,
              ...(targetModel !== undefined ? { toModel: targetModel } : {}),
              renderStats: command.renderStats,
            },
            turnId: null,
            createdAt: command.createdAt,
          },
        },
      };

      return [deliveredEvent, providerSwitchActivityEvent];
    }

    case "thread.context-handoff.prepare": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });

      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.context-handoff-prepared" as const,
        payload: {
          handoffId: command.handoffId,
          threadId: command.threadId,
          reason: command.reason,
          sourceThreadId: command.sourceThreadId,
          sourceThreadTitle: command.sourceThreadTitle,
          sourceUserMessageId: command.sourceUserMessageId,
          ...(command.sourceProvider !== undefined
            ? { sourceProvider: command.sourceProvider }
            : {}),
          ...(command.targetProvider !== undefined
            ? { targetProvider: command.targetProvider }
            : {}),
          importedUntilAt: command.importedUntilAt,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.context-handoff.mark-delivery-failed": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });

      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.context-handoff-delivery-failed" as const,
        payload: {
          handoffId: command.handoffId,
          threadId: command.threadId,
          liveMessageId: command.liveMessageId,
          ...(command.provider !== undefined ? { provider: command.provider } : {}),
          detail: command.detail,
          ...(command.renderStats !== undefined ? { renderStats: command.renderStats } : {}),
          failedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      return [userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        }),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        }),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
    }

    case "board.card.create": {
      if (!boardCardRepository) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Board card repository is unavailable.",
        });
      }
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (command.linkedThreadId !== null) {
        yield* requireBoardCardColumnAllowsThreadLink({
          command,
          card: {
            id: command.cardId,
            column: command.column,
          },
        });
        yield* requireThreadInProject({
          readModel,
          command,
          threadId: command.linkedThreadId,
          projectId: command.projectId,
        });
        yield* requireBoardThreadLinkAvailable({
          command,
          threadId: command.linkedThreadId,
          cardId: command.cardId,
          repository: boardCardRepository,
        });
      }
      return {
        ...withEventBase({
          aggregateKind: "board",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "board.card-created",
        payload: {
          cardId: command.cardId,
          projectId: command.projectId,
          title: command.title,
          description: command.description,
          seededPrompt: command.seededPrompt,
          column: command.column,
          sortOrder: command.sortOrder,
          linkedThreadId: command.linkedThreadId,
          linkedProposedPlanId: command.linkedProposedPlanId,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "board.card.update": {
      if (!boardCardRepository) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Board card repository is unavailable.",
        });
      }
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireBoardCardInProject({
        command,
        cardId: command.cardId,
        projectId: command.projectId,
        repository: boardCardRepository,
      });
      return {
        ...withEventBase({
          aggregateKind: "board",
          aggregateId: command.projectId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        }),
        type: "board.card-updated",
        payload: {
          cardId: command.cardId,
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.description !== undefined ? { description: command.description } : {}),
          ...(command.seededPrompt !== undefined ? { seededPrompt: command.seededPrompt } : {}),
          updatedAt: command.updatedAt,
        },
      };
    }

    case "board.card.move": {
      if (!boardCardRepository) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Board card repository is unavailable.",
        });
      }
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const card = yield* requireBoardCardInProject({
        command,
        cardId: command.cardId,
        projectId: command.projectId,
        repository: boardCardRepository,
      });
      yield* requireBoardCardMoveAllowed({
        command,
        card,
        toColumn: command.toColumn,
      });
      return {
        ...withEventBase({
          aggregateKind: "board",
          aggregateId: command.projectId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        }),
        type: "board.card-moved",
        payload: {
          cardId: command.cardId,
          projectId: command.projectId,
          toColumn: command.toColumn,
          sortOrder: command.sortOrder,
          updatedAt: command.updatedAt,
        },
      };
    }

    case "board.card.archive": {
      if (!boardCardRepository) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Board card repository is unavailable.",
        });
      }
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireBoardCardInProject({
        command,
        cardId: command.cardId,
        projectId: command.projectId,
        repository: boardCardRepository,
      });
      return {
        ...withEventBase({
          aggregateKind: "board",
          aggregateId: command.projectId,
          occurredAt: command.archivedAt,
          commandId: command.commandId,
        }),
        type: "board.card-archived",
        payload: {
          cardId: command.cardId,
          projectId: command.projectId,
          archivedAt: command.archivedAt,
          updatedAt: command.archivedAt,
        },
      };
    }

    case "board.card.delete": {
      if (!boardCardRepository) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Board card repository is unavailable.",
        });
      }
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireBoardCardInProject({
        command,
        cardId: command.cardId,
        projectId: command.projectId,
        repository: boardCardRepository,
      });
      return {
        ...withEventBase({
          aggregateKind: "board",
          aggregateId: command.projectId,
          occurredAt: command.deletedAt,
          commandId: command.commandId,
        }),
        type: "board.card-deleted",
        payload: {
          cardId: command.cardId,
          projectId: command.projectId,
          deletedAt: command.deletedAt,
        },
      };
    }

    case "board.card.linkThread": {
      if (!boardCardRepository) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Board card repository is unavailable.",
        });
      }
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const card = yield* requireBoardCardInProject({
        command,
        cardId: command.cardId,
        projectId: command.projectId,
        repository: boardCardRepository,
      });
      yield* requireBoardCardColumnAllowsThreadLink({
        command,
        card,
      });
      yield* requireThreadInProject({
        readModel,
        command,
        threadId: command.threadId,
        projectId: command.projectId,
      });
      yield* requireBoardThreadLinkAvailable({
        command,
        threadId: command.threadId,
        cardId: command.cardId,
        repository: boardCardRepository,
      });
      return {
        ...withEventBase({
          aggregateKind: "board",
          aggregateId: command.projectId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        }),
        type: "board.card-thread-linked",
        payload: {
          cardId: command.cardId,
          projectId: command.projectId,
          threadId: command.threadId,
          updatedAt: command.updatedAt,
        },
      };
    }

    case "board.card.unlinkThread": {
      if (!boardCardRepository) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Board card repository is unavailable.",
        });
      }
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const card = yield* requireBoardCardInProject({
        command,
        cardId: command.cardId,
        projectId: command.projectId,
        repository: boardCardRepository,
      });
      yield* requireBoardCardLinkedThreadMatches({
        command,
        card,
        expectedThreadId: command.previousThreadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "board",
          aggregateId: command.projectId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        }),
        type: "board.card-thread-unlinked",
        payload: {
          cardId: command.cardId,
          projectId: command.projectId,
          previousThreadId: command.previousThreadId,
          updatedAt: command.updatedAt,
        },
      };
    }

    case "board.ghost-card.dismiss": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      return {
        ...withEventBase({
          aggregateKind: "board",
          aggregateId: command.projectId,
          occurredAt: command.dismissedAt,
          commandId: command.commandId,
        }),
        type: "board.ghost-card-dismissed",
        payload: {
          projectId: command.projectId,
          threadId: command.threadId,
          dismissedAt: command.dismissedAt,
        },
      };
    }

    case "board.ghost-card.undismiss": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      return {
        ...withEventBase({
          aggregateKind: "board",
          aggregateId: command.projectId,
          occurredAt: command.undismissedAt,
          commandId: command.commandId,
        }),
        type: "board.ghost-card-undismissed",
        payload: {
          projectId: command.projectId,
          threadId: command.threadId,
          undismissedAt: command.undismissedAt,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
