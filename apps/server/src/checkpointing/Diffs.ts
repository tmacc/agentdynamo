import { parsePatchFiles } from "@pierre/diffs";

export interface TurnDiffFileSummary {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export function parseTurnDiffFilesFromUnifiedDiff(
  diff: string,
): ReadonlyArray<TurnDiffFileSummary> {
  const normalized = diff.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [];
  }

  const parsedPatches = parsePatchFiles(normalized);
  const files = parsedPatches.flatMap((patch) =>
    patch.files.map((file) => ({
      path: file.name,
      additions: file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0),
      deletions: file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0),
    })),
  );

  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

/**
 * Parse `git diff --numstat` output into per-file +/- counts.
 *
 * Output format: one tab-separated line per file as `<adds>\t<dels>\t<path>`.
 * Binary files report `-\t-\t<path>` and are reported as 0/0. Renames render
 * the path as `old => new` (or with brace syntax); the destination path is
 * preferred so the summary lines up with the worktree state.
 */
export function parseTurnDiffFilesFromNumstat(numstat: string): ReadonlyArray<TurnDiffFileSummary> {
  const normalized = numstat.replace(/\r\n/g, "\n");
  const files: TurnDiffFileSummary[] = [];
  for (const line of normalized.split("\n")) {
    if (line.length === 0) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addsRaw, delsRaw, ...rest] = parts;
    const rawPath = rest.join("\t").trim();
    if (rawPath.length === 0) continue;
    const additions = addsRaw === "-" ? 0 : Number.parseInt(addsRaw ?? "", 10);
    const deletions = delsRaw === "-" ? 0 : Number.parseInt(delsRaw ?? "", 10);
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;
    files.push({
      path: extractDestinationPath(rawPath),
      additions,
      deletions,
    });
  }
  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

function extractDestinationPath(rawPath: string): string {
  const braceMatch = rawPath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceMatch) {
    const [, prefix = "", , destMid = "", suffix = ""] = braceMatch;
    return `${prefix}${destMid}${suffix}`.replace(/\/+/g, "/");
  }
  const arrowIndex = rawPath.indexOf(" => ");
  if (arrowIndex !== -1) {
    return rawPath.slice(arrowIndex + " => ".length);
  }
  return rawPath;
}
