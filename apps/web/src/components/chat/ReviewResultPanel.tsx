import type { ReviewFinding, ReviewState } from "@t3tools/contracts";
import { memo, useMemo } from "react";

import { cn } from "../../lib/utils";

function groupByFile(findings: ReadonlyArray<ReviewFinding>) {
  const groups = new Map<string, ReviewFinding[]>();
  for (const finding of findings) {
    const existing = groups.get(finding.file) ?? [];
    existing.push(finding);
    groups.set(finding.file, existing);
  }
  return [...groups.entries()].map(([file, fileFindings]) => ({
    file,
    findings: fileFindings.toSorted((left, right) => left.lineStart - right.lineStart),
  }));
}

function statusText(review: ReviewState): string {
  switch (review.status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function severityClass(severity: ReviewFinding["severity"]): string {
  switch (severity) {
    case "high":
      return "bg-red-500";
    case "medium":
      return "bg-amber-500";
    case "low":
      return "bg-sky-500";
  }
}

export const ReviewResultPanel = memo(function ReviewResultPanel({
  review,
}: {
  readonly review: ReviewState | null | undefined;
}) {
  const groups = useMemo(() => groupByFile(review?.findings ?? []), [review?.findings]);
  if (!review) return null;

  return (
    <section className="mx-3 mb-2 rounded-md border border-border bg-card/70 px-3 py-2 text-sm sm:mx-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2">
        <div className="min-w-0">
          <div className="font-medium text-foreground">Code review</div>
          <div className="truncate text-muted-foreground text-xs">
            {review.label ?? "Provider review"} {review.prNumber ? `- PR #${review.prNumber}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span>{statusText(review)}</span>
          <span>{review.findings.length} verified</span>
          {review.droppedFindingCount > 0 ? (
            <span>{review.droppedFindingCount} dropped</span>
          ) : null}
        </div>
      </div>

      {review.errorText ? (
        <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive text-xs">
          {review.errorText}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="py-3 text-muted-foreground text-xs">
          {review.status === "completed"
            ? "No verified findings."
            : "Review agents are checking the PR."}
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          {groups.map((group) => (
            <div key={group.file}>
              <div className="mb-1 font-mono text-muted-foreground text-xs">{group.file}</div>
              <div className="space-y-1.5">
                {group.findings.map((finding) => (
                  <details
                    key={finding.id}
                    className="rounded border border-border/80 bg-background/60 px-2 py-1.5"
                  >
                    <summary className="flex cursor-pointer list-none items-start gap-2">
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          severityClass(finding.severity),
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-foreground">{finding.summary}</span>
                        <span className="text-muted-foreground text-xs">
                          {finding.lineStart}
                          {finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ""} -{" "}
                          {finding.kind}
                        </span>
                      </span>
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap border-t border-border/60 pt-2 text-muted-foreground text-xs">
                      {finding.evidence || finding.verifier?.evidence || finding.reasoning}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
