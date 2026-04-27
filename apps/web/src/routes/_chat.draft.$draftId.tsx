import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { type BoardRouteSearch, parseBoardRouteSearch } from "../boardRouteSearch";
import {
  type FileBrowserRouteSearch,
  parseFileBrowserRouteSearch,
  stripFileBrowserRouteSearchParams,
} from "../fileBrowserRouteSearch";
import {
  type ProjectIntelligenceRouteSearch,
  parseProjectIntelligenceRouteSearch,
} from "../projectIntelligenceRouteSearch";
import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { createThreadSelectorAcrossEnvironments } from "../storeSelectors";
import { selectEnvironmentState, useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { ProjectFilesPanel } from "../components/project-files/ProjectFilesPanel";
import { useTheme } from "../hooks/useTheme";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { resolvedTheme } = useTheme();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const draftProject = useStore((store) =>
    draftSession
      ? selectEnvironmentState(store, draftSession.environmentId).projectById[
          draftSession.projectId
        ]
      : undefined,
  );
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted
          ? draftSession.promotedTo
          : null
        : serverThread
          ? {
              environmentId: serverThread.environmentId,
              threadId: serverThread.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted],
  );

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  if (canonicalThreadRef) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
    return null;
  }
  const filesOpen = search.files === "1";
  const filesWorkspaceRoot = draftSession.worktreePath ?? draftProject?.cwd ?? null;
  const closeFiles = () => {
    void navigate({
      to: ".",
      search: (previous) => stripFileBrowserRouteSearchParams(previous as Record<string, unknown>),
    });
  };
  const toggleFiles = () => {
    void navigate({
      to: ".",
      search: (previous) =>
        filesOpen
          ? stripFileBrowserRouteSearchParams(previous as Record<string, unknown>)
          : { ...(previous as Record<string, unknown>), files: "1" },
    });
  };
  const selectFilePath = (relativePath: string | null) => {
    void navigate({
      to: ".",
      search: (previous) => {
        const base = { ...(previous as Record<string, unknown>), files: "1" as const };
        if (relativePath) {
          return { ...base, filePath: relativePath };
        }
        const { filePath: _filePath, ...rest } = previous as Record<string, unknown>;
        void _filePath;
        return { ...rest, files: "1" as const };
      },
    });
  };

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          draftId={draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          filesOpen={filesOpen}
          onToggleFiles={toggleFiles}
          routeKind="draft"
        />
      </SidebarInset>
      <RightPanelSheet open={filesOpen && Boolean(filesWorkspaceRoot)} onClose={closeFiles}>
        {filesWorkspaceRoot ? (
          <ProjectFilesPanel
            environmentId={draftSession.environmentId}
            workspaceRoot={filesWorkspaceRoot}
            projectName={draftProject?.name}
            selectedPath={search.filePath ?? null}
            resolvedTheme={resolvedTheme}
            onSelectPath={selectFilePath}
            onClose={closeFiles}
          />
        ) : null}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  validateSearch: (search) => ({
    ...parseBoardRouteSearch(search),
    ...parseFileBrowserRouteSearch(search),
    ...parseProjectIntelligenceRouteSearch(search),
  }),
  search: {
    middlewares: [
      retainSearchParams<
        BoardRouteSearch & ProjectIntelligenceRouteSearch & FileBrowserRouteSearch
      >([
        "view",
        "files",
        "filePath",
        "boardEnvironmentId",
        "boardProjectId",
        "intel",
        "intelEnvironmentId",
        "intelProjectCwd",
        "intelEffectiveCwd",
        "intelSection",
        "intelSurfaceId",
      ]),
    ],
  },
  component: DraftChatThreadRouteView,
});
