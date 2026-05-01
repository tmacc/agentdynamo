import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Cache,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Result,
} from "effect";
import {
  GitActionProgressEvent,
  GitActionProgressPhase,
  GitCommandError,
  GitPullRequestRemoteSelectionRequiredError,
  GitRunStackedActionResult,
  GitStackedAction,
  type GitPullRequestRemoteCandidate,
  type GitPreviewWorktreePatchResult,
  type GitStatusLocalResult,
  type GitStatusRemoteResult,
  type GitWorktreePatchFile,
  ModelSelection,
} from "@t3tools/contracts";
import {
  detectGitHostingProviderFromRemoteUrl,
  mergeGitStatusParts,
  resolveAutoFeatureBranchName,
  sanitizeBranchFragment,
  sanitizeFeatureBranchName,
} from "@t3tools/shared/git";

import { GitManagerError } from "@t3tools/contracts";
import {
  GitManager,
  type GitActionProgressReporter,
  type GitManagerShape,
  type GitRunStackedActionOptions,
} from "../Services/GitManager.ts";
import { GitCore } from "../Services/GitCore.ts";
import type { GitStatusDetails } from "../Services/GitCore.ts";
import { GitHubCli, type GitHubPullRequestSummary } from "../Services/GitHubCli.ts";
import { TextGeneration } from "../Services/TextGeneration.ts";
import { ProjectSetupScriptRunner } from "../../project/Services/ProjectSetupScriptRunner.ts";
import { extractBranchNameFromRemoteRef } from "../remoteRefs.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { isDedicatedDynamoTeamWorktreeTask } from "../../team/teamTaskGuards.ts";
import type { GitManagerServiceError } from "@t3tools/contracts";
import {
  decodeGitHubPullRequestListJson,
  formatGitHubJsonDecodeError,
} from "../githubPullRequests.ts";

const COMMIT_TIMEOUT_MS = 10 * 60_000;
const MAX_PROGRESS_TEXT_LENGTH = 500;
const SHORT_SHA_LENGTH = 7;
const TOAST_DESCRIPTION_MAX = 72;
const STATUS_RESULT_CACHE_TTL = Duration.seconds(1);
const STATUS_RESULT_CACHE_CAPACITY = 2_048;
const WORKTREE_PATCH_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const PULL_REQUEST_REMOTE_CONFIG_KEY = "dynamo.pullRequestRemote";
const LEGACY_PULL_REQUEST_REMOTE_CONFIG_KEY = "t3.pullRequestRemote";
const TEAM_TASK_ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting"]);
type StripProgressContext<T> = T extends any ? Omit<T, "actionId" | "cwd" | "action"> : never;
type GitActionProgressPayload = StripProgressContext<GitActionProgressEvent>;
type GitActionProgressEmitter = (event: GitActionProgressPayload) => Effect.Effect<void, never>;

function isNotGitRepositoryError(error: GitCommandError): boolean {
  return error.message.toLowerCase().includes("not a git repository");
}

interface OpenPrInfo {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
}

interface PullRequestInfo extends OpenPrInfo, PullRequestHeadRemoteInfo {
  state: "open" | "closed" | "merged";
  updatedAt: string | null;
}

interface ResolvedPullRequest {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
}

interface PullRequestHeadRemoteInfo {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}

interface BranchHeadContext {
  localBranch: string;
  headBranch: string;
  headSelectors: ReadonlyArray<string>;
  preferredHeadSelector: string;
  remoteName: string | null;
  headRepositoryNameWithOwner: string | null;
  headRepositoryOwnerLogin: string | null;
  isCrossRepository: boolean;
}

interface PullRequestRemoteSelection {
  configuredRemoteName: string | null;
  selectedRemoteName: string | null;
  candidates: ReadonlyArray<GitPullRequestRemoteCandidate>;
  requiresSelection: boolean;
}

interface RemoteRepositoryContext {
  repositoryNameWithOwner: string | null;
  ownerLogin: string | null;
}

function parseRepositoryNameFromPullRequestUrl(url: string): string | null {
  const trimmed = url.trim();
  const match = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/\d+(?:\/.*)?$/i.exec(trimmed);
  const repositoryName = match?.[1]?.trim() ?? "";
  return repositoryName.length > 0 ? repositoryName : null;
}

function resolveHeadRepositoryNameWithOwner(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string | null {
  const explicitRepository = pullRequest.headRepositoryNameWithOwner?.trim() ?? "";
  if (explicitRepository.length > 0) {
    return explicitRepository;
  }

  if (!pullRequest.isCrossRepository) {
    return null;
  }

  const ownerLogin = pullRequest.headRepositoryOwnerLogin?.trim() ?? "";
  const repositoryName = parseRepositoryNameFromPullRequestUrl(pullRequest.url);
  if (ownerLogin.length === 0 || !repositoryName) {
    return null;
  }

  return `${ownerLogin}/${repositoryName}`;
}

function resolvePullRequestWorktreeLocalBranchName(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string {
  if (!pullRequest.isCrossRepository) {
    return pullRequest.headBranch;
  }

  const sanitizedHeadBranch = sanitizeBranchFragment(pullRequest.headBranch).trim();
  const suffix = sanitizedHeadBranch.length > 0 ? sanitizedHeadBranch : "head";
  return `t3code/pr-${pullRequest.number}/${suffix}`;
}

function parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    );
  const repositoryNameWithOwner = match?.[1]?.trim() ?? "";
  return repositoryNameWithOwner.length > 0 ? repositoryNameWithOwner : null;
}

function parseRepositoryOwnerLogin(nameWithOwner: string | null): string | null {
  const trimmed = nameWithOwner?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  const [ownerLogin] = trimmed.split("/");
  const normalizedOwnerLogin = ownerLogin?.trim() ?? "";
  return normalizedOwnerLogin.length > 0 ? normalizedOwnerLogin : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalRepositoryNameWithOwner(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeOptionalOwnerLogin(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function resolvePullRequestHeadRepositoryNameWithOwner(
  pr: PullRequestHeadRemoteInfo & { url: string },
) {
  const explicitRepository = normalizeOptionalString(pr.headRepositoryNameWithOwner);
  if (explicitRepository) {
    return explicitRepository;
  }

  if (!pr.isCrossRepository) {
    return null;
  }

  const ownerLogin = normalizeOptionalString(pr.headRepositoryOwnerLogin);
  const repositoryName = parseRepositoryNameFromPullRequestUrl(pr.url);
  if (!ownerLogin || !repositoryName) {
    return null;
  }

  return `${ownerLogin}/${repositoryName}`;
}

function matchesBranchHeadContext(
  pr: PullRequestInfo,
  headContext: Pick<
    BranchHeadContext,
    "headBranch" | "headRepositoryNameWithOwner" | "headRepositoryOwnerLogin" | "isCrossRepository"
  >,
): boolean {
  if (pr.headRefName !== headContext.headBranch) {
    return false;
  }

  const expectedHeadRepository = normalizeOptionalRepositoryNameWithOwner(
    headContext.headRepositoryNameWithOwner,
  );
  const expectedHeadOwner =
    normalizeOptionalOwnerLogin(headContext.headRepositoryOwnerLogin) ??
    parseRepositoryOwnerLogin(expectedHeadRepository);
  const prHeadRepository = normalizeOptionalRepositoryNameWithOwner(
    resolvePullRequestHeadRepositoryNameWithOwner(pr),
  );
  const prHeadOwner =
    normalizeOptionalOwnerLogin(pr.headRepositoryOwnerLogin) ??
    parseRepositoryOwnerLogin(prHeadRepository);

  if (headContext.isCrossRepository) {
    if (pr.isCrossRepository === false) {
      return false;
    }
    if ((expectedHeadRepository || expectedHeadOwner) && !prHeadRepository && !prHeadOwner) {
      return false;
    }
    if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) {
      return false;
    }
    if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) {
      return false;
    }
    return true;
  }

  if (pr.isCrossRepository === true) {
    return false;
  }
  if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) {
    return false;
  }
  if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) {
    return false;
  }
  return true;
}

function toPullRequestInfo(summary: GitHubPullRequestSummary): PullRequestInfo {
  return {
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state ?? "open",
    updatedAt: null,
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

function gitManagerError(operation: string, detail: string, cause?: unknown): GitManagerError {
  return new GitManagerError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function isExistingPullRequestCreateError(error: unknown): boolean {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "detail" in error
        ? String((error as { detail?: unknown }).detail ?? "")
        : "";
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("pull request") &&
    normalized.includes("already exists") &&
    normalized.includes("branch")
  );
}

function parseNumstat(stdout: string): ReadonlyArray<GitWorktreePatchFile> {
  return stdout
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [insertionsRaw, deletionsRaw, ...pathParts] = line.split("\t");
      const insertions = Number.parseInt(insertionsRaw ?? "0", 10);
      const deletions = Number.parseInt(deletionsRaw ?? "0", 10);
      return {
        path: pathParts.join("\t"),
        insertions: Number.isFinite(insertions) ? Math.max(0, insertions) : 0,
        deletions: Number.isFinite(deletions) ? Math.max(0, deletions) : 0,
      };
    })
    .filter((file) => file.path.length > 0);
}

function hashPatch(patch: string): string {
  return createHash("sha256").update(patch).digest("hex");
}

function limitContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function shortenSha(sha: string | undefined): string | null {
  if (!sha) return null;
  return sha.slice(0, SHORT_SHA_LENGTH);
}

function truncateText(
  value: string | undefined,
  maxLength = TOAST_DESCRIPTION_MAX,
): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return "...".slice(0, maxLength);
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function withDescription(title: string, description: string | undefined) {
  return description ? { title, description } : { title };
}

function summarizeGitActionResult(
  result: Pick<GitRunStackedActionResult, "commit" | "push" | "pr">,
): {
  title: string;
  description?: string;
} {
  if (result.pr.status === "created" || result.pr.status === "opened_existing") {
    const prNumber = result.pr.number ? ` #${result.pr.number}` : "";
    const title = `${result.pr.status === "created" ? "Created PR" : "Opened PR"}${prNumber}`;
    return withDescription(title, truncateText(result.pr.title));
  }

  if (result.push.status === "pushed") {
    const shortSha = shortenSha(result.commit.commitSha);
    const branch = result.push.upstreamBranch ?? result.push.branch;
    const pushedCommitPart = shortSha ? ` ${shortSha}` : "";
    const branchPart = branch ? ` to ${branch}` : "";
    return withDescription(
      `Pushed${pushedCommitPart}${branchPart}`,
      truncateText(result.commit.subject),
    );
  }

  if (result.commit.status === "created") {
    const shortSha = shortenSha(result.commit.commitSha);
    const title = shortSha ? `Committed ${shortSha}` : "Committed changes";
    return withDescription(title, truncateText(result.commit.subject));
  }

  return { title: "Done" };
}

function sanitizeCommitMessage(generated: {
  subject: string;
  body: string;
  branch?: string | undefined;
}): {
  subject: string;
  body: string;
  branch?: string | undefined;
} {
  const rawSubject = generated.subject.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const subject = rawSubject.replace(/[.]+$/g, "").trim();
  const safeSubject = subject.length > 0 ? subject.slice(0, 72).trimEnd() : "Update project files";
  return {
    subject: safeSubject,
    body: generated.body.trim(),
    ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
  };
}

function sanitizeProgressText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= MAX_PROGRESS_TEXT_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_PROGRESS_TEXT_LENGTH).trimEnd();
}

interface CommitAndBranchSuggestion {
  subject: string;
  body: string;
  branch?: string | undefined;
  commitMessage: string;
}

function isCommitAction(
  action: GitStackedAction,
): action is "commit" | "commit_push" | "commit_push_pr" {
  return action === "commit" || action === "commit_push" || action === "commit_push_pr";
}

function formatCommitMessage(subject: string, body: string): string {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    return subject;
  }
  return `${subject}\n\n${trimmedBody}`;
}

function parseCustomCommitMessage(raw: string): { subject: string; body: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return null;
  }

  const [firstLine, ...rest] = normalized.split("\n");
  const subject = firstLine?.trim() ?? "";
  if (subject.length === 0) {
    return null;
  }

  return {
    subject,
    body: rest.join("\n").trim(),
  };
}

function appendUnique(values: string[], next: string | null | undefined): void {
  const trimmed = next?.trim() ?? "";
  if (trimmed.length === 0 || values.includes(trimmed)) {
    return;
  }
  values.push(trimmed);
}

function toStatusPr(pr: PullRequestInfo): {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
} {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state,
  };
}

function normalizePullRequestReference(reference: string): string {
  const trimmed = reference.trim();
  const hashNumber = /^#(\d+)$/.exec(trimmed);
  return hashNumber?.[1] ?? trimmed;
}

function canonicalizeExistingPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

function toResolvedPullRequest(pr: {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  state?: "open" | "closed" | "merged";
}): ResolvedPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state ?? "open",
  };
}

function shouldPreferSshRemote(url: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.startsWith("git@") || trimmed.startsWith("ssh://");
}

function toPullRequestHeadRemoteInfo(pr: {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}): PullRequestHeadRemoteInfo {
  return {
    ...(pr.isCrossRepository !== undefined ? { isCrossRepository: pr.isCrossRepository } : {}),
    ...(pr.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: pr.headRepositoryNameWithOwner }
      : {}),
    ...(pr.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: pr.headRepositoryOwnerLogin }
      : {}),
  };
}

export const makeGitManager = Effect.fn("makeGitManager")(function* () {
  const gitCore = yield* GitCore;
  const gitHubCli = yield* GitHubCli;
  const textGeneration = yield* TextGeneration;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
  const serverSettingsService = yield* ServerSettingsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const createProgressEmitter = (
    input: { cwd: string; action: GitStackedAction },
    options?: GitRunStackedActionOptions,
  ) => {
    const actionId = options?.actionId ?? randomUUID();
    const reporter = options?.progressReporter;

    const emit = (event: GitActionProgressPayload) =>
      reporter
        ? reporter.publish({
            actionId,
            cwd: input.cwd,
            action: input.action,
            ...event,
          } as GitActionProgressEvent)
        : Effect.void;

    return {
      actionId,
      emit,
    };
  };

  const makeTemporaryIndexDir = Effect.fn("makeTemporaryIndexDir")(function* () {
    return yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "dynamo-child-patch-")),
      catch: (cause) =>
        gitManagerError(
          "GitManager.applyWorktreePatch",
          "Failed to create a temporary Git index for child worktree changes.",
          cause,
        ),
    });
  });

  const removeTemporaryIndexDir = (dir: string) =>
    Effect.promise(() => rm(dir, { recursive: true, force: true })).pipe(Effect.ignore);

  const buildChildWorktreePatch = Effect.fn("buildChildWorktreePatch")(function* (
    childCwd: string,
    baseSha: string,
  ) {
    const tempDir = yield* makeTemporaryIndexDir();
    const indexFile = join(tempDir, "index");
    const env = { GIT_INDEX_FILE: indexFile };

    const generatePatch = Effect.gen(function* () {
      yield* gitCore.execute({
        operation: "GitManager.applyWorktreePatch.readTree",
        cwd: childCwd,
        args: ["read-tree", "HEAD"],
        env,
      });
      yield* gitCore.execute({
        operation: "GitManager.applyWorktreePatch.addAll",
        cwd: childCwd,
        args: ["add", "-A"],
        env,
      });
      const patch = yield* gitCore.execute({
        operation: "GitManager.applyWorktreePatch.diff",
        cwd: childCwd,
        args: ["diff", "--cached", "--binary", "--full-index", baseSha],
        env,
        maxOutputBytes: WORKTREE_PATCH_MAX_OUTPUT_BYTES,
        truncateOutputAtMaxBytes: false,
      });
      const numstat = yield* gitCore.execute({
        operation: "GitManager.applyWorktreePatch.numstat",
        cwd: childCwd,
        args: ["diff", "--cached", "--numstat", baseSha],
        env,
        maxOutputBytes: WORKTREE_PATCH_MAX_OUTPUT_BYTES,
        truncateOutputAtMaxBytes: false,
      });

      return {
        patch: patch.stdout,
        files: parseNumstat(numstat.stdout),
      };
    });

    return yield* generatePatch.pipe(Effect.ensuring(removeTemporaryIndexDir(tempDir)));
  });

  const resolveGitCommonDir = Effect.fn("resolveGitCommonDir")(function* (cwd: string) {
    const result = yield* gitCore.execute({
      operation: "GitManager.applyWorktreePatch.commonDir",
      cwd,
      args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    });
    return canonicalizeExistingPath(result.stdout.trim());
  });

  const resolveHeadSha = Effect.fn("resolveHeadSha")(function* (cwd: string) {
    const result = yield* gitCore.execute({
      operation: "GitManager.applyWorktreePatch.head",
      cwd,
      args: ["rev-parse", "HEAD"],
    });
    return result.stdout.trim();
  });

  const resolveMergeBase = Effect.fn("resolveMergeBase")(function* (
    childCwd: string,
    parentHeadSha: string,
  ) {
    const result = yield* gitCore.execute({
      operation: "GitManager.applyWorktreePatch.mergeBase",
      cwd: childCwd,
      args: ["merge-base", "HEAD", parentHeadSha],
    });
    return result.stdout.trim();
  });

  const resolveTeamTaskPatchContext = Effect.fn("resolveTeamTaskPatchContext")(function* (input: {
    parentThreadId: string;
    taskId: string;
    requireFinalTask: boolean;
  }) {
    const mapProjectionLookupError = (cause: unknown) =>
      gitManagerError(
        "GitManager.applyWorktreePatch",
        "Failed to read team task projection state.",
        cause,
      );
    const parentThreadOption = yield* projectionSnapshotQuery
      .getThreadDetailById(input.parentThreadId as never)
      .pipe(Effect.mapError(mapProjectionLookupError));
    if (Option.isNone(parentThreadOption)) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "The coordinator thread could not be found.",
      );
    }
    const parentThread = parentThreadOption.value;
    const task = (parentThread.teamTasks ?? []).find((candidate) => candidate.id === input.taskId);
    if (!task || task.parentThreadId !== parentThread.id) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "The child agent task does not belong to the coordinator thread.",
      );
    }
    if (input.requireFinalTask && TEAM_TASK_ACTIVE_STATUSES.has(task.status)) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "Wait for the child agent to finish before applying its changes.",
      );
    }
    const taskSource = task.source ?? "dynamo";
    const childThreadMaterialized = task.childThreadMaterialized ?? true;
    if (taskSource !== "dynamo" || !childThreadMaterialized) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "Native provider subagents do not have Dynamo-managed worktrees.",
      );
    }
    if (!isDedicatedDynamoTeamWorktreeTask(task)) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "This child agent did not run in an isolated worktree.",
      );
    }

    const childThreadOption = yield* projectionSnapshotQuery
      .getThreadDetailById(task.childThreadId)
      .pipe(Effect.mapError(mapProjectionLookupError));
    if (Option.isNone(childThreadOption)) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "The child agent thread could not be found.",
      );
    }
    const childThread = childThreadOption.value;
    if (
      childThread.teamParent?.parentThreadId !== parentThread.id ||
      childThread.teamParent.taskId !== task.id
    ) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "The child thread is not linked back to this coordinator task.",
      );
    }
    if (!childThread.worktreePath) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "This child agent did not run in an isolated worktree.",
      );
    }

    const parentCheckpointContext = yield* projectionSnapshotQuery
      .getThreadCheckpointContext(parentThread.id)
      .pipe(Effect.mapError(mapProjectionLookupError));
    if (Option.isNone(parentCheckpointContext)) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "The coordinator workspace could not be resolved.",
      );
    }
    const parentCwd = parentThread.worktreePath ?? parentCheckpointContext.value.workspaceRoot;
    const childCwd = childThread.worktreePath;
    const parentCanonicalPath = canonicalizeExistingPath(parentCwd);
    const childCanonicalPath = canonicalizeExistingPath(childCwd);

    if (parentCanonicalPath === childCanonicalPath) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "This child agent shares the coordinator workspace and cannot be reviewed as an isolated worktree.",
      );
    }

    const [parentCommonDir, childCommonDir] = yield* Effect.all(
      [resolveGitCommonDir(parentCwd), resolveGitCommonDir(childCwd)],
      { concurrency: "unbounded" },
    );
    if (parentCommonDir !== childCommonDir) {
      return yield* gitManagerError(
        "GitManager.applyWorktreePatch",
        "The child worktree does not belong to the coordinator repository.",
      );
    }

    const parentHeadSha = yield* resolveHeadSha(parentCwd);
    const childHeadSha = yield* resolveHeadSha(childCwd);
    const seedMetadata = yield* gitCore.readWorktreeSeedMetadata(childCwd);
    const baseSha = seedMetadata?.seedTreeSha ?? (yield* resolveMergeBase(childCwd, parentHeadSha));
    const childPatch = yield* buildChildWorktreePatch(childCwd, baseSha);
    const patchHash = hashPatch(childPatch.patch);

    return {
      parentCwd,
      childCwd,
      baseSha,
      childHeadSha,
      seedMetadata,
      patch: childPatch.patch,
      files: childPatch.files,
      patchHash,
      includesCommittedChanges: seedMetadata
        ? childHeadSha !== seedMetadata.baseHeadSha
        : childHeadSha !== baseSha,
    };
  });

  const configurePullRequestHeadUpstreamBase = Effect.fn("configurePullRequestHeadUpstream")(
    function* (
      cwd: string,
      pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
      localBranch = pullRequest.headBranch,
    ) {
      const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";
      if (repositoryNameWithOwner.length === 0) {
        return;
      }

      const cloneUrls = yield* gitHubCli.getRepositoryCloneUrls({
        cwd,
        repository: repositoryNameWithOwner,
      });
      const originRemoteUrl = yield* gitCore.readConfigValue(cwd, "remote.origin.url");
      const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url;
      const preferredRemoteName =
        pullRequest.headRepositoryOwnerLogin?.trim() ||
        repositoryNameWithOwner.split("/")[0]?.trim() ||
        "fork";
      const remoteName = yield* gitCore.ensureRemote({
        cwd,
        preferredName: preferredRemoteName,
        url: remoteUrl,
      });

      yield* gitCore.setBranchUpstream({
        cwd,
        branch: localBranch,
        remoteName,
        remoteBranch: pullRequest.headBranch,
      });
    },
  );

  const configurePullRequestHeadUpstream = (
    cwd: string,
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
    localBranch = pullRequest.headBranch,
  ) =>
    configurePullRequestHeadUpstreamBase(cwd, pullRequest, localBranch).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          `GitManager.configurePullRequestHeadUpstream: failed to configure upstream for ${localBranch} -> ${pullRequest.headBranch} in ${cwd}: ${error.message}`,
        ).pipe(Effect.asVoid),
      ),
    );

  const materializePullRequestHeadBranchBase = Effect.fn("materializePullRequestHeadBranch")(
    function* (
      cwd: string,
      pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
      localBranch = pullRequest.headBranch,
    ) {
      const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";

      if (repositoryNameWithOwner.length === 0) {
        yield* gitCore.fetchPullRequestBranch({
          cwd,
          prNumber: pullRequest.number,
          branch: localBranch,
        });
        return;
      }

      const cloneUrls = yield* gitHubCli.getRepositoryCloneUrls({
        cwd,
        repository: repositoryNameWithOwner,
      });
      const originRemoteUrl = yield* gitCore.readConfigValue(cwd, "remote.origin.url");
      const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url;
      const preferredRemoteName =
        pullRequest.headRepositoryOwnerLogin?.trim() ||
        repositoryNameWithOwner.split("/")[0]?.trim() ||
        "fork";
      const remoteName = yield* gitCore.ensureRemote({
        cwd,
        preferredName: preferredRemoteName,
        url: remoteUrl,
      });

      yield* gitCore.fetchRemoteBranch({
        cwd,
        remoteName,
        remoteBranch: pullRequest.headBranch,
        localBranch,
      });
      yield* gitCore.setBranchUpstream({
        cwd,
        branch: localBranch,
        remoteName,
        remoteBranch: pullRequest.headBranch,
      });
    },
  );

  const materializePullRequestHeadBranch = (
    cwd: string,
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
    localBranch = pullRequest.headBranch,
  ) =>
    materializePullRequestHeadBranchBase(cwd, pullRequest, localBranch).pipe(
      Effect.catch(() =>
        gitCore.fetchPullRequestBranch({
          cwd,
          prNumber: pullRequest.number,
          branch: localBranch,
        }),
      ),
    );
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";
  const normalizeStatusCacheKey = (cwd: string) => canonicalizeExistingPath(cwd);
  const nonRepositoryStatusDetails = {
    isRepo: false,
    hasOriginRemote: false,
    isDefaultBranch: false,
    branch: null,
    upstreamRef: null,
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
  } satisfies GitStatusDetails;
  const readLocalStatus = Effect.fn("readLocalStatus")(function* (cwd: string) {
    const details = yield* gitCore
      .statusDetailsLocal(cwd)
      .pipe(
        Effect.catchIf(isNotGitRepositoryError, () => Effect.succeed(nonRepositoryStatusDetails)),
      );
    const hostingProvider = details.isRepo
      ? yield* resolveHostingProvider(cwd, details.branch)
      : null;

    return {
      isRepo: details.isRepo,
      ...(hostingProvider ? { hostingProvider } : {}),
      hasOriginRemote: details.hasOriginRemote,
      isDefaultBranch: details.isDefaultBranch,
      branch: details.branch,
      hasWorkingTreeChanges: details.hasWorkingTreeChanges,
      workingTree: details.workingTree,
    } satisfies GitStatusLocalResult;
  });
  const localStatusResultCache = yield* Cache.makeWith(readLocalStatus, {
    capacity: STATUS_RESULT_CACHE_CAPACITY,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? STATUS_RESULT_CACHE_TTL : Duration.zero),
  });
  const invalidateLocalStatusResultCache = (cwd: string) =>
    Cache.invalidate(localStatusResultCache, normalizeStatusCacheKey(cwd));
  const readRemoteStatus = Effect.fn("readRemoteStatus")(function* (cwd: string) {
    const details = yield* gitCore
      .statusDetails(cwd)
      .pipe(Effect.catchIf(isNotGitRepositoryError, () => Effect.succeed(null)));
    if (details === null || !details.isRepo) {
      return null;
    }

    const pr =
      details.branch !== null
        ? yield* findLatestPr(cwd, {
            branch: details.branch,
            upstreamRef: details.upstreamRef,
          }).pipe(
            Effect.map((latest) => {
              if (!latest) return null;
              // On the default branch, only surface open PRs.
              // Merged/closed matches are usually reverse-merge history, not the thread's PR context.
              if (details.isDefaultBranch && latest.state !== "open") return null;
              return toStatusPr(latest);
            }),
            Effect.catch(() => Effect.succeed(null)),
          )
        : null;

    return {
      hasUpstream: details.hasUpstream,
      aheadCount: details.aheadCount,
      behindCount: details.behindCount,
      pr,
    } satisfies GitStatusRemoteResult;
  });
  const remoteStatusResultCache = yield* Cache.makeWith(readRemoteStatus, {
    capacity: STATUS_RESULT_CACHE_CAPACITY,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? STATUS_RESULT_CACHE_TTL : Duration.zero),
  });
  const invalidateRemoteStatusResultCache = (cwd: string) =>
    Cache.invalidate(remoteStatusResultCache, normalizeStatusCacheKey(cwd));

  const readConfigValueNullable = (cwd: string, key: string) =>
    gitCore.readConfigValue(cwd, key).pipe(Effect.catch(() => Effect.succeed(null)));

  const readPullRequestRemoteConfig = Effect.fn("readPullRequestRemoteConfig")(function* (
    cwd: string,
  ) {
    const configured = yield* readConfigValueNullable(cwd, PULL_REQUEST_REMOTE_CONFIG_KEY);
    if (configured) return configured;
    return yield* readConfigValueNullable(cwd, LEGACY_PULL_REQUEST_REMOTE_CONFIG_KEY);
  });

  const toPullRequestRemoteCandidate = (input: {
    readonly remoteName: string;
    readonly fetchUrl: string;
    readonly pushUrl: string | null;
  }): GitPullRequestRemoteCandidate | null => {
    const repositoryNameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(input.fetchUrl);
    const ownerLogin = parseRepositoryOwnerLogin(repositoryNameWithOwner);
    if (!repositoryNameWithOwner || !ownerLogin) {
      return null;
    }

    const pushRepositoryNameWithOwner =
      input.pushUrl && input.pushUrl !== input.fetchUrl
        ? parseGitHubRepositoryNameWithOwnerFromRemoteUrl(input.pushUrl)
        : null;

    return {
      remoteName: input.remoteName,
      repositoryNameWithOwner,
      ownerLogin,
      pushRepositoryNameWithOwner,
    };
  };

  const resolvePullRequestRemoteSelection = Effect.fn("resolvePullRequestRemoteSelection")(
    function* (cwd: string) {
      const configuredRemoteName = yield* readPullRequestRemoteConfig(cwd);
      const candidates = yield* gitCore.listRemotes(cwd).pipe(
        Effect.map((remotes) =>
          remotes
            .map(toPullRequestRemoteCandidate)
            .filter((candidate): candidate is GitPullRequestRemoteCandidate => candidate !== null)
            .toSorted((a, b) => a.remoteName.localeCompare(b.remoteName)),
        ),
      );

      const configuredCandidate = configuredRemoteName
        ? (candidates.find((candidate) => candidate.remoteName === configuredRemoteName) ?? null)
        : null;
      const uniqueRepositoryNames = new Set(
        candidates.map((candidate) => candidate.repositoryNameWithOwner.toLowerCase()),
      );
      const onlyRepositoryCandidate =
        uniqueRepositoryNames.size === 1
          ? (candidates.find((candidate) => candidate.remoteName === "origin") ??
            (candidates.length > 1 ? (candidates[0] ?? null) : null))
          : null;
      const singleOriginCandidate =
        candidates.length === 1 && candidates[0]?.remoteName === "origin"
          ? (candidates[0] ?? null)
          : null;
      const selectedRemoteName =
        configuredCandidate?.remoteName ??
        onlyRepositoryCandidate?.remoteName ??
        singleOriginCandidate?.remoteName ??
        null;
      const requiresSelection =
        selectedRemoteName === null && candidates.length > 1 && uniqueRepositoryNames.size > 1;

      return {
        configuredRemoteName,
        selectedRemoteName,
        candidates,
        requiresSelection,
      } satisfies PullRequestRemoteSelection;
    },
  );

  const resolvePullRequestBaseRepository = Effect.fn("resolvePullRequestBaseRepository")(function* (
    cwd: string,
  ) {
    const selection = yield* resolvePullRequestRemoteSelection(cwd);
    const selectedRemote =
      selection.selectedRemoteName === null
        ? null
        : (selection.candidates.find(
            (candidate) => candidate.remoteName === selection.selectedRemoteName,
          ) ?? null);

    return {
      selection,
      remoteName: selectedRemote?.remoteName ?? null,
      repositoryNameWithOwner: selectedRemote?.repositoryNameWithOwner ?? null,
      ownerLogin: selectedRemote?.ownerLogin ?? null,
    };
  });

  const resolveHostingProvider = Effect.fn("resolveHostingProvider")(function* (
    cwd: string,
    branch: string | null,
  ) {
    const preferredRemoteName =
      branch === null
        ? "origin"
        : ((yield* readConfigValueNullable(cwd, `branch.${branch}.remote`)) ?? "origin");
    const remoteUrl =
      (yield* readConfigValueNullable(cwd, `remote.${preferredRemoteName}.url`)) ??
      (yield* readConfigValueNullable(cwd, "remote.origin.url"));

    return remoteUrl ? detectGitHostingProviderFromRemoteUrl(remoteUrl) : null;
  });

  const resolveRemoteRepositoryContext = Effect.fn("resolveRemoteRepositoryContext")(function* (
    cwd: string,
    remoteName: string | null,
    urlPreference: "fetch-first" | "push-first" = "fetch-first",
  ) {
    if (!remoteName) {
      return {
        repositoryNameWithOwner: null,
        ownerLogin: null,
      } satisfies RemoteRepositoryContext;
    }

    const [fetchUrl, pushUrl] = yield* Effect.all(
      [
        readConfigValueNullable(cwd, `remote.${remoteName}.url`),
        readConfigValueNullable(cwd, `remote.${remoteName}.pushurl`),
      ],
      { concurrency: "unbounded" },
    );
    const candidateUrls =
      urlPreference === "push-first" ? [pushUrl, fetchUrl] : [fetchUrl, pushUrl];
    const repositoryNameWithOwner =
      candidateUrls
        .map((url) => parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url))
        .find((value): value is string => value !== null) ?? null;
    return {
      repositoryNameWithOwner,
      ownerLogin: parseRepositoryOwnerLogin(repositoryNameWithOwner),
    } satisfies RemoteRepositoryContext;
  });

  const resolveBranchHeadContext = Effect.fn("resolveBranchHeadContext")(function* (
    cwd: string,
    details: { branch: string; upstreamRef: string | null },
    baseRepository: RemoteRepositoryContext = {
      repositoryNameWithOwner: null,
      ownerLogin: null,
    },
  ) {
    const remoteName = yield* readConfigValueNullable(cwd, `branch.${details.branch}.remote`);
    const headBranchFromUpstream = details.upstreamRef
      ? extractBranchNameFromRemoteRef(details.upstreamRef, { remoteName })
      : "";
    const headBranch = headBranchFromUpstream.length > 0 ? headBranchFromUpstream : details.branch;
    const shouldProbeLocalBranchSelector =
      headBranchFromUpstream.length === 0 || headBranch === details.branch;

    const [remoteRepository, originRepository] = yield* Effect.all(
      [
        resolveRemoteRepositoryContext(cwd, remoteName, "push-first"),
        baseRepository.repositoryNameWithOwner === null
          ? resolveRemoteRepositoryContext(cwd, "origin")
          : Effect.succeed({
              repositoryNameWithOwner: null,
              ownerLogin: null,
            } satisfies RemoteRepositoryContext),
      ],
      { concurrency: "unbounded" },
    );
    const effectiveBaseRepository =
      baseRepository.repositoryNameWithOwner !== null ? baseRepository : originRepository;
    const normalizedHeadRepository = normalizeOptionalRepositoryNameWithOwner(
      remoteRepository.repositoryNameWithOwner,
    );
    const normalizedBaseRepository = normalizeOptionalRepositoryNameWithOwner(
      effectiveBaseRepository.repositoryNameWithOwner,
    );

    const isCrossRepository =
      normalizedHeadRepository !== null && normalizedBaseRepository !== null
        ? normalizedHeadRepository !== normalizedBaseRepository
        : remoteName !== null && remoteName !== "origin" && normalizedHeadRepository !== null;

    const ownerHeadSelector =
      remoteRepository.ownerLogin && headBranch.length > 0
        ? `${remoteRepository.ownerLogin}:${headBranch}`
        : null;
    const remoteAliasHeadSelector =
      remoteName && headBranch.length > 0 ? `${remoteName}:${headBranch}` : null;
    const headSelectors: string[] = [];
    if (isCrossRepository) {
      appendUnique(headSelectors, ownerHeadSelector);
      appendUnique(
        headSelectors,
        remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null,
      );
    }
    if (shouldProbeLocalBranchSelector) {
      appendUnique(headSelectors, details.branch);
    }
    appendUnique(headSelectors, headBranch !== details.branch ? headBranch : null);

    return {
      localBranch: details.branch,
      headBranch,
      headSelectors,
      preferredHeadSelector: isCrossRepository
        ? (ownerHeadSelector ?? remoteAliasHeadSelector ?? headBranch)
        : headBranch,
      remoteName,
      headRepositoryNameWithOwner: remoteRepository.repositoryNameWithOwner,
      headRepositoryOwnerLogin: remoteRepository.ownerLogin,
      isCrossRepository,
    } satisfies BranchHeadContext;
  });

  const findOpenPr = Effect.fn("findOpenPr")(function* (
    cwd: string,
    headContext: Pick<
      BranchHeadContext,
      | "headBranch"
      | "headSelectors"
      | "headRepositoryNameWithOwner"
      | "headRepositoryOwnerLogin"
      | "isCrossRepository"
    >,
    repository?: string | null,
  ) {
    for (const headSelector of headContext.headSelectors) {
      const pullRequests = yield* gitHubCli.listOpenPullRequests({
        cwd,
        headSelector,
        ...(repository ? { repository } : {}),
        limit: 1,
      });
      const normalizedPullRequests = pullRequests.map(toPullRequestInfo);

      const firstPullRequest = normalizedPullRequests.find((pullRequest) =>
        matchesBranchHeadContext(pullRequest, headContext),
      );
      if (firstPullRequest) {
        return {
          number: firstPullRequest.number,
          title: firstPullRequest.title,
          url: firstPullRequest.url,
          baseRefName: firstPullRequest.baseRefName,
          headRefName: firstPullRequest.headRefName,
          state: "open",
          updatedAt: null,
        } satisfies PullRequestInfo;
      }
    }

    return null;
  });

  const findLatestPr = Effect.fn("findLatestPr")(function* (
    cwd: string,
    details: { branch: string; upstreamRef: string | null },
  ) {
    const headContext = yield* resolveBranchHeadContext(cwd, details);
    const parsedByNumber = new Map<number, PullRequestInfo>();

    for (const headSelector of headContext.headSelectors) {
      const stdout = yield* gitHubCli
        .execute({
          cwd,
          args: [
            "pr",
            "list",
            "--head",
            headSelector,
            "--state",
            "all",
            "--limit",
            "20",
            "--json",
            "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
          ],
        })
        .pipe(Effect.map((result) => result.stdout));

      const raw = stdout.trim();
      if (raw.length === 0) {
        continue;
      }

      const pullRequests = yield* Effect.sync(() => decodeGitHubPullRequestListJson(raw)).pipe(
        Effect.flatMap((decoded) => {
          if (!Result.isSuccess(decoded)) {
            return Effect.fail(
              gitManagerError(
                "findLatestPr",
                `GitHub CLI returned invalid PR list JSON: ${formatGitHubJsonDecodeError(decoded.failure)}`,
                decoded.failure,
              ),
            );
          }

          return Effect.succeed(decoded.success);
        }),
      );

      for (const pr of pullRequests) {
        if (!matchesBranchHeadContext(pr, headContext)) {
          continue;
        }
        parsedByNumber.set(pr.number, pr);
      }
    }

    const parsed = Array.from(parsedByNumber.values()).toSorted((a, b) => {
      const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return right - left;
    });

    const latestOpenPr = parsed.find((pr) => pr.state === "open");
    if (latestOpenPr) {
      return latestOpenPr;
    }
    return parsed[0] ?? null;
  });

  const buildCompletionToast = Effect.fn("buildCompletionToast")(function* (
    cwd: string,
    result: Pick<GitRunStackedActionResult, "action" | "branch" | "commit" | "push" | "pr">,
  ) {
    const summary = summarizeGitActionResult(result);
    let latestOpenPr: PullRequestInfo | null = null;
    let currentBranchIsDefault = false;
    let finalBranchContext: {
      branch: string;
      upstreamRef: string | null;
      hasUpstream: boolean;
    } | null = null;

    if (result.action !== "commit") {
      const finalStatus = yield* gitCore.statusDetails(cwd);
      if (finalStatus.branch) {
        finalBranchContext = {
          branch: finalStatus.branch,
          upstreamRef: finalStatus.upstreamRef,
          hasUpstream: finalStatus.hasUpstream,
        };
        currentBranchIsDefault = finalStatus.isDefaultBranch;
      }
    }

    const explicitResultPr =
      (result.pr.status === "created" || result.pr.status === "opened_existing") && result.pr.url
        ? {
            url: result.pr.url,
            state: "open" as const,
          }
        : null;
    const shouldLookupExistingOpenPr =
      (result.action === "commit_push" || result.action === "push") &&
      result.push.status === "pushed" &&
      result.branch.status !== "created" &&
      !currentBranchIsDefault &&
      explicitResultPr === null &&
      finalBranchContext?.hasUpstream === true;

    if (shouldLookupExistingOpenPr && finalBranchContext) {
      latestOpenPr = yield* resolveBranchHeadContext(cwd, {
        branch: finalBranchContext.branch,
        upstreamRef: finalBranchContext.upstreamRef,
      }).pipe(
        Effect.flatMap((headContext) => findOpenPr(cwd, headContext)),
        Effect.catch(() => Effect.succeed(null)),
      );
    }

    const openPr = latestOpenPr ?? explicitResultPr;

    const cta =
      result.action === "commit" && result.commit.status === "created"
        ? {
            kind: "run_action" as const,
            label: "Push",
            action: { kind: "push" as const },
          }
        : (result.action === "push" ||
              result.action === "create_pr" ||
              result.action === "commit_push" ||
              result.action === "commit_push_pr") &&
            openPr?.url &&
            (!currentBranchIsDefault ||
              result.pr.status === "created" ||
              result.pr.status === "opened_existing")
          ? {
              kind: "open_pr" as const,
              label: "View PR",
              url: openPr.url,
            }
          : (result.action === "push" || result.action === "commit_push") &&
              result.push.status === "pushed" &&
              !currentBranchIsDefault
            ? {
                kind: "run_action" as const,
                label: "Create PR",
                action: { kind: "create_pr" as const },
              }
            : {
                kind: "none" as const,
              };

    return {
      ...summary,
      cta,
    };
  });

  const resolveBaseBranch = Effect.fn("resolveBaseBranch")(function* (
    cwd: string,
    branch: string,
    upstreamRef: string | null,
    headContext: Pick<BranchHeadContext, "isCrossRepository" | "remoteName">,
    repository?: string | null,
  ) {
    const configured = yield* gitCore.readConfigValue(cwd, `branch.${branch}.gh-merge-base`);
    if (configured) return configured;

    if (upstreamRef && !headContext.isCrossRepository) {
      const upstreamBranch = extractBranchNameFromRemoteRef(upstreamRef, {
        remoteName: headContext.remoteName,
      });
      if (upstreamBranch.length > 0 && upstreamBranch !== branch) {
        return upstreamBranch;
      }
    }

    const defaultFromGh = yield* gitHubCli
      .getDefaultBranch({
        cwd,
        ...(repository ? { repository } : {}),
      })
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (defaultFromGh) {
      return defaultFromGh;
    }

    return "main";
  });

  const resolveCommitAndBranchSuggestion = Effect.fn("resolveCommitAndBranchSuggestion")(
    function* (input: {
      cwd: string;
      branch: string | null;
      commitMessage?: string;
      /** When true, also produce a semantic feature branch name. */
      includeBranch?: boolean;
      filePaths?: readonly string[];
      modelSelection: ModelSelection;
    }) {
      const context = yield* gitCore.prepareCommitContext(input.cwd, input.filePaths);
      if (!context) {
        return null;
      }

      const customCommit = parseCustomCommitMessage(input.commitMessage ?? "");
      if (customCommit) {
        return {
          subject: customCommit.subject,
          body: customCommit.body,
          ...(input.includeBranch
            ? { branch: sanitizeFeatureBranchName(customCommit.subject) }
            : {}),
          commitMessage: formatCommitMessage(customCommit.subject, customCommit.body),
        };
      }

      const generated = yield* textGeneration
        .generateCommitMessage({
          cwd: input.cwd,
          branch: input.branch,
          stagedSummary: limitContext(context.stagedSummary, 8_000),
          stagedPatch: limitContext(context.stagedPatch, 50_000),
          ...(input.includeBranch ? { includeBranch: true } : {}),
          modelSelection: input.modelSelection,
        })
        .pipe(Effect.map((result) => sanitizeCommitMessage(result)));

      return {
        subject: generated.subject,
        body: generated.body,
        ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
        commitMessage: formatCommitMessage(generated.subject, generated.body),
      };
    },
  );

  const runCommitStep = Effect.fn("runCommitStep")(function* (
    modelSelection: ModelSelection,
    cwd: string,
    action: "commit" | "commit_push" | "commit_push_pr",
    branch: string | null,
    commitMessage?: string,
    preResolvedSuggestion?: CommitAndBranchSuggestion,
    filePaths?: readonly string[],
    progressReporter?: GitActionProgressReporter,
    actionId?: string,
  ) {
    const emit = (event: GitActionProgressPayload) =>
      progressReporter && actionId
        ? progressReporter.publish({
            actionId,
            cwd,
            action,
            ...event,
          } as GitActionProgressEvent)
        : Effect.void;

    let suggestion: CommitAndBranchSuggestion | null | undefined = preResolvedSuggestion;
    if (!suggestion) {
      const needsGeneration = !commitMessage?.trim();
      if (needsGeneration) {
        yield* emit({
          kind: "phase_started",
          phase: "commit",
          label: "Generating commit message...",
        });
      }
      suggestion = yield* resolveCommitAndBranchSuggestion({
        cwd,
        branch,
        ...(commitMessage ? { commitMessage } : {}),
        ...(filePaths ? { filePaths } : {}),
        modelSelection,
      });
    }
    if (!suggestion) {
      return { status: "skipped_no_changes" as const };
    }

    yield* emit({
      kind: "phase_started",
      phase: "commit",
      label: "Committing...",
    });

    let currentHookName: string | null = null;
    const commitProgress =
      progressReporter && actionId
        ? {
            onOutputLine: ({ stream, text }: { stream: "stdout" | "stderr"; text: string }) => {
              const sanitized = sanitizeProgressText(text);
              if (!sanitized) {
                return Effect.void;
              }
              return emit({
                kind: "hook_output",
                hookName: currentHookName,
                stream,
                text: sanitized,
              });
            },
            onHookStarted: (hookName: string) => {
              currentHookName = hookName;
              return emit({
                kind: "hook_started",
                hookName,
              });
            },
            onHookFinished: ({
              hookName,
              exitCode,
              durationMs,
            }: {
              hookName: string;
              exitCode: number | null;
              durationMs: number | null;
            }) => {
              if (currentHookName === hookName) {
                currentHookName = null;
              }
              return emit({
                kind: "hook_finished",
                hookName,
                exitCode,
                durationMs,
              });
            },
          }
        : null;
    const { commitSha } = yield* gitCore.commit(cwd, suggestion.subject, suggestion.body, {
      timeoutMs: COMMIT_TIMEOUT_MS,
      ...(commitProgress ? { progress: commitProgress } : {}),
    });
    if (currentHookName !== null) {
      yield* emit({
        kind: "hook_finished",
        hookName: currentHookName,
        exitCode: 0,
        durationMs: null,
      });
      currentHookName = null;
    }
    return {
      status: "created" as const,
      commitSha,
      subject: suggestion.subject,
    };
  });

  const runPrStep = Effect.fn("runPrStep")(function* (
    modelSelection: ModelSelection,
    cwd: string,
    fallbackBranch: string | null,
    emit: GitActionProgressEmitter,
  ) {
    const details = yield* gitCore.statusDetails(cwd);
    const branch = details.branch ?? fallbackBranch;
    if (!branch) {
      return yield* gitManagerError(
        "runPrStep",
        "Cannot create a pull request from detached HEAD.",
      );
    }
    if (!details.hasUpstream) {
      return yield* gitManagerError(
        "runPrStep",
        "Current branch has not been pushed. Push before creating a PR.",
      );
    }

    const baseRepositoryContext = yield* resolvePullRequestBaseRepository(cwd);
    const baseRepository = baseRepositoryContext.repositoryNameWithOwner;
    const headContext = yield* resolveBranchHeadContext(
      cwd,
      {
        branch,
        upstreamRef: details.upstreamRef,
      },
      baseRepositoryContext,
    );
    if (baseRepositoryContext.selection.requiresSelection) {
      return yield* new GitPullRequestRemoteSelectionRequiredError({
        operation: "runPrStep",
        detail: "Choose which GitHub remote should receive pull requests.",
        configuredRemoteName: baseRepositoryContext.selection.configuredRemoteName,
        selectedRemoteName: baseRepositoryContext.selection.selectedRemoteName,
        candidates: [...baseRepositoryContext.selection.candidates],
      });
    }
    const existing = yield* findOpenPr(cwd, headContext, baseRepository);
    if (existing) {
      return {
        status: "opened_existing" as const,
        url: existing.url,
        number: existing.number,
        baseBranch: existing.baseRefName,
        headBranch: existing.headRefName,
        title: existing.title,
      };
    }

    const baseBranch = yield* resolveBaseBranch(
      cwd,
      branch,
      details.upstreamRef,
      headContext,
      baseRepository,
    );
    yield* emit({
      kind: "phase_started",
      phase: "pr",
      label: "Generating PR content...",
    });
    const rangeContext = yield* gitCore.readRangeContext(cwd, baseBranch);

    const generated = yield* textGeneration.generatePrContent({
      cwd,
      baseBranch,
      headBranch: headContext.headBranch,
      commitSummary: limitContext(rangeContext.commitSummary, 20_000),
      diffSummary: limitContext(rangeContext.diffSummary, 20_000),
      diffPatch: limitContext(rangeContext.diffPatch, 60_000),
      modelSelection,
    });

    const bodyFile = path.join(tempDir, `t3code-pr-body-${process.pid}-${randomUUID()}.md`);
    yield* fileSystem
      .writeFileString(bodyFile, generated.body)
      .pipe(
        Effect.mapError((cause) =>
          gitManagerError("runPrStep", "Failed to write pull request body temp file.", cause),
        ),
      );
    yield* emit({
      kind: "phase_started",
      phase: "pr",
      label: "Creating GitHub pull request...",
    });
    const recoveredExisting = yield* gitHubCli
      .createPullRequest({
        cwd,
        baseBranch,
        headSelector: headContext.preferredHeadSelector,
        ...(baseRepository ? { repository: baseRepository } : {}),
        title: generated.title,
        bodyFile,
      })
      .pipe(
        Effect.as(null as PullRequestInfo | null),
        Effect.catchIf(isExistingPullRequestCreateError, (error) =>
          findOpenPr(cwd, headContext, baseRepository).pipe(
            Effect.flatMap((existing) =>
              existing ? Effect.succeed(existing) : Effect.fail(error),
            ),
          ),
        ),
        Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))),
      );

    if (recoveredExisting) {
      return {
        status: "opened_existing" as const,
        url: recoveredExisting.url,
        number: recoveredExisting.number,
        baseBranch: recoveredExisting.baseRefName,
        headBranch: recoveredExisting.headRefName,
        title: recoveredExisting.title,
      };
    }

    const created = yield* findOpenPr(cwd, headContext, baseRepository);
    if (!created) {
      return {
        status: "created" as const,
        baseBranch,
        headBranch: headContext.headBranch,
        title: generated.title,
      };
    }

    return {
      status: "created" as const,
      url: created.url,
      number: created.number,
      baseBranch: created.baseRefName,
      headBranch: created.headRefName,
      title: created.title,
    };
  });

  const localStatus: GitManagerShape["localStatus"] = Effect.fn("localStatus")(function* (input) {
    return yield* Cache.get(localStatusResultCache, normalizeStatusCacheKey(input.cwd));
  });
  const remoteStatus: GitManagerShape["remoteStatus"] = Effect.fn("remoteStatus")(
    function* (input) {
      return yield* Cache.get(remoteStatusResultCache, normalizeStatusCacheKey(input.cwd));
    },
  );
  const status: GitManagerShape["status"] = Effect.fn("status")(function* (input) {
    const [local, remote] = yield* Effect.all([localStatus(input), remoteStatus(input)]);
    return mergeGitStatusParts(local, remote);
  });
  const invalidateLocalStatus: GitManagerShape["invalidateLocalStatus"] = Effect.fn(
    "invalidateLocalStatus",
  )(function* (cwd) {
    yield* invalidateLocalStatusResultCache(cwd);
  });
  const invalidateRemoteStatus: GitManagerShape["invalidateRemoteStatus"] = Effect.fn(
    "invalidateRemoteStatus",
  )(function* (cwd) {
    yield* invalidateRemoteStatusResultCache(cwd);
  });
  const invalidateStatus: GitManagerShape["invalidateStatus"] = Effect.fn("invalidateStatus")(
    function* (cwd) {
      yield* invalidateLocalStatusResultCache(cwd);
      yield* invalidateRemoteStatusResultCache(cwd);
    },
  );

  const resolvePullRequest: GitManagerShape["resolvePullRequest"] = Effect.fn("resolvePullRequest")(
    function* (input) {
      const pullRequest = yield* gitHubCli
        .getPullRequest({
          cwd: input.cwd,
          reference: normalizePullRequestReference(input.reference),
        })
        .pipe(Effect.map((resolved) => toResolvedPullRequest(resolved)));

      return { pullRequest };
    },
  );

  const getPullRequestRemoteOptions: GitManagerShape["getPullRequestRemoteOptions"] = Effect.fn(
    "getPullRequestRemoteOptions",
  )(function* (input) {
    const selection = yield* resolvePullRequestRemoteSelection(input.cwd);
    return {
      configuredRemoteName: selection.configuredRemoteName,
      selectedRemoteName: selection.selectedRemoteName,
      candidates: [...selection.candidates],
      requiresSelection: selection.requiresSelection,
    };
  });

  const setPullRequestRemote: GitManagerShape["setPullRequestRemote"] = Effect.fn(
    "setPullRequestRemote",
  )(function* (input) {
    const selection = yield* resolvePullRequestRemoteSelection(input.cwd);
    const candidate = selection.candidates.find((remote) => remote.remoteName === input.remoteName);
    if (!candidate) {
      return yield* gitManagerError(
        "setPullRequestRemote",
        `Remote "${input.remoteName}" is not an available GitHub PR remote for this repository.`,
      );
    }

    yield* gitCore.setConfigValue(input.cwd, PULL_REQUEST_REMOTE_CONFIG_KEY, candidate.remoteName);
    return {
      remoteName: candidate.remoteName,
    };
  });

  const preparePullRequestThread: GitManagerShape["preparePullRequestThread"] = Effect.fn(
    "preparePullRequestThread",
  )(function* (input) {
    const maybeRunSetupScript = (worktreePath: string) => {
      if (!input.threadId) {
        return Effect.void;
      }
      return projectSetupScriptRunner
        .runForThread({
          threadId: input.threadId,
          projectCwd: input.cwd,
          worktreePath,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `GitManager.preparePullRequestThread: failed to launch worktree setup script for thread ${input.threadId} in ${worktreePath}: ${error.message}`,
            ).pipe(Effect.asVoid),
          ),
        );
    };
    return yield* Effect.gen(function* () {
      const normalizedReference = normalizePullRequestReference(input.reference);
      const rootWorktreePath = canonicalizeExistingPath(input.cwd);
      const pullRequestSummary = yield* gitHubCli.getPullRequest({
        cwd: input.cwd,
        reference: normalizedReference,
      });
      const pullRequest = toResolvedPullRequest(pullRequestSummary);

      if (input.mode === "local") {
        yield* gitHubCli.checkoutPullRequest({
          cwd: input.cwd,
          reference: normalizedReference,
          force: true,
        });
        const details = yield* gitCore.statusDetails(input.cwd);
        yield* configurePullRequestHeadUpstream(
          input.cwd,
          {
            ...pullRequest,
            ...toPullRequestHeadRemoteInfo(pullRequestSummary),
          },
          details.branch ?? pullRequest.headBranch,
        );
        return {
          pullRequest,
          branch: details.branch ?? pullRequest.headBranch,
          worktreePath: null,
        };
      }

      const ensureExistingWorktreeUpstream = Effect.fn("ensureExistingWorktreeUpstream")(function* (
        worktreePath: string,
      ) {
        const details = yield* gitCore.statusDetails(worktreePath);
        yield* configurePullRequestHeadUpstream(
          worktreePath,
          {
            ...pullRequest,
            ...toPullRequestHeadRemoteInfo(pullRequestSummary),
          },
          details.branch ?? pullRequest.headBranch,
        );
      });

      const pullRequestWithRemoteInfo = {
        ...pullRequest,
        ...toPullRequestHeadRemoteInfo(pullRequestSummary),
      } as const;
      const localPullRequestBranch =
        resolvePullRequestWorktreeLocalBranchName(pullRequestWithRemoteInfo);

      const findLocalHeadBranch = (cwd: string) =>
        gitCore.listBranches({ cwd }).pipe(
          Effect.map((result) => {
            const localBranch = result.branches.find(
              (branch) => !branch.isRemote && branch.name === localPullRequestBranch,
            );
            if (localBranch) {
              return localBranch;
            }
            if (localPullRequestBranch === pullRequest.headBranch) {
              return null;
            }
            return (
              result.branches.find(
                (branch) =>
                  !branch.isRemote &&
                  branch.name === pullRequest.headBranch &&
                  branch.worktreePath !== null &&
                  canonicalizeExistingPath(branch.worktreePath) !== rootWorktreePath,
              ) ?? null
            );
          }),
        );

      const existingBranchBeforeFetch = yield* findLocalHeadBranch(input.cwd);
      const existingBranchBeforeFetchPath = existingBranchBeforeFetch?.worktreePath
        ? canonicalizeExistingPath(existingBranchBeforeFetch.worktreePath)
        : null;
      if (
        existingBranchBeforeFetch?.worktreePath &&
        existingBranchBeforeFetchPath !== rootWorktreePath
      ) {
        yield* ensureExistingWorktreeUpstream(existingBranchBeforeFetch.worktreePath);
        return {
          pullRequest,
          branch: localPullRequestBranch,
          worktreePath: existingBranchBeforeFetch.worktreePath,
        };
      }
      if (existingBranchBeforeFetchPath === rootWorktreePath) {
        return yield* gitManagerError(
          "preparePullRequestThread",
          "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
        );
      }

      yield* materializePullRequestHeadBranch(
        input.cwd,
        pullRequestWithRemoteInfo,
        localPullRequestBranch,
      );

      const existingBranchAfterFetch = yield* findLocalHeadBranch(input.cwd);
      const existingBranchAfterFetchPath = existingBranchAfterFetch?.worktreePath
        ? canonicalizeExistingPath(existingBranchAfterFetch.worktreePath)
        : null;
      if (
        existingBranchAfterFetch?.worktreePath &&
        existingBranchAfterFetchPath !== rootWorktreePath
      ) {
        yield* ensureExistingWorktreeUpstream(existingBranchAfterFetch.worktreePath);
        return {
          pullRequest,
          branch: localPullRequestBranch,
          worktreePath: existingBranchAfterFetch.worktreePath,
        };
      }
      if (existingBranchAfterFetchPath === rootWorktreePath) {
        return yield* gitManagerError(
          "preparePullRequestThread",
          "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
        );
      }

      const worktree = yield* gitCore.createWorktree({
        cwd: input.cwd,
        branch: localPullRequestBranch,
        path: null,
      });
      yield* ensureExistingWorktreeUpstream(worktree.worktree.path);
      yield* maybeRunSetupScript(worktree.worktree.path);

      return {
        pullRequest,
        branch: worktree.worktree.branch,
        worktreePath: worktree.worktree.path,
      };
    }).pipe(Effect.ensuring(invalidateStatus(input.cwd)));
  });

  const previewWorktreePatch: GitManagerShape["previewWorktreePatch"] = Effect.fn(
    "previewWorktreePatch",
  )(function* (input) {
    const context = yield* resolveTeamTaskPatchContext({
      parentThreadId: input.parentThreadId,
      taskId: input.taskId,
      requireFinalTask: false,
    });
    if (context.patch.trim().length === 0) {
      return {
        status: "skipped_no_changes" as const,
        files: [],
        patch: "",
        patchHash: context.patchHash,
        includesCommittedChanges: false,
      } satisfies GitPreviewWorktreePatchResult;
    }
    return {
      status: "has_changes" as const,
      files: context.files,
      patch: context.patch,
      patchHash: context.patchHash,
      includesCommittedChanges: context.includesCommittedChanges,
    } satisfies GitPreviewWorktreePatchResult;
  });

  const applyWorktreePatch: GitManagerShape["applyWorktreePatch"] = Effect.fn("applyWorktreePatch")(
    function* (input) {
      const context = yield* resolveTeamTaskPatchContext({
        parentThreadId: input.parentThreadId,
        taskId: input.taskId,
        requireFinalTask: true,
      });

      if (context.patch.trim().length === 0) {
        return {
          status: "skipped_no_changes" as const,
          files: [],
        };
      }

      if (input.expectedPatchHash && input.expectedPatchHash !== context.patchHash) {
        return yield* gitManagerError(
          "GitManager.applyWorktreePatch",
          "The child changes changed after review. Review the latest diff and try again.",
        );
      }

      const parentStatus = yield* gitCore.execute({
        operation: "GitManager.applyWorktreePatch.parentStatus",
        cwd: context.parentCwd,
        args: ["status", "--porcelain"],
        maxOutputBytes: 2 * 1024 * 1024,
        truncateOutputAtMaxBytes: false,
      });
      if (context.seedMetadata) {
        const parentSnapshotTree = yield* gitCore.createWorktreeSnapshotTree(context.parentCwd);
        if (parentSnapshotTree !== context.seedMetadata.seedTreeSha) {
          return yield* gitManagerError(
            "GitManager.applyWorktreePatch",
            "The coordinator worktree changed since this child agent was spawned. Review the latest diff before applying child agent changes.",
          );
        }
      } else if (parentStatus.stdout.trim().length > 0) {
        return yield* gitManagerError(
          "GitManager.applyWorktreePatch",
          "The coordinator worktree has local changes. Commit, stash, or discard them before applying child agent changes.",
        );
      }

      yield* gitCore.execute({
        operation: "GitManager.applyWorktreePatch.check",
        cwd: context.parentCwd,
        args: ["apply", "--check", "--whitespace=nowarn", "-"],
        stdin: context.patch,
        maxOutputBytes: WORKTREE_PATCH_MAX_OUTPUT_BYTES,
        truncateOutputAtMaxBytes: false,
      });
      yield* gitCore.execute({
        operation: "GitManager.applyWorktreePatch.apply",
        cwd: context.parentCwd,
        args: ["apply", "--whitespace=nowarn", "-"],
        stdin: context.patch,
        maxOutputBytes: WORKTREE_PATCH_MAX_OUTPUT_BYTES,
        truncateOutputAtMaxBytes: false,
      });

      yield* invalidateStatus(context.parentCwd);

      return {
        status: "applied" as const,
        files: context.files,
      };
    },
  );

  const runFeatureBranchStep = Effect.fn("runFeatureBranchStep")(function* (
    modelSelection: ModelSelection,
    cwd: string,
    branch: string | null,
    commitMessage?: string,
    filePaths?: readonly string[],
  ) {
    const suggestion = yield* resolveCommitAndBranchSuggestion({
      cwd,
      branch,
      ...(commitMessage ? { commitMessage } : {}),
      ...(filePaths ? { filePaths } : {}),
      includeBranch: true,
      modelSelection,
    });
    if (!suggestion) {
      return yield* gitManagerError(
        "runFeatureBranchStep",
        "Cannot create a feature branch because there are no changes to commit.",
      );
    }

    const preferredBranch = suggestion.branch ?? sanitizeFeatureBranchName(suggestion.subject);
    const existingBranchNames = yield* gitCore.listLocalBranchNames(cwd);
    const resolvedBranch = resolveAutoFeatureBranchName(existingBranchNames, preferredBranch);

    yield* gitCore.createBranch({ cwd, branch: resolvedBranch });
    yield* Effect.scoped(gitCore.checkoutBranch({ cwd, branch: resolvedBranch }));

    return {
      branchStep: { status: "created" as const, name: resolvedBranch },
      resolvedCommitMessage: suggestion.commitMessage,
      resolvedCommitSuggestion: suggestion,
    };
  });

  const runStackedAction: GitManagerShape["runStackedAction"] = Effect.fn("runStackedAction")(
    function* (input, options) {
      const progress = createProgressEmitter(input, options);
      const currentPhase = yield* Ref.make<Option.Option<GitActionProgressPhase>>(Option.none());

      const runAction = Effect.fn("runStackedAction.runAction")(function* (): Effect.fn.Return<
        GitRunStackedActionResult,
        GitManagerServiceError
      > {
        const initialStatus = yield* gitCore.statusDetails(input.cwd);
        const wantsCommit = isCommitAction(input.action);
        const wantsPush =
          input.action === "push" ||
          input.action === "commit_push" ||
          input.action === "commit_push_pr" ||
          (input.action === "create_pr" &&
            (!initialStatus.hasUpstream || initialStatus.aheadCount > 0));
        const wantsPr = input.action === "create_pr" || input.action === "commit_push_pr";

        if (input.featureBranch && !wantsCommit) {
          return yield* gitManagerError(
            "runStackedAction",
            "Feature-branch checkout is only supported for commit actions.",
          );
        }
        if (input.action === "push" && initialStatus.hasWorkingTreeChanges) {
          return yield* gitManagerError(
            "runStackedAction",
            "Commit or stash local changes before pushing.",
          );
        }
        if (input.action === "create_pr" && initialStatus.hasWorkingTreeChanges) {
          return yield* gitManagerError(
            "runStackedAction",
            "Commit local changes before creating a PR.",
          );
        }

        const phases: GitActionProgressPhase[] = [
          ...(input.featureBranch ? (["branch"] as const) : []),
          ...(wantsCommit ? (["commit"] as const) : []),
          ...(wantsPush ? (["push"] as const) : []),
          ...(wantsPr ? (["pr"] as const) : []),
        ];

        yield* progress.emit({
          kind: "action_started",
          phases,
        });

        if (!input.featureBranch && wantsPush && !initialStatus.branch) {
          return yield* gitManagerError("runStackedAction", "Cannot push from detached HEAD.");
        }
        if (!input.featureBranch && wantsPr && !initialStatus.branch) {
          return yield* gitManagerError(
            "runStackedAction",
            "Cannot create a pull request from detached HEAD.",
          );
        }

        let branchStep: { status: "created" | "skipped_not_requested"; name?: string };
        let commitMessageForStep = input.commitMessage;
        let preResolvedCommitSuggestion: CommitAndBranchSuggestion | undefined = undefined;

        const modelSelection = yield* serverSettingsService.getSettings.pipe(
          Effect.map((settings) => settings.textGenerationModelSelection),
          Effect.mapError((cause) =>
            gitManagerError("runStackedAction", "Failed to get server settings.", cause),
          ),
        );

        if (input.featureBranch) {
          yield* Ref.set(currentPhase, Option.some("branch"));
          yield* progress.emit({
            kind: "phase_started",
            phase: "branch",
            label: "Preparing feature branch...",
          });
          const result = yield* runFeatureBranchStep(
            modelSelection,
            input.cwd,
            initialStatus.branch,
            input.commitMessage,
            input.filePaths,
          );
          branchStep = result.branchStep;
          commitMessageForStep = result.resolvedCommitMessage;
          preResolvedCommitSuggestion = result.resolvedCommitSuggestion;
        } else {
          branchStep = { status: "skipped_not_requested" as const };
        }

        const currentBranch = branchStep.name ?? initialStatus.branch;
        const commitAction = isCommitAction(input.action) ? input.action : null;

        const commit = commitAction
          ? yield* Ref.set(currentPhase, Option.some("commit")).pipe(
              Effect.flatMap(() =>
                runCommitStep(
                  modelSelection,
                  input.cwd,
                  commitAction,
                  currentBranch,
                  commitMessageForStep,
                  preResolvedCommitSuggestion,
                  input.filePaths,
                  options?.progressReporter,
                  progress.actionId,
                ),
              ),
            )
          : { status: "skipped_not_requested" as const };

        const push = wantsPush
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "push",
                label: "Pushing...",
              })
              .pipe(
                Effect.tap(() => Ref.set(currentPhase, Option.some("push"))),
                Effect.flatMap(() => gitCore.pushCurrentBranch(input.cwd, currentBranch)),
              )
          : { status: "skipped_not_requested" as const };

        const pr = wantsPr
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "pr",
                label: "Preparing PR...",
              })
              .pipe(
                Effect.tap(() => Ref.set(currentPhase, Option.some("pr"))),
                Effect.flatMap(() =>
                  runPrStep(modelSelection, input.cwd, currentBranch, progress.emit),
                ),
              )
          : { status: "skipped_not_requested" as const };

        const toast = yield* buildCompletionToast(input.cwd, {
          action: input.action,
          branch: branchStep,
          commit,
          push,
          pr,
        });

        const result = {
          action: input.action,
          branch: branchStep,
          commit,
          push,
          pr,
          toast,
        };
        yield* progress.emit({
          kind: "action_finished",
          result,
        });
        return result;
      });

      return yield* runAction().pipe(
        Effect.ensuring(invalidateStatus(input.cwd)),
        Effect.tapError((error) =>
          Effect.flatMap(Ref.get(currentPhase), (phase) =>
            progress.emit({
              kind: "action_failed",
              phase: Option.getOrNull(phase),
              message: error.message,
            }),
          ),
        ),
      );
    },
  );

  return {
    localStatus,
    remoteStatus,
    status,
    invalidateLocalStatus,
    invalidateRemoteStatus,
    invalidateStatus,
    resolvePullRequest,
    getPullRequestRemoteOptions,
    setPullRequestRemote,
    preparePullRequestThread,
    previewWorktreePatch,
    applyWorktreePatch,
    runStackedAction,
  } satisfies GitManagerShape;
});

export const GitManagerLive = Layer.effect(GitManager, makeGitManager());
