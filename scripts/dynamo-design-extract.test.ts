import { describe, expect, it } from "vitest";
import { getCaptureValidationError } from "./dynamo-design-extract.js";

const baseMeta = {
  url: "http://localhost:5733/",
  title: "Dynamo",
  viewport: { width: 1440, height: 1100, deviceScaleFactor: 1 },
  fonts: [],
  stylesheets: [],
  scripts: ["http://localhost:5733/@vite/client", "http://localhost:5733/src/main.tsx"],
  colors: {},
  bodyTextSample: "Thread title Start task",
  visibleElementCount: 4,
  appRoots: [
    {
      selector: "#root",
      tagName: "div",
      id: "root",
      boundingBox: {
        x: 0,
        y: 0,
        width: 1440,
        height: 1100,
        top: 0,
        right: 1440,
        bottom: 1100,
        left: 0,
      },
      childElementCount: 1,
      descendantElementCount: 12,
    },
  ],
  layoutRegions: [
    {
      selector: "body > main",
      tagName: "main",
      boundingBox: {
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
        top: 0,
        right: 1440,
        bottom: 900,
        left: 0,
      },
    },
  ],
};

describe("getCaptureValidationError", () => {
  it("accepts a rendered client app capture", () => {
    expect(getCaptureValidationError(baseMeta)).toBeUndefined();
  });

  it("rejects a blank client app root", () => {
    expect(
      getCaptureValidationError({
        ...baseMeta,
        bodyTextSample: "",
        visibleElementCount: 1,
        appRoots: [
          {
            ...baseMeta.appRoots[0]!,
            childElementCount: 0,
            descendantElementCount: 0,
          },
        ],
        layoutRegions: [],
      }),
    ).toContain("blank client-app root");
  });

  it("rejects a missing target selector", () => {
    expect(
      getCaptureValidationError({
        ...baseMeta,
        target: {
          selector: "header",
          matchCount: 0,
          matches: [],
        },
      }),
    ).toContain('Target selector "header"');
  });
});
