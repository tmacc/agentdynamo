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

export function BoardCardSheet({
  environmentId,
  projectId,
  cardId,
  onClose,
  onStartAgent,
}: BoardCardSheetProps) {
  const cards = useBoardCards(environmentId, projectId);
  const persistedCard = cards.find((candidate) => candidate.id === cardId) ?? null;
  const [title, setTitle] = useState(persistedCard?.title ?? "");
  const [description, setDescription] = useState(persistedCard?.description ?? "");
  const [seededPrompt, setSeededPrompt] = useState(persistedCard?.seededPrompt ?? "");
  const [dirty, setDirty] = useState<BoardCardSheetDirtyState>(CLEAN_DIRTY_STATE);
  const [promptPreview, setPromptPreview] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState<"archive" | "delete" | "promote" | null>(
    null,
  );
  const [pendingDeleteCardSnapshot, setPendingDeleteCardSnapshot] = useState<FeatureCard | null>(
    null,
  );
  const initializedCardIdRef = useRef<FeatureCardId | null>(null);

  const card = persistedCard ?? (pendingMutation === "delete" ? pendingDeleteCardSnapshot : null);
  const effectivePrompt = (() => {
    const prompt = seededPrompt.trim();
    if (prompt.length > 0) {
      return prompt;
    }
    const nextDescription = description.trim();
    const nextTitle = title.trim();
    return nextDescription.length > 0 ? `${nextTitle}\n\n${nextDescription}` : nextTitle;
  })();

  useEffect(() => {
    if (persistedCard === null && pendingMutation !== "delete") {
      onClose();
    }
  }, [onClose, pendingMutation, persistedCard]);

  useEffect(() => {
    if (card === null || initializedCardIdRef.current === card.id) {
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

  const commit = useCallback(
    async (patch: {
      title?: string;
      description?: string | null;
      seededPrompt?: string | null;
    }) => {
      if (persistedCard === null) {
        return;
      }
      setSaveError(null);
      try {
        await updateBoardCard({ environmentId, projectId, cardId: persistedCard.id, ...patch });
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : "Failed to save changes");
      }
    },
    [environmentId, persistedCard, projectId],
  );

  const handleTitleCommit = useCallback(() => {
    if (card === null) {
      return;
    }
    const nextTitle = normalizeCardTitleDraft(title);
    if (nextTitle.length === 0) {
      setTitle(card.title);
      setDirty((currentDirty) =>
        currentDirty.title ? { ...currentDirty, title: false } : currentDirty,
      );
      setSaveError("Title is required");
      return;
    }
    setTitle(nextTitle);
    if (nextTitle === card.title) {
      setDirty((currentDirty) =>
        currentDirty.title ? { ...currentDirty, title: false } : currentDirty,
      );
      return;
    }
    void commit({ title: nextTitle });
  }, [card, commit, title]);

  const handleDescriptionCommit = useCallback(() => {
    if (card === null) {
      return;
    }
    const previousDescription = card.description ?? "";
    if (description === previousDescription) {
      return;
    }
    void commit({ description: description.length > 0 ? description : null });
  }, [card, commit, description]);

  const handleSeededPromptCommit = useCallback(() => {
    if (card === null) {
      return;
    }
    const previousSeededPrompt = card.seededPrompt ?? "";
    if (seededPrompt === previousSeededPrompt) {
      return;
    }
    void commit({ seededPrompt: seededPrompt.length > 0 ? seededPrompt : null });
  }, [card, commit, seededPrompt]);

  const handleArchive = useCallback(() => {
    if (card === null) {
      return;
    }
    setPendingMutation("archive");
    setSaveError(null);
    void archiveBoardCard({ environmentId, projectId, cardId: card.id })
      .then(() => {
        onClose();
      })
      .catch((cause) => {
        setSaveError(cause instanceof Error ? cause.message : "Failed to archive");
      })
      .finally(() => {
        setPendingMutation(null);
      });
  }, [card, environmentId, onClose, projectId]);

  const handleDelete = useCallback(() => {
    if (card === null) {
      return;
    }
    setPendingMutation("delete");
    setSaveError(null);
    setPendingDeleteCardSnapshot(card);
    void deleteBoardCard({ environmentId, projectId, cardId: card.id })
      .then(() => {
        onClose();
      })
      .catch((cause) => {
        setSaveError(cause instanceof Error ? cause.message : "Failed to delete");
      })
      .finally(() => {
        setPendingMutation(null);
        setPendingDeleteCardSnapshot((currentSnapshot) =>
          persistedCard === null ? currentSnapshot : null,
        );
      });
  }, [card, environmentId, onClose, persistedCard, projectId]);

  const handlePromoteToPlanned = useCallback(() => {
    if (card === null || card.column !== "ideas") {
      return;
    }
    setPendingMutation("promote");
    setSaveError(null);
    const firstPlanned =
      cards
        .filter((candidate) => candidate.column === "planned" && candidate.archivedAt === null)
        .toSorted((left, right) => left.sortOrder - right.sortOrder)
        .at(0) ?? null;
    const { sortOrder } = computeSortOrderBetween(cards, "planned", null, firstPlanned?.id ?? null);
    void moveBoardCard({
      environmentId,
      projectId,
      cardId: card.id,
      toColumn: "planned",
      sortOrder,
    })
      .catch((cause) => {
        setSaveError(cause instanceof Error ? cause.message : "Failed to promote");
      })
      .finally(() => {
        setPendingMutation(null);
      });
  }, [card, cards, environmentId, projectId]);

  const handleStartAgent = useCallback(() => {
    if (card === null) {
      return;
    }
    onStartAgent(card);
    onClose();
  }, [card, onClose, onStartAgent]);

  if (card === null) {
    return null;
  }

  const canDelete = card.linkedThreadId === null;
  const canStartAgent = card.column === "planned" && card.linkedThreadId === null;
  const canPromote = card.column === "ideas";
  const isMutating = pendingMutation !== null;
  const showOverflowMenu = !card.archivedAt || canDelete;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetPopup side="right" className="flex w-[min(92vw,520px)] max-w-[520px] flex-col p-0">
        <SheetHeader className="border-b py-4 pr-12">
          <SheetTitle className="sr-only">{title || "Untitled card"}</SheetTitle>
          <Input
            value={title}
            onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              setDirty((currentDirty) => ({
                ...currentDirty,
                title: nextTitle !== card.title,
              }));
            }}
            onBlur={handleTitleCommit}
            disabled={isMutating}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
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
                onChange={(event) => {
                  const nextDescription = event.target.value;
                  setDescription(nextDescription);
                  setDirty((currentDirty) => ({
                    ...currentDirty,
                    description: nextDescription !== cardTextValue(persistedCard?.description),
                  }));
                }}
                onBlur={handleDescriptionCommit}
                disabled={isMutating}
                placeholder="Add more detail about this card..."
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
                    const nextValue = value[0];
                    if (nextValue === "preview" || nextValue === "edit") {
                      setPromptPreview(nextValue === "preview");
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
                <div className="rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
                  {effectivePrompt || (
                    <span className="italic text-muted-foreground">
                      (empty prompt - will fall back to the title)
                    </span>
                  )}
                  {seededPrompt.trim().length === 0 ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      No seeded prompt - falls back to title
                      {description.trim().length > 0 ? " + description" : ""}.
                    </div>
                  ) : null}
                </div>
              ) : (
                <Textarea
                  value={seededPrompt}
                  onChange={(event) => {
                    const nextSeededPrompt = event.target.value;
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
          <div>
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
                      {pendingMutation === "archive" ? "Archiving..." : "Archive"}
                    </MenuItem>
                  ) : null}
                  {canDelete ? (
                    <MenuItem variant="destructive" onClick={handleDelete} disabled={isMutating}>
                      <Trash2Icon />
                      {pendingMutation === "delete" ? "Deleting..." : "Delete"}
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
  const thread = useStore((state) =>
    threadRef ? selectSidebarThreadSummaryByRef(state, threadRef) : undefined,
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
    void unlinkBoardCardThread({
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
