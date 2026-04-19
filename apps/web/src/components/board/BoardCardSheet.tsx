import {
  type EnvironmentId,
  type FeatureCard,
  type FeatureCardId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import {
  ArchiveIcon,
  ArrowRightIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  LinkIcon,
  PlayIcon,
  SparklesIcon,
  Trash2Icon,
  Unlink2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { clearBoardRouteSearchParams } from "../../boardRouteSearch";
import {
  archiveBoardCard,
  computeSortOrderBetween,
  deleteBoardCard,
  moveBoardCard,
  unlinkBoardCardThread,
  updateBoardCard,
  useBoardCards,
} from "../../boardStore";
import { selectSidebarThreadSummaryByRef, useStore } from "../../store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Section, SectionAction, SectionBody, SectionHeader, SectionLabel } from "../ui/section";
import { Sheet, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from "../ui/sheet";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

interface BoardCardSheetProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cardId: FeatureCardId;
  readonly onClose: () => void;
  readonly onStartAgent: (card: FeatureCard) => void;
}

interface BoardCardSheetDirtyState {
  readonly title: boolean;
  readonly description: boolean;
  readonly seededPrompt: boolean;
}

const CLEAN_DIRTY_STATE: BoardCardSheetDirtyState = {
  title: false,
  description: false,
  seededPrompt: false,
};

function cardTextValue(value: string | null | undefined): string {
  return value ?? "";
}

function normalizeCardTitleDraft(value: string): string {
  return value.trim();
}

/**
 * Right-side drawer that slides in when the user opens a board card. Hosts
 * inline editors for title / description / seeded prompt, plus the linked-
 * thread actions and archive/delete destructive actions.
 *
 * Autosave strategy: description and seeded prompt flush on blur. Title
 * flushes on Enter or on blur (whichever comes first). No explicit "save"
 * button — the sheet is purely a detail editor.
 */
export function BoardCardSheet({
  environmentId,
  projectId,
  cardId,
  onClose,
  onStartAgent,
}: BoardCardSheetProps) {
  const cards = useBoardCards(environmentId, projectId);
  const persistedCard = cards.find((candidate) => candidate.id === cardId) ?? null;
  const [title, setTitle] = useState<string>(persistedCard?.title ?? "");
  const [description, setDescription] = useState<string>(persistedCard?.description ?? "");
  const [seededPrompt, setSeededPrompt] = useState<string>(persistedCard?.seededPrompt ?? "");
  const [dirty, setDirty] = useState<BoardCardSheetDirtyState>(CLEAN_DIRTY_STATE);
  const [promptPreview, setPromptPreview] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState<"archive" | "delete" | "promote" | null>(
    null,
  );
  const [pendingDeleteCardSnapshot, setPendingDeleteCardSnapshot] = useState<FeatureCard | null>(
    null,
  );
  const initializedCardIdRef = useRef<FeatureCardId | null>(null);

  const card = persistedCard ?? (pendingMutation === "delete" ? pendingDeleteCardSnapshot : null);

  useEffect(() => {
    if (persistedCard === null && pendingMutation !== "delete") {
      onClose();
    }
  }, [onClose, pendingMutation, persistedCard]);

  useEffect(() => {
    if (card === null) {
      return;
    }
    if (initializedCardIdRef.current === card.id) {
      return;
    }
    initializedCardIdRef.current = card.id;
    setTitle(card.title);
    setDescription(card.description ?? "");
    setSeededPrompt(card.seededPrompt ?? "");
    setDirty(CLEAN_DIRTY_STATE);
    setPromptPreview(false);
    setSaveError(null);
    setPendingMutation(null);
    setPendingDeleteCardSnapshot(null);
  }, [card]);

  useEffect(() => {
    if (persistedCard === null || initializedCardIdRef.current !== persistedCard.id) {
      return;
    }

    setTitle((currentTitle) => {
      if (dirty.title) {
        if (persistedCard.title === currentTitle) {
          setDirty((currentDirty) =>
            currentDirty.title ? { ...currentDirty, title: false } : currentDirty,
          );
        }
        return currentTitle;
      }
      return persistedCard.title;
    });

    const persistedDescription = cardTextValue(persistedCard.description);
    setDescription((currentDescription) => {
      if (dirty.description) {
        if (persistedDescription === currentDescription) {
          setDirty((currentDirty) =>
            currentDirty.description ? { ...currentDirty, description: false } : currentDirty,
          );
        }
        return currentDescription;
      }
      return persistedDescription;
    });

    const persistedSeededPrompt = cardTextValue(persistedCard.seededPrompt);
    setSeededPrompt((currentSeededPrompt) => {
      if (dirty.seededPrompt) {
        if (persistedSeededPrompt === currentSeededPrompt) {
          setDirty((currentDirty) =>
            currentDirty.seededPrompt ? { ...currentDirty, seededPrompt: false } : currentDirty,
          );
        }
        return currentSeededPrompt;
      }
      return persistedSeededPrompt;
    });
  }, [dirty.description, dirty.seededPrompt, dirty.title, persistedCard]);

  if (card === null) {
    return null;
  }

  const effectivePrompt = useMemo<string>(() => {
    const prompt = seededPrompt.trim();
    if (prompt.length > 0) return prompt;
    const desc = description.trim();
    const titleText = title.trim();
    return desc.length > 0 ? `${titleText}\n\n${desc}` : titleText;
  }, [seededPrompt, description, title]);

  const commit = useCallback(
    async (patch: {
      title?: string;
      description?: string | null;
      seededPrompt?: string | null;
    }) => {
      if (persistedCard === null) return;
      setSaveError(null);
      try {
        await updateBoardCard({ environmentId, projectId, cardId: persistedCard.id, ...patch });
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Failed to save changes");
      }
    },
    [environmentId, persistedCard, projectId],
  );

  const handleTitleCommit = useCallback(() => {
    const next = normalizeCardTitleDraft(title);
    if (next.length === 0) {
      // Revert: title is required. Surface why so the user knows the input
      // didn't silently swallow their edit.
      setTitle(card.title);
      setDirty((currentDirty) =>
        currentDirty.title ? { ...currentDirty, title: false } : currentDirty,
      );
      setSaveError("Title is required");
      return;
    }
    setTitle(next);
    if (next === card.title) {
      setDirty((currentDirty) =>
        currentDirty.title ? { ...currentDirty, title: false } : currentDirty,
      );
      return;
    }
    void commit({ title: next });
  }, [card.title, commit, title]);

  const handleDescriptionCommit = useCallback(() => {
    const next = description;
    const prev = card.description ?? "";
    if (next === prev) return;
    void commit({ description: next.length > 0 ? next : null });
  }, [card.description, commit, description]);

  const handleSeededPromptCommit = useCallback(() => {
    const next = seededPrompt;
    const prev = card.seededPrompt ?? "";
    if (next === prev) return;
    void commit({ seededPrompt: next.length > 0 ? next : null });
  }, [card.seededPrompt, commit, seededPrompt]);

  const handleArchive = useCallback(() => {
    setPendingMutation("archive");
    setSaveError(null);
    void archiveBoardCard({ environmentId, projectId, cardId: card.id })
      .then(() => {
        onClose();
      })
      .catch((err) => {
        setSaveError(err instanceof Error ? err.message : "Failed to archive");
      })
      .finally(() => {
        setPendingMutation(null);
      });
  }, [card.id, environmentId, onClose, projectId]);

  const handleDelete = useCallback(() => {
    setPendingMutation("delete");
    setSaveError(null);
    setPendingDeleteCardSnapshot(card);
    void deleteBoardCard({ environmentId, projectId, cardId: card.id })
      .then(() => {
        onClose();
      })
      .catch((err) => {
        setSaveError(err instanceof Error ? err.message : "Failed to delete");
      })
      .finally(() => {
        setPendingMutation(null);
        setPendingDeleteCardSnapshot((currentSnapshot) =>
          persistedCard === null ? currentSnapshot : null,
        );
      });
  }, [card, environmentId, onClose, persistedCard, projectId]);

  const handlePromoteToPlanned = useCallback(() => {
    if (card.column !== "ideas") return;
    setPendingMutation("promote");
    setSaveError(null);
    // Place at the top of Planned: insert before the first existing Planned card.
    const firstPlanned =
      cards
        .filter((c) => c.column === "planned" && c.archivedAt === null)
        .toSorted((a, b) => a.sortOrder - b.sortOrder)
        .at(0) ?? null;
    const { sortOrder } = computeSortOrderBetween(cards, "planned", null, firstPlanned?.id ?? null);
    void moveBoardCard({
      environmentId,
      projectId,
      cardId: card.id,
      toColumn: "planned",
      sortOrder,
    })
      .catch((err) => {
        setSaveError(err instanceof Error ? err.message : "Failed to promote");
      })
      .finally(() => {
        setPendingMutation(null);
      });
  }, [card.column, card.id, cards, environmentId, projectId]);

  const handleStartAgent = useCallback(() => {
    onStartAgent(card);
    onClose();
  }, [card, onClose, onStartAgent]);

  // `deleteBoardCard` in the store enforces allowed-when-not-linked; mirror
  // that here to keep the button disabled while linked to a thread.
  const canDelete = card.linkedThreadId === null;
  const canStartAgent = card.column === "planned" && card.linkedThreadId === null;
  const canPromote = card.column === "ideas";
  const isMutating = pendingMutation !== null;
  const showOverflowMenu = !card.archivedAt || canDelete;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPopup side="right" className="flex w-[min(92vw,520px)] max-w-[520px] flex-col p-0">
        <SheetHeader className="border-b py-4 pr-12">
          <SheetTitle className="sr-only">{title || "Untitled card"}</SheetTitle>
          <Input
            value={title}
            onChange={(e) => {
              const nextTitle = e.target.value;
              setTitle(nextTitle);
              setDirty((currentDirty) => ({
                ...currentDirty,
                title: nextTitle !== card.title,
              }));
            }}
            onBlur={handleTitleCommit}
            disabled={isMutating}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleTitleCommit();
              }
            }}
            className="h-9 text-base font-semibold"
            placeholder="Untitled card"
            aria-label="Card title"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="capitalize">{card.column}</span>
            {canPromote ? (
              <Button
                size="xs"
                variant="outline"
                onClick={handlePromoteToPlanned}
                disabled={isMutating}
              >
                Mark as planned
                <ArrowRightIcon className="size-3" />
              </Button>
            ) : null}
            {card.linkedProposedPlanId ? (
              <span className="inline-flex items-center gap-1 text-violet-500">
                <SparklesIcon className="size-3" />
                From proposed plan
              </span>
            ) : null}
            {card.archivedAt ? <span className="text-warning">Archived</span> : null}
          </div>
        </SheetHeader>

        <SheetPanel className="flex flex-1 flex-col gap-4 p-4">
          <Section>
            <SectionHeader>
              <SectionLabel>Description</SectionLabel>
            </SectionHeader>
            <SectionBody>
              <Textarea
                value={description}
                onChange={(e) => {
                  const nextDescription = e.target.value;
                  setDescription(nextDescription);
                  setDirty((currentDirty) => ({
                    ...currentDirty,
                    description: nextDescription !== cardTextValue(persistedCard?.description),
                  }));
                }}
                onBlur={handleDescriptionCommit}
                disabled={isMutating}
                placeholder="Add more detail about this card…"
                className="min-h-[5rem] text-xs"
                size="sm"
              />
            </SectionBody>
          </Section>

          <Section>
            <SectionHeader>
              <SectionLabel>Seeded prompt</SectionLabel>
              <SectionAction>
                <ToggleGroup
                  variant="outline"
                  size="xs"
                  value={[promptPreview ? "preview" : "edit"]}
                  onValueChange={(value) => {
                    const next = value[0];
                    if (next === "preview" || next === "edit") {
                      setPromptPreview(next === "preview");
                    }
                  }}
                >
                  <Toggle aria-label="Edit prompt" value="edit">
                    Edit
                  </Toggle>
                  <Toggle aria-label="Preview prompt" value="preview">
                    Preview
                  </Toggle>
                </ToggleGroup>
              </SectionAction>
            </SectionHeader>
            <SectionBody>
              {promptPreview ? (
                <div className="rounded-md border bg-muted/40 p-2 font-mono text-xs text-foreground whitespace-pre-wrap">
                  {effectivePrompt || (
                    <span className="text-muted-foreground italic">
                      (empty prompt — will fall back to the title)
                    </span>
                  )}
                  {seededPrompt.trim().length === 0 ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      No seeded prompt — falls back to title
                      {description.trim().length > 0 ? " + description" : ""}.
                    </div>
                  ) : null}
                </div>
              ) : (
                <Textarea
                  value={seededPrompt}
                  onChange={(e) => {
                    const nextSeededPrompt = e.target.value;
                    setSeededPrompt(nextSeededPrompt);
                    setDirty((currentDirty) => ({
                      ...currentDirty,
                      seededPrompt: nextSeededPrompt !== cardTextValue(persistedCard?.seededPrompt),
                    }));
                  }}
                  onBlur={handleSeededPromptCommit}
                  disabled={isMutating}
                  placeholder="Optional prompt the agent is seeded with when you click Start Agent."
                  className="min-h-[6rem] font-mono text-xs"
                  size="sm"
                />
              )}
            </SectionBody>
          </Section>

          <LinkedThreadSection
            environmentId={environmentId}
            projectId={projectId}
            card={card}
            disabled={isMutating}
          />

          {saveError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {saveError}
            </div>
          ) : null}
        </SheetPanel>

        <SheetFooter className="flex items-center justify-between gap-2 border-t bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-1">
            {canStartAgent ? (
              <Button
                size="xs"
                variant="secondary"
                onClick={handleStartAgent}
                disabled={isMutating}
              >
                <PlayIcon className="size-3" />
                Start Agent
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {showOverflowMenu ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      aria-label="More card actions"
                      size="icon-xs"
                      variant="ghost"
                      disabled={isMutating}
                    />
                  }
                >
                  <EllipsisIcon aria-hidden="true" />
                </MenuTrigger>
                <MenuPopup align="end">
                  {!card.archivedAt ? (
                    <MenuItem onClick={handleArchive} disabled={isMutating}>
                      <ArchiveIcon />
                      {pendingMutation === "archive" ? "Archiving…" : "Archive"}
                    </MenuItem>
                  ) : null}
                  {canDelete ? (
                    <MenuItem variant="destructive" onClick={handleDelete} disabled={isMutating}>
                      <Trash2Icon />
                      {pendingMutation === "delete" ? "Deleting…" : "Delete"}
                    </MenuItem>
                  ) : null}
                </MenuPopup>
              </Menu>
            ) : null}
            <Button size="xs" variant="outline" onClick={onClose} disabled={isMutating}>
              Close
            </Button>
          </div>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

interface LinkedThreadSectionProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly card: FeatureCard;
  readonly disabled: boolean;
}

function LinkedThreadSection({
  environmentId,
  projectId,
  card,
  disabled,
}: LinkedThreadSectionProps) {
  const navigate = useNavigate();

  const threadRef = useMemo(
    () => (card.linkedThreadId ? scopeThreadRef(environmentId, card.linkedThreadId) : null),
    [card.linkedThreadId, environmentId],
  );
  const thread = useStore((s) =>
    threadRef ? selectSidebarThreadSummaryByRef(s, threadRef) : undefined,
  );

  const openThread = useCallback(
    (threadId: ThreadId) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
        search: (previous) => clearBoardRouteSearchParams(previous as Record<string, unknown>),
      }).catch(() => undefined);
    },
    [environmentId, navigate],
  );

  const handleUnlink = useCallback(() => {
    unlinkBoardCardThread({
      environmentId,
      projectId,
      cardId: card.id,
      previousThreadId: card.linkedThreadId,
    }).catch(() => undefined);
  }, [card.id, card.linkedThreadId, environmentId, projectId]);

  if (!card.linkedThreadId) {
    return (
      <Section>
        <SectionHeader>
          <SectionLabel>Linked thread</SectionLabel>
        </SectionHeader>
        <SectionBody>
          <div className="rounded-md border border-dashed bg-muted/30 p-2 text-xs text-muted-foreground">
            No thread linked yet. Click "Start Agent" on a Planned card to create one.
          </div>
        </SectionBody>
      </Section>
    );
  }

  return (
    <Section>
      <SectionHeader>
        <SectionLabel>Linked thread</SectionLabel>
        <SectionAction>
          <Button size="xs" variant="ghost" onClick={handleUnlink} disabled={disabled}>
            <Unlink2Icon className="size-3" />
            Unlink
          </Button>
        </SectionAction>
      </SectionHeader>
      <SectionBody>
        <div className="rounded-md border bg-card p-2">
          <div className="flex items-center gap-1.5 text-xs text-foreground">
            <LinkIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{thread?.title ?? "(thread unavailable)"}</span>
          </div>
          {thread?.branch ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">{thread.branch}</div>
          ) : null}
          <div className="mt-2 flex justify-end">
            <Button size="xs" variant="outline" onClick={() => openThread(card.linkedThreadId!)}>
              <ExternalLinkIcon className="size-3" />
              Open thread
            </Button>
          </div>
        </div>
      </SectionBody>
    </Section>
  );
}
