import fsPromises from "node:fs/promises";
import path from "node:path";

import {
  PROJECT_CONTEXT_OVERRIDES_FILE_VERSION,
  PROJECT_CONTEXT_OVERRIDES_RELATIVE_PATH,
  ProjectContextOverridesFile,
  type ProjectIntelligenceSurfaceId,
  type ProjectIntelligenceSurfaceSummary,
} from "@t3tools/contracts";
import { Schema } from "effect";

export type EnabledOverridesMap = Readonly<Record<ProjectIntelligenceSurfaceId, boolean>>;

const EMPTY_OVERRIDES: EnabledOverridesMap = Object.freeze({}) as EnabledOverridesMap;

function overridesPath(projectCwd: string): string {
  return path.join(projectCwd, PROJECT_CONTEXT_OVERRIDES_RELATIVE_PATH);
}

/**
 * Read the per-project overrides file. Missing file or malformed JSON yields an
 * empty map — overrides should never block discovery.
 */
export async function readProjectContextOverrides(
  projectCwd: string,
): Promise<EnabledOverridesMap> {
  const filePath = overridesPath(projectCwd);
  let raw: string;
  try {
    raw = await fsPromises.readFile(filePath, "utf8");
  } catch {
    return EMPTY_OVERRIDES;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_OVERRIDES;
  }
  const decoded = Schema.decodeUnknownExit(ProjectContextOverridesFile)(parsed);
  if (decoded._tag === "Failure") {
    return EMPTY_OVERRIDES;
  }
  return decoded.value.enabledOverrides ?? EMPTY_OVERRIDES;
}

/**
 * Persist a new overrides map. Removes the file when the map is empty so projects
 * with no user choices stay clean.
 */
export async function writeProjectContextOverrides(
  projectCwd: string,
  overrides: EnabledOverridesMap,
): Promise<void> {
  const filePath = overridesPath(projectCwd);
  const dirPath = path.dirname(filePath);
  if (Object.keys(overrides).length === 0) {
    try {
      await fsPromises.unlink(filePath);
    } catch {
      // already absent — fine
    }
    return;
  }
  const file: ProjectContextOverridesFile = {
    version: PROJECT_CONTEXT_OVERRIDES_FILE_VERSION,
    enabledOverrides: overrides,
  };
  await fsPromises.mkdir(dirPath, { recursive: true });
  await fsPromises.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

/**
 * Set or clear an override for a single surface. Returns the new map.
 *
 * Passing `null` clears the override entirely (revert-to-discovery-default).
 */
export async function setSurfaceEnabledOverride(
  projectCwd: string,
  surfaceId: ProjectIntelligenceSurfaceId,
  enabled: boolean | null,
): Promise<EnabledOverridesMap> {
  const current = await readProjectContextOverrides(projectCwd);
  const next: Record<ProjectIntelligenceSurfaceId, boolean> = { ...current };
  if (enabled === null) {
    delete next[surfaceId];
  } else {
    next[surfaceId] = enabled;
  }
  await writeProjectContextOverrides(projectCwd, next);
  return next;
}

/**
 * Apply user overrides on top of a discovered surface list. Surfaces that don't
 * have an override keep their discovery-derived `enabled`. The `health` flag is
 * recomputed for any flipped surface so a user-disabled item doesn't show as "ok".
 *
 * NOTE (v1): the `enabled` flag is currently advisory — provider adapters do not
 * yet consult it when assembling prompts. The persisted overrides file is the
 * source of truth, ready for v1.1 adapter wiring. See plan §"Critical investigation".
 */
export function applySurfaceOverrides(
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>,
  overrides: EnabledOverridesMap,
): ReadonlyArray<ProjectIntelligenceSurfaceSummary> {
  if (Object.keys(overrides).length === 0) return surfaces;
  return surfaces.map((surface) => {
    const override = overrides[surface.id];
    if (override === undefined || override === surface.enabled) return surface;
    return {
      ...surface,
      enabled: override,
      health: override ? surface.health : "info",
    };
  });
}
