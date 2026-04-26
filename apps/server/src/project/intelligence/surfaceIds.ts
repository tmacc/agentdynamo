import { createHash } from "node:crypto";

import type { ProjectIntelligenceSurfaceId } from "@t3tools/contracts";

export function createProjectIntelligenceSurfaceId(
  parts: ReadonlyArray<string>,
): ProjectIntelligenceSurfaceId {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return `intel:${hash.digest("base64url").slice(0, 32)}` as ProjectIntelligenceSurfaceId;
}
