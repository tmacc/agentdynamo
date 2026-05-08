import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  clearTileRouteSearchParams,
  parseTileRouteSearch,
  parseTileThreadList,
  serializeTileRouteSearch,
} from "./tileRouteSearch";

const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");
const T1 = ThreadId.make("thread-1");
const T2 = ThreadId.make("thread-2");
const T3 = ThreadId.make("thread-3");

describe("parseTileRouteSearch", () => {
  it("returns empty when no threads provided", () => {
    expect(parseTileRouteSearch({})).toEqual({});
    expect(parseTileRouteSearch({ threads: "" })).toEqual({});
    expect(parseTileRouteSearch({ threads: "   " })).toEqual({});
  });

  it("parses a single thread key", () => {
    const parsed = parseTileRouteSearch({ threads: `${ENV_A}:${T1}` });
    expect(parsed.threads).toBe(`${ENV_A}:${T1}`);
    expect(parsed.focus).toBe(0);
  });

  it("parses a comma-separated list and roundtrips canonical form", () => {
    const parsed = parseTileRouteSearch({
      threads: `${ENV_A}:${T1},${ENV_A}:${T2},${ENV_B}:${T3}`,
      focus: "1",
    });
    expect(parsed.threads).toBe(`${ENV_A}:${T1},${ENV_A}:${T2},${ENV_B}:${T3}`);
    expect(parsed.focus).toBe(1);
  });

  it("de-duplicates thread keys preserving first occurrence order", () => {
    const parsed = parseTileRouteSearch({
      threads: `${ENV_A}:${T1},${ENV_A}:${T2},${ENV_A}:${T1}`,
    });
    expect(parsed.threads).toBe(`${ENV_A}:${T1},${ENV_A}:${T2}`);
  });

  it("skips invalid thread keys silently", () => {
    const parsed = parseTileRouteSearch({
      threads: `${ENV_A}:${T1},not-a-key,bad:,:bad,${ENV_B}:${T2}`,
    });
    expect(parsed.threads).toBe(`${ENV_A}:${T1},${ENV_B}:${T2}`);
  });

  it("clamps focus to valid range", () => {
    const parsedHigh = parseTileRouteSearch({
      threads: `${ENV_A}:${T1},${ENV_A}:${T2}`,
      focus: "99",
    });
    expect(parsedHigh.focus).toBe(1);

    const parsedNeg = parseTileRouteSearch({
      threads: `${ENV_A}:${T1},${ENV_A}:${T2}`,
      focus: "-5",
    });
    expect(parsedNeg.focus).toBe(0);
  });

  it("defaults focus to 0 when missing or invalid", () => {
    const parsedMissing = parseTileRouteSearch({ threads: `${ENV_A}:${T1}` });
    expect(parsedMissing.focus).toBe(0);

    const parsedNan = parseTileRouteSearch({
      threads: `${ENV_A}:${T1}`,
      focus: "abc",
    });
    expect(parsedNan.focus).toBe(0);
  });

  it("accepts numeric focus values", () => {
    const parsed = parseTileRouteSearch({
      threads: `${ENV_A}:${T1},${ENV_A}:${T2}`,
      focus: 1,
    });
    expect(parsed.focus).toBe(1);
  });
});

describe("parseTileThreadList", () => {
  it("returns refs for each entry", () => {
    expect(parseTileThreadList(`${ENV_A}:${T1},${ENV_B}:${T2}`)).toEqual([
      { environmentId: ENV_A, threadId: T1 },
      { environmentId: ENV_B, threadId: T2 },
    ]);
  });

  it("handles empty input", () => {
    expect(parseTileThreadList("")).toEqual([]);
    expect(parseTileThreadList(undefined)).toEqual([]);
  });
});

describe("serializeTileRouteSearch", () => {
  it("serializes a single tile", () => {
    const serialized = serializeTileRouteSearch({
      tiles: [{ environmentId: ENV_A, threadId: T1 }],
      focusedIndex: 0,
    });
    expect(serialized).toEqual({ threads: `${ENV_A}:${T1}`, focus: 0 });
  });

  it("serializes multiple tiles in order", () => {
    const serialized = serializeTileRouteSearch({
      tiles: [
        { environmentId: ENV_A, threadId: T1 },
        { environmentId: ENV_B, threadId: T2 },
      ],
      focusedIndex: 1,
    });
    expect(serialized).toEqual({
      threads: `${ENV_A}:${T1},${ENV_B}:${T2}`,
      focus: 1,
    });
  });

  it("clamps focusedIndex when serializing", () => {
    const serialized = serializeTileRouteSearch({
      tiles: [{ environmentId: ENV_A, threadId: T1 }],
      focusedIndex: 5,
    });
    expect(serialized.focus).toBe(0);
  });
});

describe("parseTileRouteSearch + serializeTileRouteSearch roundtrip", () => {
  it("roundtrips lossless", () => {
    const original = {
      tiles: [
        { environmentId: ENV_A, threadId: T1 },
        { environmentId: ENV_A, threadId: T2 },
        { environmentId: ENV_B, threadId: T3 },
      ],
      focusedIndex: 2,
    };
    const serialized = serializeTileRouteSearch(original);
    const reparsed = parseTileRouteSearch(serialized as unknown as Record<string, unknown>);
    expect(reparsed.threads).toBe(serialized.threads);
    expect(reparsed.focus).toBe(serialized.focus);
  });
});

describe("clearTileRouteSearchParams", () => {
  it("strips threads and focus", () => {
    const cleared = clearTileRouteSearchParams({
      threads: `${ENV_A}:${T1}`,
      focus: 0,
      otherParam: "keep-me",
    });
    expect(cleared.threads).toBeUndefined();
    expect(cleared.focus).toBeUndefined();
    expect(cleared.otherParam).toBe("keep-me");
  });
});
