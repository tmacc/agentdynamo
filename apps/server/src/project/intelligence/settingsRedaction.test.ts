import { describe, expect, it } from "vitest";

import { redactJsonString, redactSettingsValue } from "./settingsRedaction.ts";

describe("settingsRedaction", () => {
  it("redacts nested secret-like keys", () => {
    expect(
      redactSettingsValue({
        auth: {
          api_key: "abc",
          privateKey: "def",
          nested: { token: "ghi" },
        },
        normal: "visible",
      }),
    ).toEqual({
      auth: {
        api_key: "[redacted]",
        privateKey: "[redacted]",
        nested: { token: "[redacted]" },
      },
      normal: "visible",
    });
  });

  it("redacts non-boolean env values but keeps feature flags", () => {
    expect(
      redactSettingsValue({
        env: {
          SECRET_VALUE: "abc",
          FEATURE_ENABLED: "true",
          FLAG_ZERO: "0",
          DEBUG: true,
        },
      }),
    ).toEqual({
      env: {
        SECRET_VALUE: "[redacted]",
        FEATURE_ENABLED: "true",
        FLAG_ZERO: "0",
        DEBUG: true,
      },
    });
  });

  it("redacts JSON strings when parsing succeeds", () => {
    expect(redactJsonString('{"password":"abc","env":{"NODE_ENV":"development"}}')).toContain(
      '"password": "[redacted]"',
    );
    expect(redactJsonString("not json")).toBe("not json");
  });
});
