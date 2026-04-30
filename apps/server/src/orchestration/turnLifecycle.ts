export function isRuntimeActiveStatus(status: string | null | undefined): boolean {
  return status === "starting" || status === "running" || status === "recovering";
}

export function turnOrderingTime(
  turn: {
    readonly requestedAt: string | null | undefined;
    readonly startedAt: string | null | undefined;
  } | null,
): string | null {
  return turn?.startedAt ?? turn?.requestedAt ?? null;
}

export function isStrictlyNewerTurn(
  candidate: { readonly requestedAt: string | null; readonly startedAt: string | null } | null,
  currentLatest: { readonly requestedAt: string | null; readonly startedAt: string | null } | null,
): boolean {
  const candidateTime = turnOrderingTime(candidate);
  const latestTime = turnOrderingTime(currentLatest);
  return candidateTime !== null && latestTime !== null && candidateTime > latestTime;
}

export function shouldPromoteCompletedTurn(input: {
  readonly currentLatestTurnId: string | null;
  readonly candidateTurnId: string;
  readonly activeTurnId: string | null;
  readonly activeSessionStatus: string | null;
  readonly candidateExists: boolean;
  readonly candidateTiming: {
    readonly requestedAt: string | null;
    readonly startedAt: string | null;
  } | null;
  readonly currentLatestTiming: {
    readonly requestedAt: string | null;
    readonly startedAt: string | null;
  } | null;
}): boolean {
  if (input.currentLatestTurnId === null && input.candidateExists) {
    return true;
  }
  if (input.currentLatestTurnId === input.candidateTurnId && input.candidateExists) {
    return true;
  }
  if (
    input.activeTurnId === input.candidateTurnId &&
    isRuntimeActiveStatus(input.activeSessionStatus)
  ) {
    return true;
  }
  if (input.candidateExists) {
    return isStrictlyNewerTurn(input.candidateTiming, input.currentLatestTiming);
  }
  return false;
}

export function isFinalProjectionTurnState(
  state: "pending" | "running" | "completed" | "interrupted" | "error",
): boolean {
  return state === "completed" || state === "interrupted" || state === "error";
}
