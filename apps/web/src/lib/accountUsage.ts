import type { OrchestrationThreadActivity } from "@t3tools/contracts";

export type AccountRateLimitType =
  | "five_hour"
  | "seven_day"
  | "seven_day_opus"
  | "seven_day_sonnet"
  | "overage";

export type AccountRateLimitStatus = "allowed" | "allowed_warning" | "rejected" | string;

export interface AccountRateLimitSnapshot {
  readonly provider: AccountUsageProviderScope;
  readonly type: AccountRateLimitType | string;
  readonly label: string;
  readonly shortLabel: string;
  readonly status: AccountRateLimitStatus | null;
  readonly utilizationPercentage: number | null;
  readonly resetsAt: number | null;
  readonly overageStatus: AccountRateLimitStatus | null;
  readonly overageResetsAt: number | null;
  readonly overageDisabledReason: string | null;
  readonly isUsingOverage: boolean | null;
  readonly updatedAt: string;
}

export interface AccountUsageSnapshot {
  readonly primary: AccountRateLimitSnapshot;
  readonly limits: ReadonlyArray<AccountRateLimitSnapshot>;
  readonly updatedAt: string;
}

export type AccountUsageProviderScope = "codex" | "claudeAgent" | "cursor" | "opencode" | string;

export interface AccountUsageDerivationOptions {
  readonly provider?: AccountUsageProviderScope | null;
}

const RATE_LIMIT_ORDER: ReadonlyArray<AccountRateLimitType> = [
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "overage",
];

const RATE_LIMIT_LABELS: Record<AccountRateLimitType, { label: string; shortLabel: string }> = {
  five_hour: { label: "Five hour", shortLabel: "5h" },
  seven_day: { label: "Current week", shortLabel: "7d" },
  seven_day_opus: { label: "Weekly Opus", shortLabel: "Opus" },
  seven_day_sonnet: { label: "Weekly Sonnet", shortLabel: "Sonnet" },
  overage: { label: "Extra usage", shortLabel: "Extra" },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function labelsForType(type: string): { label: string; shortLabel: string } {
  return RATE_LIMIT_LABELS[type as AccountRateLimitType] ?? { label: type, shortLabel: type };
}

function normalizePercentage(value: unknown, source: string | null): number | null {
  const numericValue = asFiniteNumber(value);
  if (numericValue === null) {
    return null;
  }
  if (source === "claude-cli-tui-capture") {
    return Math.max(0, Math.min(100, numericValue));
  }
  const percentage = numericValue <= 1 ? numericValue * 100 : numericValue;
  return Math.max(0, Math.min(100, percentage));
}

function normalizeEpochMillis(value: unknown): number | null {
  const numericValue = asFiniteNumber(value);
  if (numericValue === null || numericValue <= 0) {
    return null;
  }
  return numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
}

function statusFromUsedPercentage(
  usedPercentage: number | null,
  rateLimitReachedType: string | null,
  type: AccountRateLimitType,
): AccountRateLimitStatus {
  if (
    rateLimitReachedType === type ||
    (type === "five_hour" && rateLimitReachedType === "primary") ||
    (type === "seven_day" && rateLimitReachedType === "secondary") ||
    (usedPercentage !== null && usedPercentage >= 100)
  ) {
    return "rejected";
  }
  if (usedPercentage !== null && usedPercentage >= 80) {
    return "allowed_warning";
  }
  return "allowed";
}

interface ExtractedRateLimitInfo {
  readonly info: Record<string, unknown>;
  readonly source: string | null;
}

function extractRateLimitInfo(payload: unknown): ExtractedRateLimitInfo | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const nestedRateLimits = asRecord(record.rateLimits);
  const nestedRateLimitsSource = asString(nestedRateLimits?.source);
  const nestedRateLimitInfo = asRecord(nestedRateLimits?.rate_limit_info);
  if (nestedRateLimitInfo) {
    return { info: nestedRateLimitInfo, source: nestedRateLimitsSource };
  }

  const nestedCamelInfo = asRecord(nestedRateLimits?.rateLimitInfo);
  if (nestedCamelInfo) {
    return { info: nestedCamelInfo, source: nestedRateLimitsSource };
  }

  const directSnakeInfo = asRecord(record.rate_limit_info);
  if (directSnakeInfo) {
    return { info: directSnakeInfo, source: asString(record.source) };
  }

  const directCamelInfo = asRecord(record.rateLimitInfo);
  if (directCamelInfo) {
    return { info: directCamelInfo, source: asString(record.source) };
  }

  return { info: record, source: asString(record.source) };
}

function rateLimitSnapshotFromActivity(
  activity: OrchestrationThreadActivity,
): AccountRateLimitSnapshot | null {
  const extracted = extractRateLimitInfo(activity.payload);
  if (!extracted) {
    return null;
  }

  const { info, source } = extracted;
  const type = asString(info.rateLimitType);
  if (!type) {
    return null;
  }

  const labels = labelsForType(type);
  return {
    provider: "claudeAgent",
    type,
    label: labels.label,
    shortLabel: labels.shortLabel,
    status: asString(info.status),
    utilizationPercentage: normalizePercentage(info.utilization, source),
    resetsAt: normalizeEpochMillis(info.resetsAt),
    overageStatus: asString(info.overageStatus),
    overageResetsAt: normalizeEpochMillis(info.overageResetsAt),
    overageDisabledReason: asString(info.overageDisabledReason),
    isUsingOverage: asBoolean(info.isUsingOverage),
    updatedAt: activity.createdAt,
  };
}

function codexRateLimitWindowSnapshot(input: {
  readonly type: AccountRateLimitType;
  readonly window: Record<string, unknown> | null;
  readonly rateLimitReachedType: string | null;
  readonly updatedAt: string;
}): AccountRateLimitSnapshot | null {
  if (!input.window) {
    return null;
  }
  const usedPercentage = normalizePercentage(input.window.usedPercent, "codex-app-server");
  if (usedPercentage === null) {
    return null;
  }
  const labels = labelsForType(input.type);
  return {
    provider: "codex",
    type: input.type,
    label: labels.label,
    shortLabel: labels.shortLabel,
    status: statusFromUsedPercentage(usedPercentage, input.rateLimitReachedType, input.type),
    utilizationPercentage: usedPercentage,
    resetsAt: normalizeEpochMillis(input.window.resetsAt),
    overageStatus: null,
    overageResetsAt: null,
    overageDisabledReason: null,
    isUsingOverage: null,
    updatedAt: input.updatedAt,
  };
}

function codexRateLimitSnapshotsFromActivity(
  activity: OrchestrationThreadActivity,
): ReadonlyArray<AccountRateLimitSnapshot> {
  const record = asRecord(activity.payload);
  if (!record) {
    return [];
  }
  const outerRateLimits = asRecord(record.rateLimits);
  const rateLimits = asRecord(outerRateLimits?.rateLimits) ?? outerRateLimits;
  if (!rateLimits) {
    return [];
  }

  const primary = asRecord(rateLimits.primary);
  const secondary = asRecord(rateLimits.secondary);
  if (!primary && !secondary) {
    return [];
  }

  const rateLimitReachedType = asString(rateLimits.rateLimitReachedType);
  return [
    codexRateLimitWindowSnapshot({
      type: "five_hour",
      window: primary,
      rateLimitReachedType,
      updatedAt: activity.createdAt,
    }),
    codexRateLimitWindowSnapshot({
      type: "seven_day",
      window: secondary,
      rateLimitReachedType,
      updatedAt: activity.createdAt,
    }),
  ].filter((snapshot): snapshot is AccountRateLimitSnapshot => snapshot !== null);
}

function rateLimitSnapshotsFromActivity(
  activity: OrchestrationThreadActivity,
): ReadonlyArray<AccountRateLimitSnapshot> {
  const codexSnapshots = codexRateLimitSnapshotsFromActivity(activity);
  if (codexSnapshots.length > 0) {
    return codexSnapshots;
  }
  const snapshot = rateLimitSnapshotFromActivity(activity);
  return snapshot ? [snapshot] : [];
}

function sortRateLimits(
  limits: ReadonlyArray<AccountRateLimitSnapshot>,
): ReadonlyArray<AccountRateLimitSnapshot> {
  return limits.toSorted((left, right) => {
    const leftIndex = RATE_LIMIT_ORDER.indexOf(left.type as AccountRateLimitType);
    const rightIndex = RATE_LIMIT_ORDER.indexOf(right.type as AccountRateLimitType);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight || left.label.localeCompare(right.label);
  });
}

export function deriveLatestAccountUsageSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  options: AccountUsageDerivationOptions = {},
): AccountUsageSnapshot | null {
  const latestByType = new Map<string, AccountRateLimitSnapshot>();
  const providerScope = options.provider ?? null;

  for (const activity of activities) {
    if (activity.kind !== "account.rate-limits.updated") {
      continue;
    }
    const snapshots = rateLimitSnapshotsFromActivity(activity);
    for (const snapshot of snapshots) {
      if (providerScope && snapshot.provider !== providerScope) {
        continue;
      }
      // Only displace an existing entry when the new one carries a utilization
      // percentage, so a Claude SDK status-only event (which lacks utilization
      // for low-usage sessions) cannot erase data we captured from the Claude
      // CLI usage screen.
      const existing = latestByType.get(snapshot.type);
      if (
        existing &&
        existing.utilizationPercentage !== null &&
        snapshot.utilizationPercentage === null
      ) {
        continue;
      }
      latestByType.set(snapshot.type, snapshot);
    }
  }

  const limits = sortRateLimits(
    [...latestByType.values()].filter((limit) => limit.utilizationPercentage !== null),
  );
  const primary =
    limits.find((limit) => limit.type === "five_hour") ?? (limits.length > 0 ? limits[0] : null);

  if (!primary) {
    return null;
  }

  return {
    primary,
    limits,
    updatedAt: limits.reduce(
      (latest, limit) => (limit.updatedAt > latest ? limit.updatedAt : latest),
      primary.updatedAt,
    ),
  };
}

export function formatAccountUsagePercentage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function formatAccountUsageReset(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const resetDate = new Date(value);
  if (Number.isNaN(resetDate.getTime())) {
    return null;
  }

  const now = new Date();
  const sameYear = resetDate.getFullYear() === now.getFullYear();
  const sameDay = resetDate.toDateString() === now.toDateString();
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(resetDate);

  if (sameDay) {
    return time;
  }

  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(resetDate);
  return `${date} at ${time}`;
}

export function formatAccountUsageStatus(limit: AccountRateLimitSnapshot): string {
  if (limit.type === "overage") {
    if (limit.isUsingOverage) {
      return "using extra usage";
    }
    if (limit.overageDisabledReason) {
      return "not enabled";
    }
    if (limit.overageStatus) {
      return limit.overageStatus.replaceAll("_", " ");
    }
  }
  return limit.status?.replaceAll("_", " ") ?? "unknown";
}
