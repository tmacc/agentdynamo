import { useEffect, useId, useMemo, useState } from "react";

import type { SavedPromptScope } from "~/savedPromptStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { RadioGroup, Radio } from "../ui/radio-group";

interface SavedPromptDialogProps {
  open: boolean;
  mode: "create" | "rename";
  initialTitle: string;
  initialScope: SavedPromptScope;
  projectScopeAvailable: boolean;
  bodyPreview?: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: { title: string; scope: SavedPromptScope }) => void | Promise<void>;
}

export function SavedPromptDialog({
  open,
  mode,
  initialTitle,
  initialScope,
  projectScopeAvailable,
  bodyPreview,
  pending = false,
  onOpenChange,
  onConfirm,
}: SavedPromptDialogProps) {
  const titleInputId = useId();
  const scopeInputBaseId = useId();
  const [title, setTitle] = useState(initialTitle);
  const [scope, setScope] = useState<SavedPromptScope>(
    projectScopeAvailable ? initialScope : "global",
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(initialTitle);
    setScope(projectScopeAvailable ? initialScope : "global");
  }, [initialScope, initialTitle, open, projectScopeAvailable]);

  const normalizedTitle = title.trim();
  const dialogCopy = useMemo(
    () =>
      mode === "create"
        ? {
            title: "Save prompt",
            description:
              "Saved prompts are plain text snippets. For reusable workflows with tools or arguments, use / commands or $ skills.",
            confirmLabel: pending ? "Saving..." : "Save",
          }
        : {
            title: "Rename saved prompt",
            description:
              "Saved prompts are plain text snippets. If this grows into a reusable workflow, promote it to a / command or $ skill.",
            confirmLabel: pending ? "Saving..." : "Save",
          },
    [mode, pending],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialogCopy.title}</DialogTitle>
          <DialogDescription>{dialogCopy.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label htmlFor={titleInputId} className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Title</span>
            <Input
              id={titleInputId}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Saved prompt"
              disabled={pending}
              maxLength={80}
              data-testid="saved-prompt-title-input"
            />
          </label>

          {mode === "create" && bodyPreview ? (
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Prompt text</span>
              <div className="max-h-40 overflow-y-auto rounded-xl border border-border/70 bg-muted/25 px-3 py-2 text-sm text-foreground/90 whitespace-pre-wrap">
                {bodyPreview}
              </div>
            </div>
          ) : null}

          {mode === "create" ? (
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Scope</span>
              <RadioGroup
                value={scope}
                onValueChange={(value) => {
                  if (!value) return;
                  setScope(value as SavedPromptScope);
                }}
                className="gap-2"
              >
                {projectScopeAvailable ? (
                  <label
                    htmlFor={`${scopeInputBaseId}-project`}
                    className="flex cursor-pointer items-start gap-2 rounded-xl border border-border/70 px-3 py-2"
                  >
                    <Radio id={`${scopeInputBaseId}-project`} value="project" disabled={pending} />
                    <span className="grid gap-0.5">
                      <span className="text-sm font-medium text-foreground">This project</span>
                      <span className="text-muted-foreground text-xs">
                        Keep this snippet scoped to the current project.
                      </span>
                    </span>
                  </label>
                ) : null}
                <label
                  htmlFor={`${scopeInputBaseId}-global`}
                  className="flex cursor-pointer items-start gap-2 rounded-xl border border-border/70 px-3 py-2"
                >
                  <Radio id={`${scopeInputBaseId}-global`} value="global" disabled={pending} />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium text-foreground">All projects</span>
                    <span className="text-muted-foreground text-xs">
                      Make this snippet available everywhere in this browser.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            </div>
          ) : null}

          <p className="text-muted-foreground text-xs">
            If this grows into a reusable workflow, promote it to a / command or $ skill.
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={pending || normalizedTitle.length === 0}
            onClick={() =>
              void onConfirm({
                title: normalizedTitle,
                scope: projectScopeAvailable ? scope : "global",
              })
            }
          >
            {dialogCopy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
