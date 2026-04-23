import type {
  EnvironmentId,
  MessageId,
  OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import type { DraftThreadEnvMode } from "../composerDraftStore";
import { readEnvironmentApi } from "../environmentApi";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

interface ForkThreadDialogProps {
  open: boolean;
  environmentId: EnvironmentId;
  sourceThreadId: ThreadId;
  sourceUserMessageId: MessageId;
  sourceThreadTitle: string;
  defaultMode: DraftThreadEnvMode;
  baseBranch: string | null;
  onOpenChange: (open: boolean) => void;
  onForked: (thread: OrchestrationThreadShell) => Promise<void> | void;
}

export function ForkThreadDialog({
  open,
  environmentId,
  sourceThreadId,
  sourceUserMessageId,
  sourceThreadTitle,
  defaultMode,
  baseBranch,
  onOpenChange,
  onForked,
}: ForkThreadDialogProps) {
  const [mode, setMode] = useState<"local" | "worktree">(
    defaultMode === "worktree" ? "worktree" : "local",
  );
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setMode(defaultMode === "worktree" ? "worktree" : "local");
    setError(null);
    setIsPending(false);
  }, [defaultMode, open]);

  const options = useMemo(
    () =>
      [
        {
          value: "local" as const,
          label: "Local",
          description: "Create the fork in the project cwd.",
          disabled: false,
        },
        {
          value: "worktree" as const,
          label: "Worktree",
          description: baseBranch
            ? `Create a new worktree from ${baseBranch}.`
            : "Select a base branch first.",
          disabled: !baseBranch,
        },
      ] as const,
    [baseBranch],
  );

  const handleSubmit = async () => {
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setError("Environment API is unavailable.");
      return;
    }
    if (mode === "worktree" && !baseBranch) {
      setError("Select a base branch before creating a worktree fork.");
      return;
    }

    setIsPending(true);
    setError(null);
    try {
      const result = await api.orchestration.forkThread({
        sourceThreadId,
        sourceUserMessageId,
        mode,
        ...(mode === "worktree" && baseBranch ? { baseBranch } : {}),
      });
      await onForked(result.thread);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to fork thread.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fork Thread</DialogTitle>
          <DialogDescription>
            Fork from the selected user message in{" "}
            <span className="font-medium">{sourceThreadTitle}</span>.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <div className="grid gap-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled || isPending}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-colors",
                  mode === option.value
                    ? "border-foreground/30 bg-muted/40"
                    : "border-border/70 bg-background hover:border-border",
                  (option.disabled || isPending) && "cursor-not-allowed opacity-60",
                )}
                onClick={() => setMode(option.value)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-sm">{option.label}</span>
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      mode === option.value ? "bg-foreground/80" : "bg-muted-foreground/30",
                    )}
                  />
                </div>
                <p className="mt-1 text-muted-foreground text-xs">{option.description}</p>
              </button>
            ))}
          </div>

          {error ? <p className="text-destructive text-xs">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isPending || (mode === "worktree" && !baseBranch)}
            onClick={() => void handleSubmit()}
          >
            Create Fork
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
