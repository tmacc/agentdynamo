import { describe, expect, it } from "vitest";

import {
  parseFileBrowserRouteSearch,
  stripFileBrowserRouteSearchParams,
} from "./fileBrowserRouteSearch";

describe("parseFileBrowserRouteSearch", () => {
  it("parses valid file browser search values", () => {
    expect(parseFileBrowserRouteSearch({ files: "1", filePath: "src/App.tsx" })).toEqual({
      files: "1",
      filePath: "src/App.tsx",
    });
  });

  it("drops invalid toggle values and empty file paths", () => {
    expect(parseFileBrowserRouteSearch({ files: "true", filePath: "" })).toEqual({});
    expect(parseFileBrowserRouteSearch({ files: 1, filePath: ["README.md"] })).toEqual({});
  });

  it("preserves unrelated search params when stripping file browser state", () => {
    expect(
      stripFileBrowserRouteSearchParams({
        files: "1",
        filePath: "README.md",
        diff: "1",
        turn: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      turn: "turn-1",
    });
  });
});
