import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  PROTOTYPE_ASSETS_DIR,
  PROTOTYPE_FRAMES_DIR,
  PROTOTYPE_MANIFEST_FILENAME,
  PROTOTYPE_REFERENCE_DIR,
  PROTOTYPE_VIEWER_FILENAME,
  PrototypeManifest,
} from "./prototype.ts";

const decodeManifest = Schema.decodeUnknownSync(PrototypeManifest);

describe("PrototypeManifest", () => {
  it("decodes a single-frame page-canvas manifest", () => {
    const parsed = decodeManifest({
      version: 1,
      mode: "page-canvas",
      title: "Topbar redesign concept",
      source: {
        url: "http://localhost:5733/_chat/",
        referenceDir: ".reference",
        selector: ".thread-topbar",
      },
      canvas: {
        layout: "grid",
        initialZoom: 0.75,
      },
      frames: [
        {
          id: "option-a",
          title: "Compact controls",
          path: "frames/option-a.html",
          viewport: { width: 1440, height: 960 },
          type: "option",
        },
      ],
    });

    expect(parsed.version).toBe(1);
    expect(parsed.mode).toBe("page-canvas");
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0]?.path).toBe("frames/option-a.html");
  });

  it("decodes a multi-frame manifest using the locked output directories", () => {
    const parsed = decodeManifest({
      version: 1,
      mode: "page-canvas",
      title: "Settings onboarding flow",
      canvas: {
        layout: "flow",
      },
      frames: [
        {
          id: "welcome",
          title: "Welcome",
          path: "frames/welcome.html",
        },
        {
          id: "permissions",
          title: "Permissions",
          path: "frames/permissions.html",
          viewport: { width: 390, height: 844 },
          type: "screen",
        },
      ],
    });

    expect(PROTOTYPE_MANIFEST_FILENAME).toBe("prototype.json");
    expect(PROTOTYPE_VIEWER_FILENAME).toBe("index.html");
    expect(PROTOTYPE_REFERENCE_DIR).toBe(".reference");
    expect(PROTOTYPE_ASSETS_DIR).toBe("assets");
    expect(PROTOTYPE_FRAMES_DIR).toBe("frames");
    expect(parsed.canvas?.layout).toBe("flow");
    expect(parsed.frames.map((frame) => frame.id)).toEqual(["welcome", "permissions"]);
  });

  it("rejects manifests with missing frame ids or paths", () => {
    expect(() =>
      decodeManifest({
        version: 1,
        mode: "page-canvas",
        title: "Missing frame id",
        frames: [
          {
            title: "No id",
            path: "frames/no-id.html",
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      decodeManifest({
        version: 1,
        mode: "page-canvas",
        title: "Missing frame path",
        frames: [
          {
            id: "no-path",
            title: "No path",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects frame paths outside frames/*.html", () => {
    expect(() =>
      decodeManifest({
        version: 1,
        mode: "page-canvas",
        title: "Invalid frame path",
        frames: [
          {
            id: "option-a",
            title: "Option A",
            path: "option-a.html",
          },
        ],
      }),
    ).toThrow();
  });
});
