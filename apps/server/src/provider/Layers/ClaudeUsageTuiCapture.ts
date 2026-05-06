/**
 * ClaudeUsageTuiCapture - spawn the official Claude Code CLI binary, send the
 * `/usage` slash command, capture the rendered TUI screen, and return it as
 * plain text suitable for our preformatted chat renderer.
 *
 * Why a fresh PTY rather than the existing Claude Agent SDK session: the
 * `/usage` overlay is part of the interactive TUI and is never emitted through
 * stream-json mode (the SDK's transport). The official CLI is the only thing
 * that knows how to render it, so we spawn it ourselves, drive the keystrokes,
 * and read the resulting screen via a headless terminal emulator so cursor
 * positioning and redraws resolve to the same text the user would see in their
 * own terminal.
 *
 * This stays inside the "first-party usage" pattern Anthropic has signaled is
 * permitted: the actual subscription request is made by the spawned `claude`
 * process itself, with its real telemetry, headers, and OAuth handling. We
 * only read the rendered output.
 *
 * @module ClaudeUsageTuiCapture
 */
import { createRequire } from "node:module";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

const requireFromHere = createRequire(import.meta.url);
const { Terminal } = requireFromHere("@xterm/headless") as {
  readonly Terminal: new (options: {
    readonly cols: number;
    readonly rows: number;
    readonly allowProposedApi?: boolean;
    readonly scrollback?: number;
  }) => HeadlessTerminal;
};

const DEFAULT_TUI_COLS = 100;
const DEFAULT_TUI_ROWS = 40;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_OUTPUT_IDLE_MS = 200;
const READY_WITH_USAGE_IDLE_MS = 120;
const DEFAULT_USAGE_MARKER_REGEX =
  /claude\s+account\s+usage|current\s+(session|week)|five[- ]?hour\s+(limit|usage)|seven[- ]?day\s+(limit|usage)|rate\s+limit\s+usage/i;
const CLAUDE_USAGE_COMMAND_PICKER_REGEX =
  /(?:^|\n)\s*\/usage\s+Show session cost, plan usage, and activity stats/i;
const CLAUDE_COMMAND_PICKER_SIBLING_REGEX = /(?:^|\n)\s*\/(?:stats|extra-usage|context|effort)\b/i;

const USAGE_LINE_PERCENTAGE_REGEX = /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*%/;

const RATE_LIMIT_PATTERNS = [
  {
    rateLimitType: "seven_day_opus",
    pattern: /\bopus\b/i,
  },
  {
    rateLimitType: "seven_day_sonnet",
    pattern: /\bsonnet\b/i,
  },
  {
    rateLimitType: "five_hour",
    pattern: /five[-\s]?hour|\b5h\b|current\s+session|\bsession\b/i,
  },
  {
    rateLimitType: "seven_day",
    pattern: /seven[-\s]?day|\b7d\b|current\s+week|weekly|week/i,
  },
  {
    rateLimitType: "overage",
    pattern: /extra[-\s]?usage|overage/i,
  },
] as const;

export interface CaptureClaudeUsageTuiOptions {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cols?: number;
  readonly rows?: number;
  readonly timeoutMs?: number;
  readonly outputIdleMs?: number;
  readonly usageMarkerRegex?: RegExp;
  readonly extraArgs?: ReadonlyArray<string>;
}

export interface ClaudeUsageTuiSuccess {
  readonly ok: true;
  readonly text: string;
  readonly capturedAtMs: number;
  readonly rateLimits: ReadonlyArray<ClaudeUsageTuiRateLimitInfo>;
}

export interface ClaudeUsageTuiFailure {
  readonly ok: false;
  readonly reason: "spawn-failed" | "timeout" | "no-marker" | "no-output";
  readonly message: string;
  readonly partialText?: string;
}

export type ClaudeUsageTuiResult = ClaudeUsageTuiSuccess | ClaudeUsageTuiFailure;

export interface ClaudeUsageTuiRateLimitInfo {
  readonly status: "allowed" | "allowed_warning" | "rejected";
  readonly rateLimitType: string;
  readonly utilization: number;
  readonly resetsAt: number | null;
}

/**
 * Strip trailing rows that are completely whitespace, then strip a single
 * trailing newline if the buffer has one. Cosmetic only - keeps the rendered
 * chat output tight without dropping intentional blank lines inside the TUI.
 */
export function trimTrailingBlankRows(rows: ReadonlyArray<string>): Array<string> {
  let lastNonBlank = rows.length - 1;
  while (lastNonBlank >= 0 && rows[lastNonBlank]?.trim().length === 0) {
    lastNonBlank--;
  }
  return rows.slice(0, lastNonBlank + 1);
}

export function readActiveScreen(terminal: HeadlessTerminal): string {
  const rows: Array<string> = [];
  const buffer = terminal.buffer.active;
  for (let y = 0; y < terminal.rows; y++) {
    const line = buffer.getLine(buffer.viewportY + y);
    rows.push(line?.translateToString(true) ?? "");
  }
  return trimTrailingBlankRows(rows).join("\n");
}

export function isClaudeUsageCommandPickerScreen(text: string): boolean {
  return (
    CLAUDE_USAGE_COMMAND_PICKER_REGEX.test(text) && CLAUDE_COMMAND_PICKER_SIBLING_REGEX.test(text)
  );
}

export function isClaudeUsageTuiScreen(
  text: string,
  marker: RegExp = DEFAULT_USAGE_MARKER_REGEX,
): boolean {
  return !isClaudeUsageCommandPickerScreen(text) && marker.test(text);
}

function rateLimitTypeFromLine(line: string): string | null {
  for (const candidate of RATE_LIMIT_PATTERNS) {
    if (candidate.pattern.test(line)) {
      return candidate.rateLimitType;
    }
  }
  return null;
}

function utilizationFromLine(line: string): number | null {
  const match = line.match(USAGE_LINE_PERCENTAGE_REGEX);
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function statusFromUtilization(utilization: number): ClaudeUsageTuiRateLimitInfo["status"] {
  if (utilization >= 100) {
    return "rejected";
  }
  if (utilization >= 80) {
    return "allowed_warning";
  }
  return "allowed";
}

const RESET_TIME_REGEX = /\bresets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?/i;

function timezoneOffsetMillis(timeZone: string, instant: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(instant);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    );
    return asUtc - instant.getTime();
  } catch {
    return 0;
  }
}

function zonedWallClockToEpochMillis(input: {
  readonly timeZone: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}): number | null {
  const naiveUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0);
  let candidate = naiveUtc - timezoneOffsetMillis(input.timeZone, new Date(naiveUtc));
  candidate = naiveUtc - timezoneOffsetMillis(input.timeZone, new Date(candidate));
  return Number.isFinite(candidate) ? candidate : null;
}

function zonedDateParts(
  timeZone: string,
  instant: Date,
): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return { year: value("year"), month: value("month"), day: value("day") };
  } catch {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
    };
  }
}

function parseResetTime(line: string, rateLimitType: string): number | null {
  if (rateLimitType !== "five_hour") {
    return null;
  }
  const match = line.match(RESET_TIME_REGEX);
  if (!match?.[1] || !match[3]) {
    return null;
  }
  const timezone = match[4]?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3].toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  hour %= 12;
  if (meridiem === "pm") {
    hour += 12;
  }

  const now = new Date();
  const today = zonedDateParts(timezone, now);
  const todayReset = zonedWallClockToEpochMillis({ timeZone: timezone, ...today, hour, minute });
  if (todayReset !== null && todayReset > now.getTime()) {
    return todayReset;
  }
  const tomorrow = zonedDateParts(timezone, new Date(now.getTime() + 24 * 60 * 60 * 1000));
  return zonedWallClockToEpochMillis({ timeZone: timezone, ...tomorrow, hour, minute });
}

/**
 * Best-effort parser for Claude's human `/usage` TUI. It intentionally keys on
 * broad semantic labels plus percentages instead of box coordinates or exact
 * wording, so small CLI layout changes do not break the toolbar meter. If a
 * future CLI stops rendering recognizable labels, callers simply get an empty
 * list and keep the previous durable usage snapshot.
 */
export function parseClaudeUsageTuiRateLimits(
  text: string,
): ReadonlyArray<ClaudeUsageTuiRateLimitInfo> {
  const latestByType = new Map<string, ClaudeUsageTuiRateLimitInfo>();
  let pendingRateLimitType: string | null = null;
  let pendingResetType: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replaceAll(/[│┃║╎╏]/g, " ").trim();
    if (line.length === 0) {
      continue;
    }
    if (pendingResetType && RESET_TIME_REGEX.test(line)) {
      const existing = latestByType.get(pendingResetType);
      if (existing) {
        latestByType.set(pendingResetType, {
          ...existing,
          resetsAt: parseResetTime(line, pendingResetType),
        });
      }
      pendingResetType = null;
      continue;
    }
    const lineRateLimitType = rateLimitTypeFromLine(line);
    const rateLimitType = lineRateLimitType ?? pendingRateLimitType;
    if (lineRateLimitType) {
      pendingRateLimitType = lineRateLimitType;
    }
    if (!rateLimitType) {
      continue;
    }
    const utilization = utilizationFromLine(line);
    if (utilization === null) {
      continue;
    }
    latestByType.set(rateLimitType, {
      status: statusFromUtilization(utilization),
      rateLimitType,
      utilization,
      resetsAt: null,
    });
    pendingRateLimitType = null;
    pendingResetType = rateLimitType;
  }

  return [...latestByType.values()];
}

interface NodePtyModule {
  spawn: (
    file: string,
    args: ReadonlyArray<string>,
    options: {
      readonly name?: string;
      readonly cols?: number;
      readonly rows?: number;
      readonly cwd?: string;
      readonly env?: NodeJS.ProcessEnv;
    },
  ) => {
    readonly pid: number;
    write: (data: string) => void;
    kill: (signal?: string) => void;
    onData: (cb: (data: string) => void) => { dispose(): void };
    onExit: (cb: (event: { exitCode: number; signal?: number }) => void) => {
      dispose(): void;
    };
  };
}

let cachedNodePty: NodePtyModule | null = null;
async function loadNodePty(): Promise<NodePtyModule> {
  if (cachedNodePty) return cachedNodePty;
  // node-pty ships native code; load it the same way the existing terminal
  // layer does so we share the spawn-helper resolution path.
  cachedNodePty = requireFromHere("node-pty") as NodePtyModule;
  return cachedNodePty;
}

/**
 * Spawn `claude`, send `/usage`, wait for the TUI overlay to stabilize, and
 * return the rendered screen text. Always tears down the spawned process,
 * even on timeout.
 */
export async function captureClaudeUsageTui(
  options: CaptureClaudeUsageTuiOptions,
): Promise<ClaudeUsageTuiResult> {
  const cols = options.cols ?? DEFAULT_TUI_COLS;
  const rows = options.rows ?? DEFAULT_TUI_ROWS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idleMs = options.outputIdleMs ?? DEFAULT_OUTPUT_IDLE_MS;
  const marker = options.usageMarkerRegex ?? DEFAULT_USAGE_MARKER_REGEX;

  let nodePty: NodePtyModule;
  try {
    nodePty = await loadNodePty();
  } catch (cause) {
    return {
      ok: false,
      reason: "spawn-failed",
      message: cause instanceof Error ? cause.message : "Failed to load node-pty.",
    };
  }

  const args = [
    "--add-dir",
    options.cwd,
    "--dangerously-skip-permissions",
    ...(options.extraArgs ?? []),
  ];

  let pty: ReturnType<NodePtyModule["spawn"]>;
  try {
    pty = nodePty.spawn(options.binaryPath, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        // Stop the SDK detector from rejecting this nested invocation when we
        // happen to be running inside a Claude Code session ourselves.
        CLAUDECODE: "",
      },
    });
  } catch (cause) {
    return {
      ok: false,
      reason: "spawn-failed",
      message: cause instanceof Error ? cause.message : "Failed to spawn claude binary.",
    };
  }

  const terminal = new Terminal({
    cols,
    rows,
    allowProposedApi: true,
    scrollback: 0,
  });

  let lastDataAtMs = Date.now();
  let totalBytes = 0;
  let sawMarker = false;
  let usageSent = false;
  let commandPickerConfirmed = false;
  let resolved = false;

  return await new Promise<ClaudeUsageTuiResult>((resolve) => {
    const finish = (result: ClaudeUsageTuiResult) => {
      if (resolved) return;
      resolved = true;
      clearInterval(interval);
      try {
        // Send Ctrl+C then Ctrl+D so the TUI exits cleanly when possible.
        pty.write("\x03");
        pty.write("\x04");
      } catch {
        // Process already dying.
      }
      try {
        pty.kill();
      } catch {
        // Already gone.
      }
      try {
        terminal.dispose();
      } catch {
        // Best-effort cleanup.
      }
      resolve(result);
    };

    pty.onData((chunk) => {
      lastDataAtMs = Date.now();
      totalBytes += chunk.length;
      terminal.write(chunk);
    });

    pty.onExit(() => {
      if (resolved) return;
      // CLI exited before we got the marker - still surface what we have.
      const text = readActiveScreen(terminal);
      finish(
        sawMarker
          ? {
              ok: true,
              text,
              capturedAtMs: Date.now(),
              rateLimits: parseClaudeUsageTuiRateLimits(text),
            }
          : {
              ok: false,
              reason: text.trim().length === 0 ? "no-output" : "no-marker",
              message:
                text.trim().length === 0
                  ? "Claude CLI exited without producing any output."
                  : "Claude CLI exited before the /usage screen was visible.",
              partialText: text,
            },
      );
    });

    const startedAt = Date.now();
    const sendUsageOnceReady = () => {
      if (usageSent) return;
      // Wait for either the prompt indicator to land or for ~1.2s of warmup
      // before pushing the slash command. Pushing too early gets buffered into
      // the welcome screen rather than processed as a slash command.
      if (totalBytes < 200 && Date.now() - startedAt < 1200) return;
      usageSent = true;
      try {
        pty.write("/usage\r");
      } catch {
        // Process already dying - exit handler will resolve.
      }
    };

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - startedAt >= timeoutMs) {
        const text = readActiveScreen(terminal);
        finish({
          ok: false,
          reason: "timeout",
          message: `Claude /usage capture timed out after ${timeoutMs}ms.`,
          partialText: text,
        });
        return;
      }
      sendUsageOnceReady();
      const text = readActiveScreen(terminal);
      if (usageSent && !commandPickerConfirmed && isClaudeUsageCommandPickerScreen(text)) {
        commandPickerConfirmed = true;
        try {
          // Recent Claude Code versions can stop on the slash-command picker
          // after `/usage`. A second Enter commits the highlighted /usage item.
          pty.write("\r");
        } catch {
          // Process already dying - exit handler will resolve.
        }
        return;
      }
      if (!sawMarker && isClaudeUsageTuiScreen(text, marker)) {
        sawMarker = true;
      }
      const parsedRateLimits = sawMarker ? parseClaudeUsageTuiRateLimits(text) : [];
      if (
        usageSent &&
        sawMarker &&
        now - lastDataAtMs >= (parsedRateLimits.length > 0 ? READY_WITH_USAGE_IDLE_MS : idleMs) &&
        terminal.buffer.active.length > 0
      ) {
        finish({
          ok: true,
          text,
          capturedAtMs: now,
          rateLimits: parsedRateLimits,
        });
      }
    }, 50);
  });
}
