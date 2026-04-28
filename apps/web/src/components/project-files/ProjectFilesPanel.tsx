import type {
  EnvironmentId,
  ProjectFileEntry,
  ProjectFilePreviewKind,
  ProjectReadFileResult,
  ProjectWorkspaceTarget,
} from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  CodeIcon,
  ExternalLinkIcon,
  FileQuestionIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useState, type ReactNode } from "react";

import { openInPreferredEditor } from "../../editorPreferences";
import { ensureEnvironmentApi } from "../../environmentApi";
import { resolveEnvironmentHttpUrl } from "../../environments/runtime";
import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { stackedThreadToast, toastManager } from "../ui/toast";

export interface ProjectFilesPanelProps {
  environmentId: EnvironmentId;
  target: ProjectWorkspaceTarget;
  projectName: string | undefined;
  selectedPath: string | null;
  resolvedTheme: "light" | "dark";
  onSelectPath: (relativePath: string | null) => void;
  onClose: () => void;
}

const EMPTY_ENTRIES: readonly ProjectFileEntry[] = [];

function projectFileQueryKey(input: {
  environmentId: EnvironmentId;
  target: ProjectWorkspaceTarget;
  relativePath: string;
}) {
  return ["project-files", input.environmentId, input.target, input.relativePath] as const;
}

function projectFileMetadataQueryKey(input: {
  environmentId: EnvironmentId;
  target: ProjectWorkspaceTarget;
  relativePath: string | null;
}) {
  return ["project-file-metadata", input.environmentId, input.target, input.relativePath] as const;
}

function projectFilePreviewQueryKey(input: {
  environmentId: EnvironmentId;
  target: ProjectWorkspaceTarget;
  relativePath: string | null;
}) {
  return ["project-file-preview", input.environmentId, input.target, input.relativePath] as const;
}

function resolvePreviewUrl(environmentId: EnvironmentId, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const parsed = new URL(url, window.location.origin);
  return resolveEnvironmentHttpUrl({
    environmentId,
    pathname: parsed.pathname,
    searchParams: Object.fromEntries(parsed.searchParams),
  });
}

export const ProjectFilesPanel = memo(function ProjectFilesPanel(props: ProjectFilesPanelProps) {
  const [sourceMode, setSourceMode] = useState(false);
  const selectedPath = props.selectedPath;

  const openInEditor = useCallback(async (targetPath: string) => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open file",
          description: "Editor integration is unavailable in this environment.",
        }),
      );
      return;
    }
    try {
      await openInPreferredEditor(api, targetPath);
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    }
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {props.projectName ?? "Project files"}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {selectedPath || "."}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close project files"
          onClick={props.onClose}
        >
          <XIcon className="size-3.5" />
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(13rem,38%)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-auto border-r border-border p-2">
          <DirectoryTree
            environmentId={props.environmentId}
            target={props.target}
            relativePath=""
            depth={0}
            selectedPath={selectedPath}
            resolvedTheme={props.resolvedTheme}
            onSelectPath={(entry) => {
              setSourceMode(false);
              props.onSelectPath(entry.relativePath);
            }}
          />
        </div>
        <div className="min-h-0 overflow-hidden">
          <FilePreview
            environmentId={props.environmentId}
            target={props.target}
            relativePath={selectedPath}
            sourceMode={sourceMode}
            onSourceModeChange={setSourceMode}
            onOpenInEditor={openInEditor}
          />
        </div>
      </div>
    </div>
  );
});

function DirectoryTree(props: {
  environmentId: EnvironmentId;
  target: ProjectWorkspaceTarget;
  relativePath: string;
  depth: number;
  selectedPath: string | null;
  resolvedTheme: "light" | "dark";
  onSelectPath: (entry: ProjectFileEntry) => void;
}) {
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set([""]),
  );
  const query = useQuery({
    queryKey: projectFileQueryKey({
      environmentId: props.environmentId,
      target: props.target,
      relativePath: props.relativePath,
    }),
    queryFn: () =>
      ensureEnvironmentApi(props.environmentId).projects.listDirectory({
        target: props.target,
        relativePath: props.relativePath,
      }),
    staleTime: 15_000,
  });
  const entries = query.data?.entries ?? EMPTY_ENTRIES;

  const toggleDirectory = useCallback((relativePath: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  }, []);

  if (query.isPending) {
    return (
      <div className="space-y-2 p-1">
        <Skeleton className="h-4 w-11/12 rounded-full" />
        <Skeleton className="h-4 w-9/12 rounded-full" />
        <Skeleton className="h-4 w-10/12 rounded-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-2 p-2 text-xs text-destructive">
        <div>
          {query.error instanceof Error ? query.error.message : "Unable to load directory."}
        </div>
        <Button variant="outline" size="xs" onClick={() => void query.refetch()}>
          <RefreshCwIcon className="size-3" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {entries.map((entry) => {
        const expanded = expandedDirectories.has(entry.relativePath);
        const selected = props.selectedPath === entry.relativePath;
        const paddingLeft = 4 + props.depth * 14;
        if (entry.kind === "directory") {
          return (
            <div key={`dir:${entry.relativePath}`}>
              <button
                type="button"
                className={cn(
                  "group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs hover:bg-accent",
                  selected && "bg-accent text-accent-foreground",
                )}
                style={{ paddingLeft }}
                onClick={() => toggleDirectory(entry.relativePath)}
              >
                <ChevronRightIcon
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-90",
                  )}
                />
                {expanded ? (
                  <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate font-mono">{entry.name}</span>
              </button>
              {expanded ? (
                <div>
                  <DirectoryTree
                    environmentId={props.environmentId}
                    target={props.target}
                    relativePath={entry.relativePath}
                    depth={props.depth + 1}
                    selectedPath={props.selectedPath}
                    resolvedTheme={props.resolvedTheme}
                    onSelectPath={props.onSelectPath}
                  />
                </div>
              ) : null}
            </div>
          );
        }
        return (
          <button
            key={`file:${entry.relativePath}`}
            type="button"
            className={cn(
              "group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs hover:bg-accent",
              selected && "bg-accent text-accent-foreground",
            )}
            style={{ paddingLeft: paddingLeft + 18 }}
            onClick={() => props.onSelectPath(entry)}
          >
            <VscodeEntryIcon
              pathValue={entry.relativePath}
              kind="file"
              theme={props.resolvedTheme}
              className="size-3.5"
            />
            <span className="min-w-0 truncate font-mono">{entry.name}</span>
          </button>
        );
      })}
      {query.data?.truncated ? (
        <div className="px-2 py-1 text-[11px] text-muted-foreground">Directory truncated.</div>
      ) : null}
    </div>
  );
}

function FilePreview(props: {
  environmentId: EnvironmentId;
  target: ProjectWorkspaceTarget;
  relativePath: string | null;
  sourceMode: boolean;
  onSourceModeChange: (next: boolean) => void;
  onOpenInEditor: (path: string) => void;
}) {
  const metadataQuery = useQuery({
    queryKey: projectFileMetadataQueryKey({
      environmentId: props.environmentId,
      target: props.target,
      relativePath: props.relativePath,
    }),
    queryFn: () => {
      if (!props.relativePath) throw new Error("No selected file.");
      return ensureEnvironmentApi(props.environmentId).projects.getFileMetadata({
        target: props.target,
        relativePath: props.relativePath,
      });
    },
    enabled: Boolean(props.relativePath),
    retry: false,
  });
  const metadata = metadataQuery.data;
  const previewKind = metadata?.previewKind;
  const isTextKind = previewKind === "markdown" || previewKind === "code" || previewKind === "text";
  const isRawKind =
    previewKind === "image" ||
    previewKind === "svg" ||
    previewKind === "pdf" ||
    previewKind === "audio" ||
    previewKind === "video";
  const textQuery = useQuery({
    queryKey: projectFilePreviewQueryKey({
      environmentId: props.environmentId,
      target: props.target,
      relativePath: props.relativePath,
    }),
    queryFn: () => {
      if (!props.relativePath) throw new Error("No selected file.");
      return ensureEnvironmentApi(props.environmentId).projects.readFile({
        target: props.target,
        relativePath: props.relativePath,
      });
    },
    enabled: Boolean(props.relativePath) && isTextKind,
    retry: false,
  });
  const rawQuery = useQuery({
    queryKey: ["project-file-raw-preview", props.environmentId, props.target, props.relativePath],
    queryFn: async () => {
      if (!props.relativePath) throw new Error("No selected file.");
      const result = await ensureEnvironmentApi(props.environmentId).projects.createFilePreviewUrl({
        target: props.target,
        relativePath: props.relativePath,
      });
      return { ...result, url: resolvePreviewUrl(props.environmentId, result.url) };
    },
    enabled: Boolean(props.relativePath) && isRawKind,
    retry: false,
    staleTime: 0,
  });
  const rawPreviewExpiresAt = rawQuery.data?.expiresAt;
  const refetchRawPreview = rawQuery.refetch;
  useEffect(() => {
    if (!rawPreviewExpiresAt) return;
    const delayMs = Math.max(0, new Date(rawPreviewExpiresAt).getTime() - Date.now() - 30_000);
    const timer = window.setTimeout(() => {
      void refetchRawPreview();
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [rawPreviewExpiresAt, refetchRawPreview]);

  if (!props.relativePath) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Select a file to preview.
      </div>
    );
  }
  if (metadataQuery.isPending || (isTextKind && textQuery.isPending)) {
    return <PreviewSkeleton />;
  }
  if (textQuery.data) {
    return (
      <TextPreview
        data={textQuery.data}
        sourceMode={props.sourceMode}
        onSourceModeChange={props.onSourceModeChange}
        onOpenInEditor={props.onOpenInEditor}
      />
    );
  }
  if (isRawKind && rawQuery.isPending) {
    return <PreviewSkeleton />;
  }
  if (rawQuery.data) {
    return (
      <RawPreview
        relativePath={props.relativePath}
        url={rawQuery.data.url}
        kind={rawQuery.data.previewKind}
        mimeType={rawQuery.data.mimeType}
        onOpenInEditor={() => props.onOpenInEditor(rawQuery.data.openPath)}
      />
    );
  }
  if (metadata && metadata.previewKind === "unsupported") {
    return (
      <UnsupportedPreview
        relativePath={props.relativePath}
        message={metadata.mimeType ?? "Preview unavailable."}
        onOpenInEditor={() => props.onOpenInEditor(metadata.openPath)}
      />
    );
  }
  return (
    <UnsupportedPreview
      relativePath={props.relativePath}
      message={
        rawQuery.error instanceof Error
          ? rawQuery.error.message
          : textQuery.error instanceof Error
            ? textQuery.error.message
            : metadataQuery.error instanceof Error
              ? metadataQuery.error.message
              : "Preview unavailable."
      }
      onOpenInEditor={() => {
        if (metadata?.openPath) props.onOpenInEditor(metadata.openPath);
      }}
    />
  );
}

function PreviewSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-5 w-1/2 rounded-full" />
      <Skeleton className="h-4 w-full rounded-full" />
      <Skeleton className="h-4 w-11/12 rounded-full" />
      <Skeleton className="h-4 w-10/12 rounded-full" />
    </div>
  );
}

function PreviewHeader(props: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      {props.icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{props.title}</div>
        {props.subtitle ? (
          <div className="truncate text-[11px] text-muted-foreground">{props.subtitle}</div>
        ) : null}
      </div>
      {props.children}
    </div>
  );
}

function TextPreview(props: {
  data: ProjectReadFileResult;
  sourceMode: boolean;
  onSourceModeChange: (next: boolean) => void;
  onOpenInEditor: (path: string) => void;
}) {
  const showRenderedMarkdown = props.data.previewKind === "markdown" && !props.sourceMode;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewHeader
        title={props.data.name}
        subtitle={
          props.data.truncated
            ? `Truncated to ${(props.data.maxBytes / 1024).toFixed(0)}KB`
            : props.data.mimeType
        }
        icon={<CodeIcon className="size-4 text-muted-foreground" />}
      >
        {props.data.previewKind === "markdown" ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => props.onSourceModeChange(!props.sourceMode)}
          >
            {props.sourceMode ? "Rendered" : "Source"}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="xs"
          onClick={() => props.onOpenInEditor(props.data.openPath)}
        >
          <ExternalLinkIcon className="size-3" />
          Open
        </Button>
      </PreviewHeader>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {showRenderedMarkdown ? (
          <div className="chat-markdown text-sm">
            <ChatMarkdown text={props.data.content} cwd={props.data.cwd} />
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90">
            {props.data.content}
          </pre>
        )}
      </div>
    </div>
  );
}

function RawPreview(props: {
  relativePath: string;
  url: string;
  kind: ProjectFilePreviewKind;
  mimeType: string;
  onOpenInEditor: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewHeader
        title={props.relativePath.split("/").at(-1) ?? props.relativePath}
        subtitle={props.mimeType}
        icon={<ImageIcon className="size-4 text-muted-foreground" />}
      >
        <Button variant="outline" size="xs" onClick={props.onOpenInEditor}>
          <ExternalLinkIcon className="size-3" />
          Open
        </Button>
      </PreviewHeader>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-3">
        {props.kind === "image" || props.kind === "svg" ? (
          <img src={props.url} alt="" className="max-h-full max-w-full object-contain" />
        ) : props.kind === "pdf" ? (
          <object
            data={props.url}
            type="application/pdf"
            className="h-full min-h-[320px] w-full border-0"
            aria-label={props.relativePath}
          >
            <a href={props.url}>Open PDF preview</a>
          </object>
        ) : props.kind === "audio" ? (
          <audio src={props.url} controls className="w-full max-w-lg" />
        ) : props.kind === "video" ? (
          <video src={props.url} controls className="max-h-full max-w-full" />
        ) : null}
      </div>
    </div>
  );
}

function UnsupportedPreview(props: {
  relativePath: string;
  message: string;
  onOpenInEditor: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewHeader
        title={props.relativePath.split("/").at(-1) ?? props.relativePath}
        subtitle="Unsupported preview"
        icon={<FileQuestionIcon className="size-4 text-muted-foreground" />}
      >
        <Button variant="outline" size="xs" onClick={props.onOpenInEditor}>
          <ExternalLinkIcon className="size-3" />
          Open
        </Button>
      </PreviewHeader>
      <div className="p-4 text-sm text-muted-foreground">{props.message}</div>
    </div>
  );
}
