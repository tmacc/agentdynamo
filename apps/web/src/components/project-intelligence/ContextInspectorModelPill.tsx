import { ChevronDownIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { cn } from "~/lib/utils";

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export interface ContextInspectorModelPillProps {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly maxTokens: number;
  readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** When true, renders as a non-interactive label. */
  readonly readOnly?: boolean;
}

export function ContextInspectorModelPill({
  providerLabel,
  modelLabel,
  maxTokens,
  onClick,
  readOnly,
}: ContextInspectorModelPillProps) {
  const content = (
    <>
      <span className="text-foreground/80">{providerLabel}</span>
      <span className="text-muted-foreground/50">·</span>
      <span className="text-foreground/90">{modelLabel}</span>
      <span className="text-muted-foreground/50">·</span>
      <span className="tabular-nums text-muted-foreground">
        {formatTokensCompact(maxTokens)} window
      </span>
    </>
  );

  const className = cn(
    "inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/60 px-2 py-px",
    "font-mono text-[10px] tracking-[0.02em]",
  );

  if (readOnly || !onClick) {
    return (
      <span className={className} aria-label={`Active model ${providerLabel} ${modelLabel}`}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        className,
        "transition-colors hover:bg-muted/40 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--inspector-accent-line)]",
      )}
      aria-label={`Switch model (currently ${providerLabel} ${modelLabel})`}
    >
      {content}
      <ChevronDownIcon className="size-2.5 text-muted-foreground/60" aria-hidden="true" />
    </button>
  );
}
