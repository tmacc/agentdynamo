import type {
  ProjectScanWorktreeSetupResult,
  ProjectWorktreeSetupEnvStrategy,
} from "@t3tools/contracts";

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
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Radio, RadioGroup } from "./ui/radio-group";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch";

interface WorktreeSetupDialogProps {
  open: boolean;
  phase: "scanning" | "review" | "applying";
  scanResult: ProjectScanWorktreeSetupResult | null;
  installCommand: string;
  devCommand: string;
  envStrategy: ProjectWorktreeSetupEnvStrategy;
  autoRunSetupOnWorktreeCreate: boolean;
  errorMessage: string | null;
  canApply: boolean;
  onInstallCommandChange: (value: string) => void;
  onDevCommandChange: (value: string) => void;
  onEnvStrategyChange: (value: ProjectWorktreeSetupEnvStrategy) => void;
  onAutoRunSetupOnWorktreeCreateChange: (value: boolean) => void;
  onApply: () => void;
  onSkipOnce: () => void;
  onNeverAskAgain: () => void;
}

const envLabels: Record<ProjectWorktreeSetupEnvStrategy, string> = {
  symlink_root: "Link existing env file",
  copy_root: "Copy existing env file",
  none: "Don't manage env files",
};

export function WorktreeSetupDialog({
  open,
  phase,
  scanResult,
  installCommand,
  devCommand,
  envStrategy,
  autoRunSetupOnWorktreeCreate,
  errorMessage,
  canApply,
  onInstallCommandChange,
  onDevCommandChange,
  onEnvStrategyChange,
  onAutoRunSetupOnWorktreeCreateChange,
  onApply,
  onSkipOnce,
  onNeverAskAgain,
}: WorktreeSetupDialogProps) {
  return (
    <Dialog open={open}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Set up worktrees for this project</DialogTitle>
          <DialogDescription>
            Dynamo can prepare new worktrees so they run like your main checkout.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {phase === "scanning" || phase === "applying" ? (
            <div className="flex items-center gap-3 rounded-md border border-border/70 bg-muted/25 p-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {phase === "scanning"
                ? "Checking package manager, dev command, env file, and ports."
                : "Saving worktree setup."}
            </div>
          ) : null}

          {phase === "review" && scanResult ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
                  <div className="font-medium text-foreground">Detected</div>
                  <div className="text-muted-foreground">{scanResult.detectedProjectType}</div>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
                  <div className="font-medium text-foreground">Ports</div>
                  <div className="text-muted-foreground">
                    Dynamo assigns a stable port block per worktree to avoid conflicts.
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

              <div className="grid gap-2">
                <Label>Env files</Label>
                <RadioGroup
                  value={envStrategy}
                  onValueChange={(value) =>
                    onEnvStrategyChange(value as ProjectWorktreeSetupEnvStrategy)
                  }
                  className="grid gap-2"
                >
                  {(["symlink_root", "copy_root", "none"] as const).map((value) => (
                    <label key={value} className="flex items-center gap-2 text-sm">
                      <Radio value={value} />
                      <span>{envLabels[value]}</span>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
                <span>Run setup automatically when a worktree is created</span>
                <Switch
                  checked={autoRunSetupOnWorktreeCreate}
                  onCheckedChange={onAutoRunSetupOnWorktreeCreateChange}
                />
              </label>

              <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                Generated helpers are stored in Dynamo runtime data, not in your repository.
              </div>

              {scanResult.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <div className="mb-1 font-medium text-foreground">Warnings</div>
                  <ul className="space-y-1 text-muted-foreground">
                    {scanResult.warnings.map((warning) => (
                      <li key={warning.id}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {errorMessage ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
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
              Don't ask again
            </Button>
          </div>
          <Button onClick={onApply} disabled={phase !== "review" || !canApply}>
            Apply and continue
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
