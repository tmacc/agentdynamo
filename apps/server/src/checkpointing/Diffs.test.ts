import { describe, expect, it } from "vitest";

import { parseTurnDiffFilesFromNumstat } from "./Diffs.ts";

describe("parseTurnDiffFilesFromNumstat", () => {
  it("returns empty list for empty numstat", () => {
    expect(parseTurnDiffFilesFromNumstat("")).toEqual([]);
  });

  it("parses regular modified files", () => {
    expect(parseTurnDiffFilesFromNumstat("2\t1\ta.txt\0")).toEqual([
      { path: "a.txt", additions: 2, deletions: 1 },
    ]);
  });

  it("sorts multiple files by path", () => {
    const numstat = ["0\t2\tz.ts", "3\t1\ta.ts", ""].join("\0");

    expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
      { path: "a.ts", additions: 3, deletions: 1 },
      { path: "z.ts", additions: 0, deletions: 2 },
    ]);
  });

  it("parses binary files as zero line changes", () => {
    expect(parseTurnDiffFilesFromNumstat("-\t-\tasset.bin\0")).toEqual([
      { path: "asset.bin", additions: 0, deletions: 0 },
    ]);
  });

  it("uses the destination path for rename records", () => {
    expect(parseTurnDiffFilesFromNumstat("1\t0\t\0old.ts\0new.ts\0")).toEqual([
      { path: "new.ts", additions: 1, deletions: 0 },
    ]);
  });

  it("preserves paths with spaces, arrows, braces, and tabs", () => {
    const numstat = [
      "1\t0\tname with spaces.ts",
      "2\t0\tnew => still tricky.ts",
      "3\t0\tsrc/{newbrace}.ts",
      "4\t0\ttab\tname.ts",
      "",
    ].join("\0");

    expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
      { path: "name with spaces.ts", additions: 1, deletions: 0 },
      { path: "new => still tricky.ts", additions: 2, deletions: 0 },
      { path: "src/{newbrace}.ts", additions: 3, deletions: 0 },
      { path: "tab\tname.ts", additions: 4, deletions: 0 },
    ]);
  });

  it("preserves unusual destination paths on rename records", () => {
    const numstat = [
      "1\t0\t",
      "old => tricky.ts",
      "new => still tricky.ts",
      "2\t0\t",
      "src/{oldbrace}.ts",
      "src/{newbrace}.ts",
      "3\t0\t",
      "tab\told.ts",
      "tab\tnew.ts",
      "",
    ].join("\0");

    expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
      { path: "new => still tricky.ts", additions: 1, deletions: 0 },
      { path: "src/{newbrace}.ts", additions: 2, deletions: 0 },
      { path: "tab\tnew.ts", additions: 3, deletions: 0 },
    ]);
  });

  it("ignores malformed records", () => {
    const numstat = [
      "not-a-record",
      "x\t1\tbad-count.ts",
      "1\tx\tbad-count.ts",
      "2\t1\tvalid.ts",
      "1\t0\t",
      "old-without-destination.ts",
      "",
    ].join("\0");

    expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
      { path: "valid.ts", additions: 2, deletions: 1 },
    ]);
  });
});
