import { describe, expect, it } from "vitest";

import {
  approximateTokenCount,
  countNonEmptyLines,
  isLikelyGeneratedSource,
  isSourceLikePath,
  shouldIgnoreCodeStatsPath,
} from "./codeStatsPolicy.ts";

describe("codeStatsPolicy", () => {
  it("ignores generated and build paths", () => {
    expect(shouldIgnoreCodeStatsPath("node_modules/pkg/index.ts")).toBe(true);
    expect(shouldIgnoreCodeStatsPath("dist/app.js")).toBe(true);
    expect(shouldIgnoreCodeStatsPath("src/generated.gen.ts")).toBe(true);
    expect(shouldIgnoreCodeStatsPath("src/index.ts")).toBe(false);
  });

  it("detects source-like files and known source basenames", () => {
    expect(isSourceLikePath("src/App.tsx")).toBe(true);
    expect(isSourceLikePath("Dockerfile")).toBe(true);
    expect(isSourceLikePath("README.md")).toBe(false);
    expect(isSourceLikePath("src/app.generated.ts")).toBe(false);
  });

  it("counts non-empty LOC and approximates tokens", () => {
    expect(countNonEmptyLines("one\n\n two \n")).toBe(2);
    expect(approximateTokenCount("const answer = 42;")).toBeGreaterThan(0);
  });

  it("detects generated markers near the top of a file", () => {
    expect(isLikelyGeneratedSource("// @generated\nexport const x = 1;")).toBe(true);
    expect(isLikelyGeneratedSource("export const x = 1;")).toBe(false);
  });
});
