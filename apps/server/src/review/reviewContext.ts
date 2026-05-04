import { Effect, FileSystem, Path } from "effect";
import type { GitHubPullRequestSummary } from "../git/Services/GitHubCli.ts";

export interface ReviewClaudeMdFragment {
  readonly path: string;
  readonly text: string;
}

export interface ReviewStepContext {
  readonly prRef: string;
  readonly pr: GitHubPullRequestSummary | null;
  readonly diff: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly claudeMdFragments: ReadonlyArray<ReviewClaudeMdFragment>;
}

function changedDirs(files: ReadonlyArray<string>): ReadonlyArray<string> {
  const dirs = new Set<string>(["."]);
  for (const file of files) {
    const parts = file.split("/").filter(Boolean);
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      dirs.add(current);
    }
  }
  return [...dirs].toSorted((left, right) => left.localeCompare(right));
}

export const collectClaudeMdFragments = Effect.fn("review.collectClaudeMdFragments")(function* (
  cwd: string,
  files: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fragments: ReviewClaudeMdFragment[] = [];
  const seen = new Set<string>();

  for (const dir of changedDirs(files)) {
    const relative = dir === "." ? "CLAUDE.md" : `${dir}/CLAUDE.md`;
    if (seen.has(relative)) continue;
    seen.add(relative);
    const absolute = path.join(cwd, relative);
    const text = yield* fs.readFileString(absolute).pipe(
      Effect.map((value) => value.trim()),
      Effect.catch(() => Effect.succeed("")),
    );
    if (text.length === 0) continue;
    fragments.push({
      path: relative,
      text: text.length > 12_000 ? `${text.slice(0, 12_000)}\n[truncated]` : text,
    });
  }

  return fragments;
});
