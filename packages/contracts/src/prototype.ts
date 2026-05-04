import { Schema } from "effect";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PROTOTYPE_MANIFEST_FILENAME = "prototype.json";
export const PROTOTYPE_VIEWER_FILENAME = "index.html";
export const PROTOTYPE_REFERENCE_DIR = ".reference";
export const PROTOTYPE_ASSETS_DIR = "assets";
export const PROTOTYPE_FRAMES_DIR = "frames";

export const PrototypeManifestVersion = Schema.Literal(1);
export type PrototypeManifestVersion = typeof PrototypeManifestVersion.Type;

export const PrototypeManifestMode = Schema.Literal("page-canvas");
export type PrototypeManifestMode = typeof PrototypeManifestMode.Type;

export const PrototypeCanvasLayout = Schema.Literals(["grid", "flow"]);
export type PrototypeCanvasLayout = typeof PrototypeCanvasLayout.Type;

export const PrototypeFramePath = TrimmedNonEmptyString.check(
  Schema.isPattern(/^frames\/(?!.*(?:^|\/)\.\.(?:\/|$))[^?#]+\.html$/),
);
export type PrototypeFramePath = typeof PrototypeFramePath.Type;

export const PrototypeSourceMetadata = Schema.Struct({
  url: Schema.optional(TrimmedNonEmptyString),
  referenceDir: Schema.optional(TrimmedNonEmptyString),
  selector: Schema.optional(TrimmedNonEmptyString),
});
export type PrototypeSourceMetadata = typeof PrototypeSourceMetadata.Type;

export const PrototypeCanvasSettings = Schema.Struct({
  layout: Schema.optional(PrototypeCanvasLayout),
  initialZoom: Schema.optional(
    Schema.Number.check(Schema.isGreaterThan(0)).check(Schema.isLessThanOrEqualTo(4)),
  ),
});
export type PrototypeCanvasSettings = typeof PrototypeCanvasSettings.Type;

export const PrototypeFrameViewport = Schema.Struct({
  width: PositiveInt,
  height: PositiveInt,
});
export type PrototypeFrameViewport = typeof PrototypeFrameViewport.Type;

export const PrototypeManifestFrame = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  path: PrototypeFramePath,
  viewport: Schema.optional(PrototypeFrameViewport),
  type: Schema.optional(TrimmedNonEmptyString),
});
export type PrototypeManifestFrame = typeof PrototypeManifestFrame.Type;

export const PrototypeManifest = Schema.Struct({
  version: PrototypeManifestVersion,
  mode: PrototypeManifestMode,
  title: TrimmedNonEmptyString,
  source: Schema.optional(PrototypeSourceMetadata),
  canvas: Schema.optional(PrototypeCanvasSettings),
  frames: Schema.Array(PrototypeManifestFrame).check(Schema.isMinLength(1)),
});
export type PrototypeManifest = typeof PrototypeManifest.Type;
