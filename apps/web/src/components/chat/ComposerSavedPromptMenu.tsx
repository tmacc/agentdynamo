import type { ScopedProjectRef } from "@t3tools/contracts";
import { BookmarkIcon, EllipsisIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { type SavedPromptSnippet, useSavedPromptStore } from "~/savedPromptStore";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface ComposerSavedPromptMenuProps {
  compact: boolean;
  disabled?: boolean;
  projectRef: ScopedProjectRef | null;
  onSelectSnippet: (snippet: SavedPromptSnippet) => void;
  onRenameSnippet: (snippet: SavedPromptSnippet) => void;
  onRequestDeleteSnippet: (snippet: SavedPromptSnippet) => void;
  triggerClassName?: string;
  popoverSide?: "top" | "bottom" | "left" | "right";
  popoverAlign?: "start" | "center" | "end";
}

export function ComposerSavedPromptMenu({
  compact,
  disabled = false,
  projectRef,
  onSelectSnippet,
  onRenameSnippet,
  onRequestDeleteSnippet,
  triggerClassName,
  popoverSide = "top",
  popoverAlign = "start",
}: ComposerSavedPromptMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const snippetsById = useSavedPromptStore((store) => store.snippetsById);
  const listVisibleSnippets = useSavedPromptStore((store) => store.listVisibleSnippets);
  const changeSnippetScope = useSavedPromptStore((store) => store.changeSnippetScope);

  void snippetsById;
  const groups = listVisibleSnippets(projectRef, query);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? "icon-sm" : "sm"}
            className={cn(
              "shrink-0 whitespace-nowrap text-muted-foreground/70 hover:text-foreground/80",
              compact ? null : "px-2 sm:px-3",
              triggerClassName,
            )}
            aria-label="Saved prompts"
            title="Saved prompts"
            disabled={disabled}
            data-testid="saved-prompt-trigger"
          />
        }
      >
        <BookmarkIcon className="size-4" />
        {compact ? null : <span>Saved</span>}
      </PopoverTrigger>

      <PopoverPopup
        side={popoverSide}
        align={popoverAlign}
        className="w-[min(30rem,calc(100vw-2rem))] p-0"
      >
        <div className="border-b px-3 py-3">
          <div className="flex items-center gap-2">
            <BookmarkIcon className="size-4 text-muted-foreground/70" />
            <div className="min-w-0">
              <p className="font-medium text-sm">Saved prompts</p>
              <p className="text-muted-foreground text-xs">
                Plain text snippets only. Use / commands or $ skills for reusable workflows.
              </p>
            </div>
          </div>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved prompts"
            className="mt-3"
            data-testid="saved-prompt-search"
          />
        </div>

        {groups.length > 0 ? (
          <ScrollArea className="max-h-80">
            <div className="p-2">
              {groups.map((group) => (
                <div key={group.id} className="pb-2 last:pb-0">
                  <p className="px-2 pt-1 pb-2 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground/60">
                    {group.label}
                  </p>
                  <div className="grid gap-1">
                    {group.items.map((snippet) => {
                      const canMoveToProject = snippet.scope === "global" && projectRef !== null;
                      const canChangeScope = snippet.scope === "project" || canMoveToProject;
                      const scopeActionLabel =
                        snippet.scope === "project"
                          ? "Move to all projects"
                          : "Limit to this project";

                      return (
                        <div
                          key={snippet.id}
                          className="flex min-w-0 items-start gap-2 overflow-hidden rounded-xl px-2 py-2 transition-colors hover:bg-accent"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 overflow-hidden items-start gap-2 text-left"
                            onClick={() => {
                              onSelectSnippet(snippet);
                              setOpen(false);
                            }}
                          >
                            <div className="mt-0.5 shrink-0 rounded-md bg-muted/70 p-1 text-muted-foreground/70">
                              <BookmarkIcon className="size-3.5" />
                            </div>
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                                <SavedPromptMarqueeText
                                  text={snippet.title}
                                  className="font-medium text-sm"
                                />
                                <Badge
                                  variant="outline"
                                  className="shrink-0 px-1.5 py-0 text-[10px]"
                                >
                                  {snippet.scope === "project" ? "Project" : "Global"}
                                </Badge>
                              </div>
                              <SavedPromptMarqueeText
                                text={snippet.body}
                                className="text-muted-foreground text-xs"
                              />
                            </div>
                          </button>
                          <Menu>
                            <MenuTrigger
                              render={
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  className="shrink-0"
                                  aria-label={`Actions for ${snippet.title}`}
                                />
                              }
                            >
                              <EllipsisIcon className="size-3.5" />
                            </MenuTrigger>
                            <MenuPopup align="end">
                              <MenuItem
                                onClick={() => {
                                  onRenameSnippet(snippet);
                                }}
                              >
                                Rename
                              </MenuItem>
                              <MenuItem
                                disabled={!canChangeScope}
                                onClick={() => {
                                  changeSnippetScope(
                                    snippet.id,
                                    snippet.scope === "project" ? "global" : "project",
                                    projectRef,
                                  );
                                }}
                              >
                                {scopeActionLabel}
                              </MenuItem>
                              <MenuItem
                                variant="destructive"
                                onClick={() => {
                                  setOpen(false);
                                  onRequestDeleteSnippet(snippet);
                                }}
                              >
                                Delete
                              </MenuItem>
                            </MenuPopup>
                          </Menu>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="px-3 py-4">
            <p className="font-medium text-sm">
              {query.trim().length > 0 ? "No matching saved prompts." : "No saved prompts yet."}
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              Save a previous user message to reuse it here. If this grows into a reusable workflow,
              promote it to a / command or $ skill.
            </p>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

function SavedPromptMarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const textElement = textRef.current;

    if (!container || !textElement) {
      return;
    }

    const updateOverflow = () => {
      setHasOverflow(textElement.scrollWidth > container.clientWidth + 1);
    };

    updateOverflow();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateOverflow);
      return () => window.removeEventListener("resize", updateOverflow);
    }

    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(container);
    resizeObserver.observe(textElement);

    return () => resizeObserver.disconnect();
  }, [text]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            ref={containerRef}
            className={cn(
              "saved-prompt-marquee",
              hasOverflow ? "saved-prompt-marquee--overflow" : null,
              className,
            )}
          >
            <span className="saved-prompt-marquee__track">
              <span ref={textRef} className="saved-prompt-marquee__text">
                {text}
              </span>
              {hasOverflow ? (
                <span aria-hidden="true" className="saved-prompt-marquee__text">
                  {text}
                </span>
              ) : null}
            </span>
          </span>
        }
      />
      <TooltipPopup
        side="top"
        align="start"
        className="max-w-[min(36rem,calc(100vw-2rem))] text-left leading-snug whitespace-pre-wrap wrap-anywhere"
      >
        <span className="block max-h-72 overflow-y-auto whitespace-pre-wrap">{text}</span>
      </TooltipPopup>
    </Tooltip>
  );
}
