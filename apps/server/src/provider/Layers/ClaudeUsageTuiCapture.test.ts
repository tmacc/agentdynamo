import { Terminal } from "@xterm/headless";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  captureClaudeUsageTui,
  isClaudeUsageCommandPickerScreen,
  isClaudeUsageTuiScreen,
  parseClaudeUsageTuiRateLimits,
  readActiveScreen,
  trimTrailingBlankRows,
} from "./ClaudeUsageTuiCapture.ts";

describe("ClaudeUsageTuiCapture helpers", () => {
  describe("trimTrailingBlankRows", () => {
    it("removes trailing all-whitespace rows", () => {
      expect(trimTrailingBlankRows(["a", "b", "", "   "])).toEqual(["a", "b"]);
    });

    it("preserves blank rows in the middle of the buffer", () => {
      expect(trimTrailingBlankRows(["a", "", "b", "", ""])).toEqual(["a", "", "b"]);
    });

    it("returns an empty array for an all-blank buffer", () => {
      expect(trimTrailingBlankRows(["", "   ", ""])).toEqual([]);
    });

    it("leaves a non-blank-only buffer untouched", () => {
      expect(trimTrailingBlankRows(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    });
  });

  describe("readActiveScreen", () => {
    it("returns plain text rows from xterm-headless after writing data", async () => {
      const terminal = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
      await new Promise<void>((resolve) => {
        terminal.write("hello world\r\nsecond line\r\n", () => resolve());
      });
      const text = readActiveScreen(terminal);
      expect(text.split("\n")).toEqual(["hello world", "second line"]);
      terminal.dispose();
    });

    it("strips trailing blank rows", async () => {
      const terminal = new Terminal({ cols: 20, rows: 6, allowProposedApi: true });
      await new Promise<void>((resolve) => {
        terminal.write("only line\r\n", () => resolve());
      });
      expect(readActiveScreen(terminal)).toBe("only line");
      terminal.dispose();
    });
  });
});

describe("Claude /usage screen detection", () => {
  const commandPickerText = [
    "Claude Code v2.1.128",
    "",
    "────────────────────────────────────────────────────────────────",
    "❯ /usage",
    "────────────────────────────────────────────────────────────────",
    "/usage                                  Show session cost, plan usage, and activity stats",
    "/extra-usage                            Configure extra usage to keep working when limits are",
    "                                        hit",
    "/context                                Visualize current context usage as a colored grid",
    "/effort                                 Set effort level for model usage",
  ].join("\n");

  it("detects the slash-command picker as not being the usage screen", () => {
    expect(isClaudeUsageCommandPickerScreen(commandPickerText)).toBe(true);
    expect(isClaudeUsageTuiScreen(commandPickerText)).toBe(false);
  });

  it("detects the actual usage screen", () => {
    const usageScreen = [
      "Claude account usage",
      "Current session        30%",
      "Current week            4%",
    ].join("\n");

    expect(isClaudeUsageCommandPickerScreen(usageScreen)).toBe(false);
    expect(isClaudeUsageTuiScreen(usageScreen)).toBe(true);
  });
});

describe("parseClaudeUsageTuiRateLimits", () => {
  it("extracts known usage windows from labeled TUI rows", () => {
    const parsed = parseClaudeUsageTuiRateLimits(
      [
        "Claude account usage",
        "Current session        30%",
        "Current week            4%",
        "Current week (Opus only) 0%",
        "Current week (Sonnet only) 12.5%",
        "Extra usage             0%",
      ].join("\n"),
    );

    expect(parsed).toEqual([
      { status: "allowed", rateLimitType: "five_hour", utilization: 30, resetsAt: null },
      { status: "allowed", rateLimitType: "seven_day", utilization: 4, resetsAt: null },
      { status: "allowed", rateLimitType: "seven_day_opus", utilization: 0, resetsAt: null },
      {
        status: "allowed",
        rateLimitType: "seven_day_sonnet",
        utilization: 12.5,
        resetsAt: null,
      },
      { status: "allowed", rateLimitType: "overage", utilization: 0, resetsAt: null },
    ]);
  });

  it("extracts usage when labels and percentages are rendered on separate rows", () => {
    const parsed = parseClaudeUsageTuiRateLimits(
      [
        "Status   Config   Usage   Stats",
        "",
        "Session",
        "Total duration (wall): 3s",
        "",
        "Current session",
        "                                                     82% used",
        "Resets 4:10pm (America/New_York)",
        "",
        "Current week (all models)",
        "█████████                                          100% used",
        "Resets 8pm (America/New_York)",
        "",
        "Current week (Sonnet only)",
        "                                                     0% used",
        "Resets 8pm (America/New_York)",
      ].join("\n"),
    );

    expect(parsed).toEqual([
      {
        status: "allowed_warning",
        rateLimitType: "five_hour",
        utilization: 82,
        resetsAt: expect.any(Number),
      },
      { status: "rejected", rateLimitType: "seven_day", utilization: 100, resetsAt: null },
      { status: "allowed", rateLimitType: "seven_day_sonnet", utilization: 0, resetsAt: null },
    ]);
  });

  it("ignores unlabeled percentages instead of guessing", () => {
    expect(parseClaudeUsageTuiRateLimits("Tokens used 42%\nNo usage labels here")).toEqual([]);
  });
});

describe("captureClaudeUsageTui (integration)", () => {
  it.skipIf(!process.env.CLAUDE_BINARY_PATH)(
    "spawns the real claude CLI and captures the /usage screen",
    async () => {
      const cwd = path.resolve(__dirname, "../../..");
      const result = await captureClaudeUsageTui({
        binaryPath: process.env.CLAUDE_BINARY_PATH!,
        cwd,
        timeoutMs: 20_000,
      });

      // We don't assert specific layout because the CLI's `/usage` rendering
      // changes between releases. Just confirm we got recognizable content.
      if (!result.ok) {
        // Surface the failure reason for easier debugging when the test
        // environment can't reach a logged-in CLI.
        throw new Error(
          `Capture failed (${result.reason}): ${result.message}\nPartial:\n${result.partialText ?? ""}`,
        );
      }
      expect(result.text.length).toBeGreaterThan(0);
      expect(isClaudeUsageTuiScreen(result.text)).toBe(true);
    },
    30_000,
  );
});
