import type {
  FeatureCard,
  FeatureCardId,
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Option } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { type ProjectionBoardCardRepositoryShape } from "../persistence/Services/ProjectionBoardCards.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType,
    detail,
  });
}

export function findThreadById(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationThread | undefined {
  return readModel.threads.find((thread) => thread.id === threadId);
}

export function findProjectById(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): OrchestrationProject | undefined {
  return readModel.projects.find((project) => project.id === projectId);
}

export function listThreadsByProjectId(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): ReadonlyArray<OrchestrationThread> {
  return readModel.threads.filter((thread) => thread.projectId === projectId);
}

export function requireProject(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<OrchestrationProject, OrchestrationCommandInvariantError> {
  const project = findProjectById(input.readModel, input.projectId);
  if (project) {
    return Effect.succeed(project);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireProjectAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findProjectById(input.readModel, input.projectId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireThread(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  const thread = findThreadById(input.readModel, input.threadId);
  if (thread) {
    return Effect.succeed(thread);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Thread '${input.threadId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireThreadInProject(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.projectId === input.projectId
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' does not belong to project '${input.projectId}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt !== null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is not archived for command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadNotArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt === null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is already archived and cannot handle command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findThreadById(input.readModel, input.threadId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Thread '${input.threadId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireNonNegativeInteger(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly field: string;
  readonly value: number;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (Number.isInteger(input.value) && input.value >= 0) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.commandType,
      `${input.field} must be an integer greater than or equal to 0.`,
    ),
  );
}

export function requireBoardCard(input: {
  readonly command: OrchestrationCommand;
  readonly cardId: FeatureCardId;
  readonly repository: ProjectionBoardCardRepositoryShape;
}): Effect.Effect<FeatureCard, OrchestrationCommandInvariantError | ProjectionRepositoryError> {
  return input.repository.getById({ cardId: input.cardId }).pipe(
    Effect.flatMap((card) =>
      Option.match(card, {
        onNone: () =>
          Effect.fail(
            invariantError(
              input.command.type,
              `Board card '${input.cardId}' does not exist for command '${input.command.type}'.`,
            ),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
}

export function requireBoardCardInProject(input: {
  readonly command: OrchestrationCommand;
  readonly cardId: FeatureCardId;
  readonly projectId: ProjectId;
  readonly repository: ProjectionBoardCardRepositoryShape;
}): Effect.Effect<FeatureCard, OrchestrationCommandInvariantError | ProjectionRepositoryError> {
  return requireBoardCard(input).pipe(
    Effect.flatMap((card) =>
      card.projectId === input.projectId
        ? Effect.succeed(card)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Board card '${input.cardId}' does not belong to project '${input.projectId}'.`,
            ),
          ),
    ),
  );
}

export function requireBoardCardLinkedThreadMatches(input: {
  readonly command: OrchestrationCommand;
  readonly card: FeatureCard;
  readonly expectedThreadId: ThreadId | null;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.expectedThreadId === null) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Board card '${input.card.id}' is not currently linked to a thread and cannot be unlinked.`,
      ),
    );
  }

  if (input.card.linkedThreadId === input.expectedThreadId) {
    return Effect.void;
  }

  const actualThreadState =
    input.card.linkedThreadId === null
      ? "not linked"
      : `linked to thread '${input.card.linkedThreadId}'`;
  return Effect.fail(
    invariantError(
      input.command.type,
      `Board card '${input.card.id}' expected linked thread '${input.expectedThreadId}' but is currently ${actualThreadState}.`,
    ),
  );
}

export function requireBoardCardColumnAllowsThreadLink(input: {
  readonly command: OrchestrationCommand;
  readonly card: Pick<FeatureCard, "id" | "column">;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.card.column === "planned") {
    return Effect.void;
  }

  return Effect.fail(
    invariantError(
      input.command.type,
      `Board card '${input.card.id}' must be in 'planned' before it can link to a thread.`,
    ),
  );
}

export function requireBoardCardMoveAllowed(input: {
  readonly command: OrchestrationCommand;
  readonly card: Pick<FeatureCard, "id" | "linkedThreadId">;
  readonly toColumn: FeatureCard["column"];
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.card.linkedThreadId === null || input.toColumn !== "ideas") {
    return Effect.void;
  }

  return Effect.fail(
    invariantError(
      input.command.type,
      `Board card '${input.card.id}' is linked to a thread and cannot move to 'ideas'.`,
    ),
  );
}

export function requireBoardThreadLinkAvailable(input: {
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
  readonly cardId: FeatureCardId;
  readonly repository: ProjectionBoardCardRepositoryShape;
}): Effect.Effect<void, OrchestrationCommandInvariantError | ProjectionRepositoryError> {
  return input.repository.getByLinkedThreadId({ linkedThreadId: input.threadId }).pipe(
    Effect.flatMap((card) =>
      Option.match(card, {
        onNone: () => Effect.void,
        onSome: (existingCard) =>
          existingCard.id === input.cardId
            ? Effect.void
            : Effect.fail(
                invariantError(
                  input.command.type,
                  `Thread '${input.threadId}' is already linked to board card '${existingCard.id}'.`,
                ),
              ),
      }),
    ),
  );
}
