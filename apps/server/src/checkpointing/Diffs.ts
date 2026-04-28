export interface TurnDiffFileSummary {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Parse `git diff --numstat -z` output into per-file +/- counts.
 *
 * Normal files are emitted as `<adds>\t<dels>\t<path>\0`. Renames are emitted
 * as `<adds>\t<dels>\t\0<old-path>\0<new-path>\0`; the destination path is
 * preferred so the summary lines up with the worktree state.
 */
export function parseTurnDiffFilesFromNumstat(numstat: string): ReadonlyArray<TurnDiffFileSummary> {
  const records = numstat.split("\0");
  if (records.at(-1) === "") {
    records.pop();
  }

  const files: TurnDiffFileSummary[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const parsedHeader = parseNumstatHeader(records[index] ?? "");
    if (!parsedHeader) continue;

    let path = parsedHeader.path;
    if (path.length === 0) {
      const destinationPath = records[index + 2];
      index += 2;
      if (!destinationPath) continue;
      path = destinationPath;
    }

    files.push({
      path,
      additions: parsedHeader.additions,
      deletions: parsedHeader.deletions,
    });
  }

  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

function parseNumstatHeader(
  header: string,
): { readonly additions: number; readonly deletions: number; readonly path: string } | null {
  const firstTab = header.indexOf("\t");
  if (firstTab === -1) return null;

  const secondTab = header.indexOf("\t", firstTab + 1);
  if (secondTab === -1) return null;

  const additions = parseNumstatCount(header.slice(0, firstTab));
  const deletions = parseNumstatCount(header.slice(firstTab + 1, secondTab));
  if (additions === null || deletions === null) return null;

  return {
    additions,
    deletions,
    path: header.slice(secondTab + 1),
  };
}

function parseNumstatCount(value: string): number | null {
  if (value === "-") {
    return 0;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  return Number.parseInt(value, 10);
}
