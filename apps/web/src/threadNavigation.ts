import type { SidebarThreadSummary, Thread, ThreadShell } from "./types";

type ThreadNavigationCandidate = Pick<
  SidebarThreadSummary | Thread | ThreadShell,
  "teamParentThreadId"
>;

export function isUserFacingTopLevelThread(thread: ThreadNavigationCandidate): boolean {
  return thread.teamParentThreadId == null;
}
