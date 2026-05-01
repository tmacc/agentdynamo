import { useMemo } from "react";

import { cn } from "~/lib/utils";
import {
  INSPECTOR_CATEGORY_COLOR_VAR,
  INSPECTOR_CATEGORY_LABELS,
  INSPECTOR_CATEGORY_ORDER,
  type InspectorCategoryId,
} from "../../projectIntelligencePresentation";

const TOTAL_DOTS = 200; // 0.5% per dot when MAX_TOKENS = 1M

export interface ContextInspectorDotGridProps {
  /**
   * Tokens per category from currently-enabled surfaces. Categories not in this
   * map (or with 0) contribute zero dots; the remainder fills as "free space."
   */
  readonly tokensPerCategory: Readonly<Record<InspectorCategoryId, number>>;
  /** Denominator for the percentage. Defaults to 1,000,000 (Opus 1M context). */
  readonly maxTokens?: number;
  readonly className?: string;
}

interface DotSpec {
  readonly key: number;
  readonly category: InspectorCategoryId | null; // null = free space
}

/**
 * Allocates 200 cells across categories using the largest-remainder method.
 * Stable order (by INSPECTOR_CATEGORY_ORDER) so toggling produces calm transitions.
 */
function allocateDots(
  tokensPerCategory: Readonly<Record<InspectorCategoryId, number>>,
  maxTokens: number,
): DotSpec[] {
  const fractions = INSPECTOR_CATEGORY_ORDER.map((id) => {
    const tokens = tokensPerCategory[id] ?? 0;
    const exact = (tokens / maxTokens) * TOTAL_DOTS;
    return { id, exact, base: Math.floor(exact), tokens };
  });
  let assigned = fractions.reduce((sum, f) => sum + f.base, 0);
  // Each non-zero category gets at least one dot if there's room. Skip 0-token cats.
  for (const f of fractions) {
    if (f.tokens > 0 && f.base === 0 && assigned < TOTAL_DOTS) {
      f.base = 1;
      assigned += 1;
    }
  }
  // Largest-remainder: distribute leftover dots up to the share of total used.
  const totalActiveTokens = fractions.reduce((sum, f) => sum + f.tokens, 0);
  const desiredUsed = Math.min(
    TOTAL_DOTS,
    Math.round((totalActiveTokens / maxTokens) * TOTAL_DOTS),
  );
  if (assigned < desiredUsed) {
    const remainders = fractions
      .map((f, idx) => ({ idx, frac: f.exact - f.base }))
      .toSorted((a, b) => b.frac - a.frac);
    let cursor = 0;
    while (assigned < desiredUsed && cursor < remainders.length) {
      const target = remainders[cursor];
      if (!target) break;
      fractions[target.idx]!.base += 1;
      assigned += 1;
      cursor += 1;
    }
  }
  // Trim if over (shouldn't happen given desiredUsed cap, defensive).
  while (assigned > TOTAL_DOTS) {
    const sorted = fractions
      .map((f, idx) => ({ idx, n: f.base }))
      .toSorted((a, b) => b.n - a.n);
    const top = sorted[0];
    if (!top || top.n <= 1) break;
    fractions[top.idx]!.base -= 1;
    assigned -= 1;
  }

  const dots: DotSpec[] = [];
  let key = 0;
  for (const f of fractions) {
    for (let i = 0; i < f.base; i++) dots.push({ key: key++, category: f.id });
  }
  while (dots.length < TOTAL_DOTS) dots.push({ key: key++, category: null });
  return dots;
}

export function ContextInspectorDotGrid({
  tokensPerCategory,
  maxTokens = 1_000_000,
  className,
}: ContextInspectorDotGridProps) {
  const dots = useMemo(
    () => allocateDots(tokensPerCategory, maxTokens),
    [tokensPerCategory, maxTokens],
  );

  return (
    <div
      className={cn(
        "grid gap-[2.5px]",
        // 25 cols × 8 rows = 200 cells, square at typical sidebar widths
        "grid-cols-[repeat(25,minmax(0,1fr))]",
        className,
      )}
      aria-hidden="true"
    >
      {dots.map((dot) => (
        <span
          key={dot.key}
          className="aspect-square rounded-[1px] transition-colors duration-300"
          style={{
            backgroundColor: dot.category
              ? INSPECTOR_CATEGORY_COLOR_VAR[dot.category]
              : "var(--inspector-cat-free)",
          }}
          title={dot.category ? INSPECTOR_CATEGORY_LABELS[dot.category] : "Free space"}
        />
      ))}
    </div>
  );
}
