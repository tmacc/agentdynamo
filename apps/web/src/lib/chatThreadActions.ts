import { scopeProjectRef } from "@t3tools/client-runtime";
import type { EnvironmentId, FeatureCard, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import { linkBoardCardThread } from "../boardStore";
import {
  useComposerDraftStore,
  type DraftId,
  type DraftThreadEnvMode,
} from "../composerDraftStore";

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

/**
 * Resolves the prompt we'll seed into a new draft when the user clicks
 * "Start Agent" on a Planned board card. Prefers explicit seededPrompt; otherwise
 * falls back to "title\n\ndescription", or just the title when there's no
 * description.
 */
export function resolveSeededPromptForCard(card: FeatureCard): string {
  const seeded = (card.seededPrompt ?? "").trim();
  if (seeded.length > 0) return seeded;
  const description = (card.description ?? "").trim();
  if (description.length > 0) return `${card.title}\n\n${description}`;
  return card.title;
}

/**
 * Drive the "Start Agent" flow for a board card:
 *   1. Create a new draft thread in the card's project (reusing the current
 *      branch/worktree context).
 *   2. Seed the draft's composer with the fallback-resolved prompt.
 *   3. Subscribe to the composer draft store; when the draft is promoted to
 *      a real server thread, link the card to that thread.
 *
 * The subscriber auto-unsubscribes after the first promotion (or after a
 * ten-minute timeout, in case the user never sends the first message).
 */
export async function startSeededThreadForCard(args: {
  card: FeatureCard;
  context: ChatThreadActionContext;
  environmentId: EnvironmentId;
}): Promise<void> {
  const { card, context, environmentId } = args;
  const projectRef = scopeProjectRef(environmentId, card.projectId);
  const prompt = resolveSeededPromptForCard(card);
  const createFreshDraftThread = context.createFreshDraftThread;
  if (!createFreshDraftThread) {
    throw new Error("Fresh draft thread creation is not available in this context.");
  }

  // Step 1: create a fresh draft for this card's project.
  const draftId = await createFreshDraftThread(
    projectRef,
    buildContextualThreadOptionsForProject(context, projectRef),
  );

  // Step 2: seed the composer prompt.
  const draftStore = useComposerDraftStore.getState();
  if (!draftStore.getDraftSession(draftId)) return;

  draftStore.setPrompt(draftId, prompt);

  // Step 3: subscribe for promotion → fire linkThread once.
  let settled = false;
  const unsubscribe = useComposerDraftStore.subscribe((state) => {
    if (settled) return;
    const session = state.getDraftSession(draftId);
    const promoted = session?.promotedTo;
    if (!promoted) return;
    settled = true;
    try {
      unsubscribe();
    } catch {
      // ignore
    }
    void linkBoardCardThread({
      environmentId,
      projectId: card.projectId,
      cardId: card.id,
      threadId: promoted.threadId,
    }).catch(() => undefined);
  });

  // Safety: if the draft is never promoted, bail out after 10 minutes.
  setTimeout(
    () => {
      if (settled) return;
      settled = true;
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    },
    10 * 60 * 1000,
  );
}
