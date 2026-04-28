import { Outlet, createFileRoute, redirect, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import type { FeatureCard } from "@t3tools/contracts";

import { clearBoardRouteSearchParams, parseBoardRouteSearch } from "../boardRouteSearch";
import { stripFileBrowserRouteSearchParams } from "../fileBrowserRouteSearch";
import { parseFileBrowserRouteSearch } from "../fileBrowserRouteSearch";
import { parseProjectIntelligenceRouteSearch } from "../projectIntelligenceRouteSearch";
import { BoardView } from "../components/board/BoardView";
import { ProjectIntelligenceMount } from "../components/project-intelligence/ProjectIntelligenceMount";
import { SidebarInset } from "../components/ui/sidebar";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  startNewLocalThreadFromContext,
  startNewThreadFromContext,
  startSeededThreadForCard,
} from "../lib/chatThreadActions";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveSidebarNewThreadEnvMode } from "~/components/Sidebar.logic";
import { useSettings } from "~/hooks/useSettings";
import { useServerKeybindings } from "~/rpc/serverState";

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
      <ProjectIntelligenceMount />
    </>
  );
}

function BoardRouteView() {
  const search = useSearch({ from: "/_chat" });
  const navigate = useNavigate();
  const {
    activeDraftThread,
    activeThread,
    createFreshDraftThread,
    defaultProjectRef,
    handleNewThread,
  } = useHandleNewThread();
  const appSettings = useSettings();

  const resolved = useMemo(() => {
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
    return defaultProjectRef;
  }, [activeDraftThread, activeThread, defaultProjectRef, search]);

  const handleCloseBoard = useCallback(() => {
    void navigate({
      to: ".",
      search: (previous) =>
        stripFileBrowserRouteSearchParams(
          clearBoardRouteSearchParams(previous as Record<string, unknown>),
        ),
    }).catch(() => undefined);
  }, [navigate]);

  const handleStartAgent = useCallback(
    (card: FeatureCard) => {
      if (!resolved) {
        return;
      }
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
      }).catch(() => undefined);
    },
    [
      activeDraftThread,
      activeThread,
      appSettings.defaultThreadEnvMode,
      createFreshDraftThread,
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

  const closeBoardLabel = activeThread
    ? "Back to thread"
    : activeDraftThread
      ? "Back to draft"
      : "Close board";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <BoardView
        environmentId={resolved.environmentId}
        projectId={resolved.projectId}
        onStartAgent={handleStartAgent}
        onCloseBoard={handleCloseBoard}
        closeBoardLabel={closeBoardLabel}
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat")({
  validateSearch: (search) => ({
    ...parseBoardRouteSearch(search),
    ...parseFileBrowserRouteSearch(search),
    ...parseProjectIntelligenceRouteSearch(search),
  }),
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
