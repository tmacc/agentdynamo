import type {
  ProjectScanWorktreeReadinessResult,
  ProjectWorktreeReadinessEnvStrategy,
} from "@t3tools/contracts";

import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";

interface WorktreeReadinessDialogProps {
  open: boolean;
  phase: "scanning" | "review" | "applying";
  scanResult: ProjectScanWorktreeReadinessResult | null;
  installCommand: string;
  devCommand: string;
  envStrategy: ProjectWorktreeReadinessEnvStrategy;
  overwriteManagedFiles: boolean;
  errorMessage: string | null;
  canApply: boolean;
  onInstallCommandChange: (value: string) => void;
  onDevCommandChange: (value: string) => void;
  onEnvStrategyChange: (value: ProjectWorktreeReadinessEnvStrategy) => void;
  onOverwriteManagedFilesChange: (value: boolean) => void;
  onApply: () => void;
  onSkipOnce: () => void;
  onNeverAskAgain: () => void;
}

const ENV_STRATEGY_LABELS: Record<ProjectWorktreeReadinessEnvStrategy, string> = {
  symlink_root: "Symlink root env",
  copy_root: "Copy root env",
  none: "No env handling",
};

export function WorktreeReadinessDialog({
  open,
  phase,
  scanResult,
  installCommand,
  devCommand,
  envStrategy,
  overwriteManagedFiles,
  errorMessage,
  canApply,
  onInstallCommandChange,
  onDevCommandChange,
  onEnvStrategyChange,
  onOverwriteManagedFilesChange,
  onApply,
  onSkipOnce,
  onNeverAskAgain,
}: WorktreeReadinessDialogProps) {
  const proposedFileUpdates =
    scanResult?.proposedFiles.filter((file) => file.action === "update").length ?? 0;

  return (
    <Dialog open={open}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Worktree Readiness</DialogTitle>
          <DialogDescription>
            {phase === "scanning"
              ? "Checking how this project should be prepared for worktree dev."
              : "Review the generated setup before creating the worktree."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {phase === "scanning" || phase === "applying" ? (
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/25 p-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {phase === "scanning"
                ? "Scanning the project for package manager, dev command, env handling, and port needs."
                : "Applying repo files, project actions, and worktree runtime defaults."}
            </div>
          ) : null}

          {phase === "review" && scanResult ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm">
                  <div className="font-medium text-foreground">Detected project</div>
                  <div className="text-muted-foreground">{scanResult.detectedProjectType}</div>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm">
                  <div className="font-medium text-foreground">Reserved ports</div>
                  <div className="text-muted-foreground">
                    T3 Code reserves a stable 5-port block and maps `PORT` to the primary port.
                  </div>
                </div>
              </div>

              <label className="grid gap-1.5">
                <Label>Install command</Label>
                <Input
                  value={installCommand}
                  onChange={(event) => onInstallCommandChange(event.target.value)}
                  placeholder="Optional"
                />
              </label>

              <label className="grid gap-1.5">
                <Label>Dev command</Label>
                <Input
                  value={devCommand}
                  onChange={(event) => onDevCommandChange(event.target.value)}
                  placeholder="Required"
                />
              </label>

              <div className="grid gap-1.5">
                <Label>Env handling</Label>
                <Select
                  value={envStrategy}
                  onValueChange={(value) =>
                    onEnvStrategyChange(value as ProjectWorktreeReadinessEnvStrategy)
                  }
                >
                  <SelectTrigger aria-label="Env handling">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="symlink_root">{ENV_STRATEGY_LABELS.symlink_root}</SelectItem>
                    <SelectItem value="copy_root">{ENV_STRATEGY_LABELS.copy_root}</SelectItem>
                    <SelectItem value="none">{ENV_STRATEGY_LABELS.none}</SelectItem>
                  </SelectPopup>
                </Select>
              </div>

              <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm">
                <div className="mb-1 font-medium text-foreground">Generated files</div>
                <ul className="space-y-1 text-muted-foreground">
                  {scanResult.proposedFiles.map((file) => (
                    <li key={file.path}>
                      {file.path} · {file.action}
                    </li>
                  ))}
                </ul>
              </div>

              {proposedFileUpdates > 0 ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={overwriteManagedFiles}
                    onCheckedChange={(checked) => onOverwriteManagedFilesChange(Boolean(checked))}
                  />
                  <span>Overwrite existing generated helper files</span>
                </label>
              ) : null}

              {scanResult.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <div className="mb-1 font-medium text-foreground">Warnings</div>
                  <ul className="space-y-1 text-muted-foreground">
                    {scanResult.warnings.map((warning) => (
                      <li key={warning.id}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {errorMessage ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {errorMessage}
                </div>
              ) : null}
            </>
          ) : null}
        </DialogPanel>
        <DialogFooter className="justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onSkipOnce} disabled={phase !== "review"}>
              Skip once
            </Button>
            <Button variant="ghost" onClick={onNeverAskAgain} disabled={phase !== "review"}>
              Never ask again
            </Button>
          </div>
          <Button onClick={onApply} disabled={phase !== "review" || !canApply}>
            Set up worktrees
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
