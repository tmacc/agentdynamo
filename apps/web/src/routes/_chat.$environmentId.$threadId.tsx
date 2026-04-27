import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { type BoardRouteSearch, parseBoardRouteSearch } from "../boardRouteSearch";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import {
  type FileBrowserRouteSearch,
  parseFileBrowserRouteSearch,
  stripFileBrowserRouteSearchParams,
} from "../fileBrowserRouteSearch";
import {
  type ProjectIntelligenceRouteSearch,
  parseProjectIntelligenceRouteSearch,
} from "../projectIntelligenceRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useTheme } from "../hooks/useTheme";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { ProjectFilesPanel } from "../components/project-files/ProjectFilesPanel";
import type { EnvironmentId } from "@t3tools/contracts";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const FILES_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_files_sidebar_width";
const FILES_INLINE_DEFAULT_WIDTH = "clamp(30rem,46vw,48rem)";
const FILES_INLINE_SIDEBAR_MIN_WIDTH = 28 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const ProjectFilesInlineSidebar = (props: {
  filesOpen: boolean;
  onCloseFiles: () => void;
  onOpenFiles: () => void;
  environmentId: EnvironmentId;
  workspaceRoot: string;
  projectName: string | undefined;
  selectedPath: string | null;
  resolvedTheme: "light" | "dark";
  onSelectPath: (relativePath: string | null) => void;
}) => {
  const { onCloseFiles, onOpenFiles } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenFiles();
        return;
      }
      onCloseFiles();
    },
    [onCloseFiles, onOpenFiles],
  );
  return (
    <SidebarProvider
      defaultOpen={false}
      open={props.filesOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": FILES_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-background text-foreground"
        resizable={{
          minWidth: FILES_INLINE_SIDEBAR_MIN_WIDTH,
          storageKey: FILES_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <ProjectFilesPanel
          environmentId={props.environmentId}
          workspaceRoot={props.workspaceRoot}
          projectName={props.projectName}
          selectedPath={props.selectedPath}
          resolvedTheme={props.resolvedTheme}
          onSelectPath={props.onSelectPath}
          onClose={props.onCloseFiles}
        />
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const { resolvedTheme } = useTheme();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const project = useStore((store) =>
    serverThread
      ? selectEnvironmentState(store, serverThread.environmentId).projectById[
          serverThread.projectId
        ]
      : undefined,
  );
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const diffOpen = search.diff === "1";
  const filesOpen = search.files === "1";
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
  }));
  const hasOpenedDiff =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedDiff
      : diffOpen;
  const markDiffOpened = useCallback(() => {
    setDiffPanelMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedDiff) {
        return previous;
      }
      return {
        threadKey: currentThreadKey,
        hasOpenedDiff: true,
      };
    });
  }, [currentThreadKey]);
  const closeDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: { diff: undefined },
    });
  }, [navigate, threadRef]);
  const openDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    markDiffOpened();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripFileBrowserRouteSearchParams(stripDiffSearchParams(previous));
        return { ...rest, diff: "1" };
      },
    });
  }, [markDiffOpened, navigate, threadRef]);
  const closeFiles = useCallback(() => {
    if (!threadRef) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => stripFileBrowserRouteSearchParams(previous as Record<string, unknown>),
    });
  }, [navigate, threadRef]);
  const openFiles = useCallback(() => {
    if (!threadRef) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous as Record<string, unknown>);
        return { ...rest, files: "1" };
      },
    });
  }, [navigate, threadRef]);
  const toggleFiles = useCallback(() => {
    if (filesOpen) {
      closeFiles();
      return;
    }
    openFiles();
  }, [closeFiles, filesOpen, openFiles]);
  const selectFilePath = useCallback(
    (relativePath: string | null) => {
      if (!threadRef) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
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
    },
    [navigate, threadRef],
  );

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const filesWorkspaceRoot = serverThread?.worktreePath ?? project?.cwd ?? null;
  const selectedFilePath = typeof search.filePath === "string" ? search.filePath : null;

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-dvh  min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onDiffPanelOpen={markDiffOpened}
            filesOpen={filesOpen}
            onToggleFiles={toggleFiles}
            reserveTitleBarControlInset={!diffOpen}
            routeKind="server"
          />
        </SidebarInset>
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
        {filesWorkspaceRoot ? (
          <ProjectFilesInlineSidebar
            filesOpen={filesOpen}
            onCloseFiles={closeFiles}
            onOpenFiles={openFiles}
            environmentId={threadRef.environmentId}
            workspaceRoot={filesWorkspaceRoot}
            projectName={project?.name}
            selectedPath={selectedFilePath}
            resolvedTheme={resolvedTheme}
            onSelectPath={selectFilePath}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={markDiffOpened}
          filesOpen={filesOpen}
          onToggleFiles={toggleFiles}
          routeKind="server"
        />
      </SidebarInset>
      <RightPanelSheet open={diffOpen} onClose={closeDiff}>
        {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
      </RightPanelSheet>
      <RightPanelSheet open={filesOpen && Boolean(filesWorkspaceRoot)} onClose={closeFiles}>
        {filesWorkspaceRoot ? (
          <ProjectFilesPanel
            environmentId={threadRef.environmentId}
            workspaceRoot={filesWorkspaceRoot}
            projectName={project?.name}
            selectedPath={selectedFilePath}
            resolvedTheme={resolvedTheme}
            onSelectPath={selectFilePath}
            onClose={closeFiles}
          />
        ) : null}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => ({
    ...parseDiffRouteSearch(search),
    ...parseBoardRouteSearch(search),
    ...parseFileBrowserRouteSearch(search),
    ...parseProjectIntelligenceRouteSearch(search),
  }),
  search: {
    middlewares: [
      retainSearchParams<
        DiffRouteSearch & BoardRouteSearch & ProjectIntelligenceRouteSearch & FileBrowserRouteSearch
      >([
        "diff",
        "files",
        "filePath",
        "view",
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
  component: ChatThreadRouteView,
});
