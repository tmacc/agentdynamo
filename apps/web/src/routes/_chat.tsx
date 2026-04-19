import { Outlet, createFileRoute, redirect, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { clearBoardRouteSearchParams } from "../boardRouteSearch";
import { useBoardUiStore } from "../boardUiStore";

import { BoardView } from "../components/board/BoardView";
import { ProjectIntelligenceRouteSheet } from "../components/project-intelligence/ProjectIntelligenceRouteSheet";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  startNewLocalThreadFromContext,
  startNewThreadFromContext,
  startSeededThreadForCard,
} from "../lib/chatThreadActions";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { parseBoardRouteSearch } from "../boardRouteSearch";
import { parseProjectIntelligenceRouteSearch } from "../projectIntelligenceRouteSearch";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveSidebarNewThreadEnvMode } from "~/components/Sidebar.logic";
import { useSettings } from "~/hooks/useSettings";
import { useServerKeybindings } from "~/rpc/serverState";
import type { EnvironmentId, FeatureCard, ProjectId } from "@t3tools/contracts";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const appSettings = useSettings();
  const navigate = useNavigate();

  // Resolve the (environment, project) pair we'd target if the user hits
  // a board keybinding while no board-specific search params are set.
  const boardTarget = useMemo<{ environmentId: EnvironmentId; projectId: ProjectId } | null>(() => {
    if (activeThread) {
      return { environmentId: activeThread.environmentId, projectId: activeThread.projectId };
    }
    if (activeDraftThread) {
      return {
        environmentId: activeDraftThread.environmentId,
        projectId: activeDraftThread.projectId,
      };
    }
    if (defaultProjectRef) {
      return {
        environmentId: defaultProjectRef.environmentId,
        projectId: defaultProjectRef.projectId,
      };
    }
    return null;
  }, [activeThread, activeDraftThread, defaultProjectRef]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      if (useCommandPaletteStore.getState().open) {
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void startNewLocalThreadFromContext({
          activeDraftThread,
          activeThread,
          defaultProjectRef,
          defaultThreadEnvMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: appSettings.defaultThreadEnvMode,
          }),
          handleNewThread,
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread,
          defaultProjectRef,
          defaultThreadEnvMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: appSettings.defaultThreadEnvMode,
          }),
          handleNewThread,
        });
        return;
      }

      if (
        command === "board.open" ||
        command === "board.addIdea" ||
        command === "board.addPlanned"
      ) {
        if (!boardTarget) return;
        event.preventDefault();
        event.stopPropagation();
        if (command === "board.addIdea") {
          useBoardUiStore
            .getState()
            .requestAddCard(boardTarget.environmentId, boardTarget.projectId, "ideas");
        } else if (command === "board.addPlanned") {
          useBoardUiStore
            .getState()
            .requestAddCard(boardTarget.environmentId, boardTarget.projectId, "planned");
        }
        void navigate({
          to: ".",
          search: (prev) => ({
            ...(prev as Record<string, unknown>),
            view: "board",
            boardEnvironmentId: boardTarget.environmentId,
            boardProjectId: boardTarget.projectId,
          }),
        }).catch(() => undefined);
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    selectedThreadKeysSize,
    terminalOpen,
    appSettings.defaultThreadEnvMode,
    boardTarget,
    navigate,
  ]);

  return null;
}

function ChatRouteLayout() {
  const search = useSearch({ from: "/_chat" });
  const boardActive = search.view === "board";

  return (
    <>
      <ChatRouteGlobalShortcuts />
      {boardActive ? <BoardRouteView /> : <Outlet />}
      <ProjectIntelligenceRouteSheet />
    </>
  );
}

/**
 * Resolves the (environment, project) pair for the board from either the
 * `boardEnvironmentId` + `boardProjectId` search params, or — when those are
 * absent — the active thread / default project ref. Renders a placeholder
 * when no project can be resolved.
 */
function BoardRouteView() {
  const search = useSearch({ from: "/_chat" });
  const navigate = useNavigate();
  const { activeDraftThread, activeThread, createFreshDraftThread, defaultProjectRef } =
    useHandleNewThread();
  const appSettings = useSettings();

  const resolved = useMemo<{ environmentId: EnvironmentId; projectId: ProjectId } | null>(() => {
    if (search.boardEnvironmentId && search.boardProjectId) {
      return {
        environmentId: search.boardEnvironmentId,
        projectId: search.boardProjectId,
      };
    }
    if (activeThread) {
      return {
        environmentId: activeThread.environmentId,
        projectId: activeThread.projectId,
      };
    }
    if (activeDraftThread) {
      return {
        environmentId: activeDraftThread.environmentId,
        projectId: activeDraftThread.projectId,
      };
    }
    if (defaultProjectRef) {
      return {
        environmentId: defaultProjectRef.environmentId,
        projectId: defaultProjectRef.projectId,
      };
    }
    return null;
  }, [
    search.boardEnvironmentId,
    search.boardProjectId,
    activeThread,
    activeDraftThread,
    defaultProjectRef,
  ]);

  const { handleNewThread } = useHandleNewThread();

  const handleCloseBoard = useCallback(() => {
    void navigate({
      to: ".",
      search: (previous) => clearBoardRouteSearchParams(previous as Record<string, unknown>),
    }).catch(() => undefined);
  }, [navigate]);

  const closeBoardLabel = activeThread
    ? "Back to thread"
    : activeDraftThread
      ? "Back to draft"
      : "Close board";

  const handleStartAgent = useCallback(
    (card: FeatureCard) => {
      if (!resolved) return;
      void startSeededThreadForCard({
        card,
        context: {
          activeDraftThread,
          activeThread,
          createFreshDraftThread,
          defaultProjectRef,
          defaultThreadEnvMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: appSettings.defaultThreadEnvMode,
          }),
          handleNewThread,
        },
        environmentId: resolved.environmentId,
      });
    },
    [
      activeDraftThread,
      activeThread,
      createFreshDraftThread,
      appSettings.defaultThreadEnvMode,
      defaultProjectRef,
      handleNewThread,
      resolved,
    ],
  );

  if (!resolved) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Select a project to view its board.
      </div>
    );
  }

  return (
    <BoardView
      environmentId={resolved.environmentId}
      projectId={resolved.projectId}
      onStartAgent={handleStartAgent}
      onCloseBoard={handleCloseBoard}
      closeBoardLabel={closeBoardLabel}
    />
  );
}

export const Route = createFileRoute("/_chat")({
  validateSearch: (search) => ({
    ...parseProjectIntelligenceRouteSearch(search),
    ...parseBoardRouteSearch(search),
  }),
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
