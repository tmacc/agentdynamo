import fsPromises from "node:fs/promises";

import type {
  ProjectIntelligenceSurfaceId,
  ProjectReadIntelligenceSurfaceResult,
} from "@t3tools/contracts";

import { redactJsonString } from "./settingsRedaction.ts";
import type { DiscoveredProjectIntelligenceSurface } from "./types.ts";

export const PROJECT_INTELLIGENCE_SURFACE_PREVIEW_MAX_BYTES = 64 * 1024;

async function readTextIfExists(targetPath: string): Promise<string | null> {
  try {
    return (await fsPromises.readFile(targetPath, "utf8"))
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

function truncateContent(content: string): {
  readonly content: string;
  readonly truncated: boolean;
} {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes <= PROJECT_INTELLIGENCE_SURFACE_PREVIEW_MAX_BYTES) {
    return { content, truncated: false };
  }
  return {
    content: Buffer.from(content, "utf8")
      .subarray(0, PROJECT_INTELLIGENCE_SURFACE_PREVIEW_MAX_BYTES)
      .toString("utf8"),
    truncated: true,
  };
}

export async function readDiscoveredSurface(input: {
  readonly surfaces: ReadonlyArray<DiscoveredProjectIntelligenceSurface>;
  readonly surfaceId: ProjectIntelligenceSurfaceId;
}): Promise<ProjectReadIntelligenceSurfaceResult | null> {
  const surface = input.surfaces.find((candidate) => candidate.summary.id === input.surfaceId);
  if (!surface) {
    return null;
  }

  if (surface.readTarget.mode === "virtual") {
    const truncated = truncateContent(surface.readTarget.content);
    return {
      surfaceId: input.surfaceId,
      contentType: surface.readTarget.contentType,
      content: truncated.content,
      truncated: truncated.truncated,
      maxBytes: PROJECT_INTELLIGENCE_SURFACE_PREVIEW_MAX_BYTES,
      ...(truncated.truncated
        ? { warning: "Surface content exceeded the preview size limit and was truncated." }
        : {}),
    };
  }

  const rawContent = await readTextIfExists(surface.readTarget.path);
  if (rawContent === null) {
    return null;
  }
  const content =
    surface.readTarget.kind === "settings" ? redactJsonString(rawContent) : rawContent;
  const truncated = truncateContent(content);
  return {
    surfaceId: input.surfaceId,
    contentType: surface.readTarget.contentType,
    content: truncated.content,
    truncated: truncated.truncated,
    maxBytes: PROJECT_INTELLIGENCE_SURFACE_PREVIEW_MAX_BYTES,
    ...(truncated.truncated
      ? { warning: "Surface content exceeded the preview size limit and was truncated." }
      : {}),
  };
}
