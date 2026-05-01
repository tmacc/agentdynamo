import { scopeProjectRef } from "@t3tools/client-runtime";
import type {
  EnvironmentId,
  FeatureCard,
  ProjectId,
  ProviderInteractionMode,
  ScopedProjectRef,
} from "@t3tools/contracts";
import {
  type DraftId,
  type DraftThreadEnvMode,
  useComposerDraftStore,
} from "../composerDraftStore";
import { linkBoardCardThread } from "../boardStore";
import { DEFAULT_NEW_WORKTREE_BASE_BRANCH } from "../components/BranchToolbar.logic";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftThreadContextLike extends ThreadContextLike {
  envMode: DraftThreadEnvMode;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      interactionMode?: ProviderInteractionMode;
    },
  ): Promise<void>;
}

type NewThreadOptions = NonNullable<Parameters<NewThreadHandler>[1]>;
type FreshDraftThreadHandler = (
  projectRef: ScopedProjectRef,
  options?: NewThreadOptions,
) => Promise<DraftId>;

export interface ChatThreadActionContext {
  readonly activeDraftThread: DraftThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly createFreshDraftThread?: FreshDraftThreadHandler;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly defaultThreadEnvMode: DraftThreadEnvMode;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

function isSameProjectContext(
  contextRef:
    | Pick<ThreadContextLike, "environmentId" | "projectId">
    | Pick<DraftThreadContextLike, "environmentId" | "projectId">
    | null
    | undefined,
  projectRef: ScopedProjectRef,
): boolean {
  return (
    !!contextRef &&
    contextRef.environmentId === projectRef.environmentId &&
    contextRef.projectId === projectRef.projectId
  );
}

export function buildContextualThreadOptionsForProject(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): NewThreadOptions {
  if (isSameProjectContext(context.activeThread, projectRef)) {
    return {
      branch: context.activeThread?.branch ?? null,
      worktreePath: context.activeThread?.worktreePath ?? null,
      envMode: context.activeThread?.worktreePath ? "worktree" : "local",
    };
  }
  if (isSameProjectContext(context.activeDraftThread, projectRef)) {
    return {
      branch: context.activeDraftThread?.branch ?? null,
      worktreePath: context.activeDraftThread?.worktreePath ?? null,
      envMode: context.activeDraftThread?.envMode ?? "local",
    };
  }
  return buildDefaultThreadOptions(context);
}

function buildDefaultThreadOptions(context: ChatThreadActionContext): NewThreadOptions {
  return {
    envMode: context.defaultThreadEnvMode,
  };
}

export async function startNewThreadInProjectFromContext(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): Promise<void> {
  await context.handleNewThread(
    projectRef,
    buildContextualThreadOptionsForProject(context, projectRef),
  );
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await startNewThreadInProjectFromContext(context, projectRef);
  return true;
}

export async function startNewLocalThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef, buildDefaultThreadOptions(context));
  return true;
}

export function resolveSeededPromptForCard(card: FeatureCard): string {
  const seededPrompt = (card.seededPrompt ?? "").trim();
  if (seededPrompt.length > 0) {
    return seededPrompt;
  }
  const description = (card.description ?? "").trim();
  if (description.length > 0) {
    return `${card.title}\n\n${description}`;
  }
  return card.title;
}

export async function startSeededThreadForCard(args: {
  card: FeatureCard;
  context: ChatThreadActionContext;
  environmentId: EnvironmentId;
}): Promise<void> {
  const { card, context, environmentId } = args;
  const projectRef = scopeProjectRef(environmentId, card.projectId);
  const createFreshDraftThread = context.createFreshDraftThread;
  if (!createFreshDraftThread) {
    throw new Error("Fresh draft thread creation is not available in this context.");
  }

  const draftId = await createFreshDraftThread(projectRef, {
    envMode: "worktree",
    branch: DEFAULT_NEW_WORKTREE_BASE_BRANCH,
    worktreePath: null,
    interactionMode: "plan",
  });

  const draftStore = useComposerDraftStore.getState();
  if (!draftStore.getDraftSession(draftId)) {
    return;
  }

  draftStore.setPrompt(draftId, resolveSeededPromptForCard(card));

  let settled = false;
  const unsubscribe = useComposerDraftStore.subscribe((state) => {
    if (settled) {
      return;
    }
    const session = state.getDraftSession(draftId);
    const promoted = session?.promotedTo;
    if (!promoted) {
      return;
    }
    settled = true;
    unsubscribe();
    void linkBoardCardThread({
      environmentId,
      projectId: card.projectId,
      cardId: card.id,
      threadId: promoted.threadId,
    }).catch(() => undefined);
  });

  setTimeout(
    () => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
    },
    10 * 60 * 1000,
  );
}
