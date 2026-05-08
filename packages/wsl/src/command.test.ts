import { describe, expect, it } from "vitest";

import {
  parseWslListQuietOutput,
  parseWslListVerboseOutput,
  resolveDefaultWslDistribution,
} from "./command.ts";

describe("WSL distribution parsing", () => {
  it("parses verbose WSL output with default marker, state, and version", () => {
    expect(
      parseWslListVerboseOutput(
        "NAME      STATE           VERSION\r\n* Ubuntu    Running         2\r\n  Debian    Stopped         1\r\n".replace(
          /./gu,
          (char) => `${char}\0`,
        ),
      ),
    ).toEqual([
      { name: "Ubuntu", isDefault: true, state: "running", version: 2 },
      { name: "Debian", isDefault: false, state: "stopped", version: 1 },
    ]);
  });

  it("falls back to quiet output with the first distro marked default", () => {
    expect(parseWslListQuietOutput("Ubuntu\nDebian\n")).toEqual([
      { name: "Ubuntu", isDefault: true, state: "unknown", version: null },
      { name: "Debian", isDefault: false, state: "unknown", version: null },
    ]);
  });

  it("prefers the default non-installing distro", () => {
    expect(
      resolveDefaultWslDistribution([
        { name: "Installing", isDefault: true, state: "installing", version: 2 },
        { name: "Ubuntu", isDefault: false, state: "running", version: 2 },
      ])?.name,
    ).toBe("Ubuntu");
  });
});
