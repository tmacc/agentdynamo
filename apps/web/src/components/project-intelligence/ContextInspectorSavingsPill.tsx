import { cn } from "~/lib/utils";

export interface ContextInspectorSavingsPillProps {
  readonly savedTokens: number;
  readonly disabledCount: number;
  readonly maxTokens: number;
  readonly onRevert: () => void;
  readonly className?: string;
  /** Optional copy customization for the project view ("project default") vs thread view. */
  readonly revertLabel?: string;
}

function formatTokens(n: number): string {
  const r = Math.round(n);
  if (r >= 1_000_000) return `${(r / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (r >= 100_000) return `${(r / 1000).toFixed(0)}K`;
  if (r >= 1000) return `${(r / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(r);
}

function formatPct(p: number): string {
  if (p < 0.1) return "<0.1%";
  if (p < 10) return `${p.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(p)}%`;
}

export function ContextInspectorSavingsPill({
  savedTokens,
  disabledCount,
  maxTokens,
  onRevert,
  className,
  revertLabel = "Revert",
}: ContextInspectorSavingsPillProps) {
  if (disabledCount === 0) return null;
  const pct = (savedTokens / maxTokens) * 100;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5",
        "font-mono text-[10.5px] tracking-[0.02em]",
        className,
      )}
      style={{
        backgroundColor: "var(--inspector-accent-soft)",
        borderColor: "var(--inspector-accent-line)",
        color: "var(--inspector-accent)",
      }}
    >
      <span className="font-medium tabular-nums">
        −{formatTokens(savedTokens)} reclaimed
        <span className="ml-1.5 opacity-60">
          ({disabledCount} off · {formatPct(pct)})
        </span>
      </span>
      <button
        type="button"
        onClick={onRevert}
        className={cn(
          "rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em]",
          "border transition-colors hover:bg-[color:var(--inspector-accent-soft)]",
          "focus-visible:outline-none focus-visible:ring-2",
        )}
        style={{
          borderColor: "var(--inspector-accent-line)",
          color: "var(--inspector-accent)",
        }}
      >
        {revertLabel}
      </button>
    </div>
  );
}
