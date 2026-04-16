import { describe, expect, it } from "vitest";

import {
  approximateTokenCount,
  countNonEmptyLines,
  isLikelyGeneratedSource,
  isSourceLikePath,
  shouldIgnoreCodeStatsPath,
} from "./codeStatsPolicy";

describe("codeStatsPolicy", () => {
  it("ignores generated and documentation paths", () => {
    expect(shouldIgnoreCodeStatsPath("node_modules/react/index.js")).toBe(true);
    expect(shouldIgnoreCodeStatsPath("docs/architecture.md")).toBe(true);
    expect(shouldIgnoreCodeStatsPath("src/__generated__/types.ts")).toBe(true);
    expect(shouldIgnoreCodeStatsPath("package-lock.json")).toBe(true);
  });

  it("detects authored source-like files across stacks", () => {
    expect(isSourceLikePath("apps/web/src/index.tsx")).toBe(true);
    expect(isSourceLikePath("backend/app/main.py")).toBe(true);
    expect(isSourceLikePath("app/Http/Kernel.php")).toBe(true);
    expect(isSourceLikePath("infra/Dockerfile")).toBe(true);
    expect(isSourceLikePath("README.md")).toBe(false);
  });

  it("detects generated file headers", () => {
    expect(isLikelyGeneratedSource("// @generated\nexport const x = 1;\n")).toBe(true);
    expect(isLikelyGeneratedSource("export const x = 1;\n")).toBe(false);
  });

  it("counts non-empty physical lines", () => {
    expect(countNonEmptyLines("a\n\n  \n b \n")).toBe(2);
  });

  it("approximates token counts", () => {
    expect(approximateTokenCount("const answer = 42;")).toBeGreaterThan(0);
  });
});
