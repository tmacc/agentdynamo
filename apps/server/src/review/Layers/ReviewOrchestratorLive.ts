import {
  CommandId,
  EventId,
  type OrchestrationTeamTask,
  type ReviewFinding,
  type ReviewResult,
  type ReviewState,
  type ReviewStartInput,
  type ReviewTier,
  type TeamTaskId,
  type ThreadId,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { Cause, Effect, Fiber, FileSystem, Layer, Path, Ref } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { GitHubCli } from "../../git/Services/GitHubCli.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { TeamOrchestrationService } from "../../team/Services/TeamOrchestrationService.ts";
import { ReviewOrchestrator } from "../Services/ReviewOrchestrator.ts";
import { collectClaudeMdFragments, type ReviewStepContext } from "../reviewContext.ts";
import { dedupeFindings, parseReviewFindings, parseVerification } from "../reviewParsing.ts";
import { pickReviewPreset } from "../reviewPresets.ts";
import { detectReviewTier } from "../reviewTier.ts";
import { renderReviewStepPrompt, renderVerifyPrompt } from "../prompts/index.ts";

const commandId = (tag: string): CommandId =>
  CommandId.make(`server:review:${tag}:${crypto.randomUUID()}`);

class ReviewOrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewOrchestratorError";
  }
}

interface ReviewRun {
  readonly threadId: ThreadId;
  readonly taskIds: ReadonlyArray<TeamTaskId>;
  readonly fiber: Fiber.Fiber<void, unknown> | null;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(errorMessage(cause));
}

function failedState(input: {
  readonly previous: ReviewState;
  readonly detail: string;
  readonly now: string;
}): ReviewState {
  return {
    ...input.previous,
    status: "failed",
    updatedAt: input.now,
    completedAt: input.now,
    errorText: input.detail,
  };
}

function runningState(input: {
  readonly tier: ReviewTier;
  readonly label: string | null;
  readonly prRef: string | null;
  readonly now: string;
}): ReviewState {
  return {
    status: "queued",
    tier: input.tier,
    label: input.label,
    startedAt: input.now,
    updatedAt: input.now,
    completedAt: null,
    prRef: input.prRef,
    prNumber: null,
    prTitle: null,
    baseRef: null,
    headRef: null,
    findings: [],
    droppedFindingCount: 0,
    errorText: null,
    taskIds: [],
  };
}

function withTasks(state: ReviewState, taskIds: ReadonlyArray<TeamTaskId>): ReviewState {
  return {
    ...state,
    taskIds: [...taskIds],
    status: "running",
    updatedAt: new Date().toISOString(),
  };
}

function verificationFlavor(provider: string): "anthropic" | "openai" {
  return provider === "claudeAgent" ? "anthropic" : "openai";
}

const makeReviewOrchestrator = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerRegistry = yield* ProviderRegistry;
  const team = yield* TeamOrchestrationService;
  const gh = yield* GitHubCli;
  const git = yield* GitCore;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runs = yield* Ref.make(new Map<string, ReviewRun>());

  const dispatchReviewState = (threadId: ThreadId, state: ReviewState, kind: "start" | "update") =>
    orchestrationEngine.dispatch({
      type: kind === "start" ? "thread.review.start" : "thread.review.update",
      commandId: commandId(kind),
      threadId,
      state,
      createdAt: new Date().toISOString(),
    });

  const runReview = (
    input: ReviewStartInput,
    initialState: ReviewState,
  ): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      let state = initialState;
      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((entry) => entry.id === input.threadId);
      if (!thread || thread.deletedAt !== null) {
        throw new ReviewOrchestratorError(`Unknown thread '${input.threadId}'.`);
      }
      const project = readModel.projects.find((entry) => entry.id === thread.projectId);
      if (!project || project.deletedAt !== null) {
        throw new ReviewOrchestratorError(`Unknown project '${thread.projectId}'.`);
      }

      const cwd = thread.worktreePath ?? project.workspaceRoot;
      const prRef = input.prRef ?? thread.branch ?? "HEAD";
      const pr = yield* gh
        .getPullRequest({ cwd, reference: prRef })
        .pipe(Effect.catch(() => Effect.succeed(null)));
      const diffRef = input.prRef ?? (pr ? String(pr.number) : prRef);
      const [diff, changedFiles] = yield* Effect.all([
        gh.execute({ cwd, args: ["pr", "diff", diffRef, "--patch"], timeoutMs: 60_000 }).pipe(
          Effect.map((result) => result.stdout),
          Effect.catch(() =>
            pr
              ? git.readRangeContext(cwd, pr.baseRefName).pipe(Effect.map((ctx) => ctx.diffPatch))
              : Effect.fail(new ReviewOrchestratorError("Unable to resolve PR diff.")),
          ),
        ),
        gh.execute({ cwd, args: ["pr", "diff", diffRef, "--name-only"], timeoutMs: 60_000 }).pipe(
          Effect.map((result) =>
            result.stdout
              .split(/\r?\n/g)
              .map((line) => line.trim())
              .filter(Boolean),
          ),
          Effect.catch(() => Effect.succeed([] as string[])),
        ),
      ]);
      const claudeMdFragments = yield* collectClaudeMdFragments(cwd, changedFiles).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      const ctx: ReviewStepContext = {
        prRef,
        pr,
        diff: diff.length > 120_000 ? `${diff.slice(0, 120_000)}\n[diff truncated]` : diff,
        changedFiles,
        claudeMdFragments,
      };

      state = {
        ...state,
        status: "running",
        updatedAt: new Date().toISOString(),
        prRef,
        prNumber: pr?.number ?? null,
        prTitle: pr?.title ?? null,
        baseRef: pr?.baseRefName ?? null,
        headRef: pr?.headRefName ?? null,
      };
      yield* dispatchReviewState(input.threadId, state, "update");

      const providers = yield* providerRegistry.getProviders;
      const tier = detectReviewTier(providers);
      const preset = pickReviewPreset(tier, providers);
      if (!preset) {
        throw new ReviewOrchestratorError(
          "No authenticated review providers; sign in to Claude or Codex.",
        );
      }
      state = { ...state, tier, label: preset.label, updatedAt: new Date().toISOString() };
      yield* dispatchReviewState(input.threadId, state, "update");

      const spawned = yield* Effect.forEach(
        preset.steps,
        (step) =>
          team
            .spawnChild({
              parentThreadId: input.threadId,
              title: step.title,
              roleLabel: step.roleLabel,
              taskKind: "review",
              provider: ProviderDriverKind.make(step.primary.provider),
              model: step.primary.model,
              workspaceMode: "worktree",
              setupMode: "auto",
              relevantFiles: changedFiles.slice(0, 24),
              task: renderReviewStepPrompt(step, ctx),
            })
            .pipe(Effect.map((result) => ({ step, result }))),
        { concurrency: "unbounded" },
      );
      const reviewTaskIds = spawned.map((entry) => entry.result.task.id);
      yield* Ref.update(runs, (current) => {
        const next = new Map(current);
        const existing = next.get(input.threadId);
        next.set(input.threadId, {
          threadId: input.threadId,
          taskIds: [...(existing?.taskIds ?? []), ...reviewTaskIds],
          fiber: existing?.fiber ?? null,
        });
        return next;
      });
      state = withTasks(state, reviewTaskIds);
      yield* dispatchReviewState(input.threadId, state, "update");

      const settled: ReadonlyArray<OrchestrationTeamTask> = yield* team.waitForChildren({
        parentThreadId: input.threadId,
        taskIds: reviewTaskIds,
        timeoutSeconds: 180,
      });
      const findings = dedupeFindings(
        settled.flatMap((task) => {
          const source = spawned.find((entry) => entry.result.task.id === task.id);
          return parseReviewFindings({
            text: task.latestSummary,
            sourceStep: source?.step.kind ?? "bug-hunt",
            sourceTaskId: task.id,
          });
        }),
      ).slice(0, 12);

      const verified: ReviewFinding[] = [];
      let droppedFindingCount = 0;
      for (const finding of findings) {
        const sourceProvider =
          spawned.find((entry) => entry.result.task.id === finding.sourceTaskId)?.step.primary
            .provider ?? null;
        const verifierSelection =
          tier === "multi" && sourceProvider === preset.verifier.provider
            ? (spawned.find((entry) => entry.step.primary.provider !== sourceProvider)?.step
                .primary ?? preset.verifier)
            : preset.verifier;
        const verification = yield* team.spawnChild({
          parentThreadId: input.threadId,
          title: `Verify ${finding.file}:${finding.lineStart}`,
          roleLabel: "Verify finding",
          taskKind: "test",
          provider: ProviderDriverKind.make(verifierSelection.provider),
          model: verifierSelection.model,
          workspaceMode: "worktree",
          setupMode: "auto",
          relevantFiles: [finding.file],
          task: renderVerifyPrompt({
            finding,
            ctx,
            flavor: verificationFlavor(verifierSelection.provider),
            singleProviderMode: tier !== "multi",
          }),
        });
        yield* Ref.update(runs, (current) => {
          const next = new Map(current);
          const existing = next.get(input.threadId);
          next.set(input.threadId, {
            threadId: input.threadId,
            taskIds: [...(existing?.taskIds ?? []), verification.task.id],
            fiber: existing?.fiber ?? null,
          });
          return next;
        });
        const settledVerifiers: ReadonlyArray<OrchestrationTeamTask> = yield* team.waitForChildren({
          parentThreadId: input.threadId,
          taskIds: [verification.task.id],
          timeoutSeconds: 120,
        });
        const settledVerifier = settledVerifiers[0];
        const parsed = parseVerification(settledVerifier?.latestSummary ?? null);
        if (!parsed.reproduced) {
          droppedFindingCount += 1;
          continue;
        }
        verified.push({
          ...finding,
          verified: true,
          evidence: parsed.evidence,
          verifier: {
            provider: verifierSelection.provider,
            model: verification.modelSelection.model,
            reproduced: true,
            evidence: parsed.evidence,
            taskId: verification.task.id,
          },
        });
        state = {
          ...state,
          findings: verified,
          droppedFindingCount,
          taskIds: [...state.taskIds, verification.task.id],
          updatedAt: new Date().toISOString(),
        };
        yield* dispatchReviewState(input.threadId, state, "update");
      }

      const completedAt = new Date().toISOString();
      const result: ReviewResult = {
        threadId: input.threadId,
        tier,
        label: preset.label,
        prNumber: pr?.number ?? null,
        prTitle: pr?.title ?? null,
        baseRef: pr?.baseRefName ?? null,
        headRef: pr?.headRefName ?? null,
        findings: verified,
        droppedFindingCount,
        completedAt,
      };
      yield* orchestrationEngine.dispatch({
        type: "thread.review.complete",
        commandId: commandId("complete"),
        threadId: input.threadId,
        result,
        createdAt: completedAt,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: commandId("activity-complete"),
        threadId: input.threadId,
        activity: {
          id: EventId.make(crypto.randomUUID()),
          tone: "info",
          kind: "review.completed",
          summary: `Review completed with ${verified.length} verified finding${verified.length === 1 ? "" : "s"}.`,
          payload: result,
          turnId: null,
          createdAt: completedAt,
        },
        createdAt: completedAt,
      });
    }).pipe(Effect.mapError(toError));

  const start = (input: ReviewStartInput) =>
    Effect.gen(function* () {
      const providers = yield* providerRegistry.getProviders;
      const tier = detectReviewTier(providers);
      const preset = pickReviewPreset(tier, providers);
      const now = new Date().toISOString();
      const state = runningState({
        tier,
        label: preset?.label ?? null,
        prRef: input.prRef ?? null,
        now,
      });
      yield* dispatchReviewState(input.threadId, state, "start");
      const fiber = yield* runReview(input, state).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (Cause.hasInterruptsOnly(cause)) return;
            const detail = errorMessage(Cause.squash(cause));
            const failed = failedState({ previous: state, detail, now: new Date().toISOString() });
            yield* dispatchReviewState(input.threadId, failed, "update").pipe(
              Effect.ignoreCause({ log: true }),
            );
          }),
        ),
        Effect.ensuring(
          Ref.update(runs, (current) => {
            const next = new Map(current);
            next.delete(input.threadId);
            return next;
          }),
        ),
        Effect.forkDetach,
      );
      yield* Ref.update(runs, (current) => {
        const next = new Map(current);
        next.set(input.threadId, { threadId: input.threadId, taskIds: [], fiber });
        return next;
      });
      return state;
    }).pipe(Effect.mapError(toError));

  const cancel = (input: { readonly threadId: ThreadId }) =>
    Effect.gen(function* () {
      const run = (yield* Ref.get(runs)).get(input.threadId);
      if (run) {
        yield* Effect.forEach(
          run.taskIds,
          (taskId) =>
            team
              .closeChild({
                parentThreadId: input.threadId,
                taskId,
                reason: "Review cancelled.",
              })
              .pipe(Effect.ignoreCause({ log: true })),
          { concurrency: 4 },
        );
        if (run.fiber) {
          yield* Fiber.interrupt(run.fiber).pipe(Effect.ignore);
        }
      }
      const cancelledAt = new Date().toISOString();
      yield* orchestrationEngine.dispatch({
        type: "thread.review.cancel",
        commandId: commandId("cancel"),
        threadId: input.threadId,
        reason: "Review cancelled.",
        createdAt: cancelledAt,
      });
      const readModel = yield* orchestrationEngine.getReadModel();
      const fallback: ReviewState = {
        status: "cancelled",
        tier: "none",
        label: null,
        startedAt: cancelledAt,
        updatedAt: cancelledAt,
        completedAt: cancelledAt,
        prRef: null,
        prNumber: null,
        prTitle: null,
        baseRef: null,
        headRef: null,
        findings: [],
        droppedFindingCount: 0,
        errorText: "Review cancelled.",
        taskIds: [],
      };
      return (
        readModel.threads.find((thread) => thread.id === input.threadId)?.reviewState ?? fallback
      );
    }).pipe(Effect.mapError(toError));

  const getResult = (threadId: ThreadId) =>
    orchestrationEngine
      .getReadModel()
      .pipe(
        Effect.map(
          (model) => model.threads.find((thread) => thread.id === threadId)?.reviewState ?? null,
        ),
      );

  return { start, cancel, getResult };
});

export const ReviewOrchestratorLive = Layer.effect(ReviewOrchestrator, makeReviewOrchestrator);
