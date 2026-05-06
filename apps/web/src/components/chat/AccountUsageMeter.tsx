import {
  type AccountRateLimitSnapshot,
  type AccountUsageSnapshot,
  formatAccountUsagePercentage,
  formatAccountUsageReset,
  formatAccountUsageStatus,
} from "~/lib/accountUsage";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function limitFillClass(limit: AccountRateLimitSnapshot): string {
  if (limit.status === "rejected") {
    return "bg-destructive";
  }
  if (limit.status === "allowed_warning" || (limit.utilizationPercentage ?? 0) >= 80) {
    return "bg-amber-500";
  }
  return "bg-muted-foreground";
}

function AccountUsageBar(props: { limit: AccountRateLimitSnapshot; compact?: boolean }) {
  const normalizedPercentage = Math.max(0, Math.min(100, props.limit.utilizationPercentage ?? 0));

  return (
    <div
      className={cn("overflow-hidden rounded-full bg-muted/70", props.compact ? "h-1" : "h-1.5")}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
          limitFillClass(props.limit),
        )}
        style={{ width: `${normalizedPercentage}%` }}
      />
    </div>
  );
}

function AccountUsageRow(props: { limit: AccountRateLimitSnapshot }) {
  const reset = formatAccountUsageReset(
    props.limit.type === "overage" ? props.limit.overageResetsAt : props.limit.resetsAt,
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="font-medium text-foreground">{props.limit.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatAccountUsagePercentage(props.limit.utilizationPercentage)}
        </span>
      </div>
      <AccountUsageBar limit={props.limit} />
      <div className="flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
        <span>{formatAccountUsageStatus(props.limit)}</span>
        {reset ? <span className="whitespace-nowrap">resets {reset}</span> : null}
      </div>
    </div>
  );
}

export function AccountUsageMeter(props: { usage: AccountUsageSnapshot }) {
  const { primary } = props.usage;
  const percentage = formatAccountUsagePercentage(primary.utilizationPercentage);
  const ariaLabel = `Claude account usage ${primary.label} ${percentage} used`;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="group inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40"
            aria-label={ariaLabel}
          >
            <span className="font-medium text-foreground">{primary.shortLabel}</span>
            <span className="w-12 min-w-0">
              <AccountUsageBar limit={primary} compact />
            </span>
            <span className="tabular-nums">{percentage}</span>
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="bottom" align="start" className="w-64 max-w-none px-3 py-2">
        <div className="space-y-3 leading-tight">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Claude account usage
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Updates from Claude telemetry and optional post-turn CLI refreshes.
            </div>
          </div>
          <div className="space-y-2.5">
            {props.usage.limits.map((limit) => (
              <AccountUsageRow key={limit.type} limit={limit} />
            ))}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
