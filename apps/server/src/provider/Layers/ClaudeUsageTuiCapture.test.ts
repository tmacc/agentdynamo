import { Terminal } from "@xterm/headless";
import { execSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  captureClaudeUsageTui,
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
      { status: "allowed", rateLimitType: "five_hour", utilization: 30 },
      { status: "allowed", rateLimitType: "seven_day", utilization: 4 },
      { status: "allowed", rateLimitType: "seven_day_opus", utilization: 0 },
      { status: "allowed", rateLimitType: "seven_day_sonnet", utilization: 12.5 },
      { status: "allowed", rateLimitType: "overage", utilization: 0 },
    ]);
  });

  it("ignores unlabeled percentages instead of guessing", () => {
    expect(parseClaudeUsageTuiRateLimits("Tokens used 42%\nNo usage labels here")).toEqual([]);
  });
});

const claudeBinaryPath = (() => {
  try {
    return execSync("which claude", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
})();

const describeIfClaudeAvailable = claudeBinaryPath ? describe : describe.skip;

describeIfClaudeAvailable("captureClaudeUsageTui (integration)", () => {
  it("spawns the real claude CLI and captures the /usage screen", async () => {
    const cwd = path.resolve(__dirname, "../../..");
    const result = await captureClaudeUsageTui({
      binaryPath: claudeBinaryPath,
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
    expect(result.text.toLowerCase()).toMatch(
      /current\s+(session|week)|five[- ]?hour|of your usage|extra[- ]usage|esc to cancel/,
    );
  }, 30_000);
});
