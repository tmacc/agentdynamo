import type { Dirent } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import type { ProjectIntelligenceCodeStats } from "@t3tools/contracts";
import {
  AUTHORED_SOURCE_CODE_STATS_BASIS,
  approximateTokenCount,
  countNonEmptyLines,
  isLikelyGeneratedSource,
  isSourceLikePath,
  shouldIgnoreCodeStatsPath,
} from "@t3tools/shared/codeStatsPolicy";
import { Effect } from "effect";

import type { GitCoreShape, GitListWorkspaceFilesResult } from "../../git/Services/GitCore.ts";

const MAX_CODE_STATS_FILES = 25_000;

async function listDirectoryEntries(targetPath: string): Promise<ReadonlyArray<Dirent>> {
  try {
    return await fsPromises.readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readTextIfExists(targetPath: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(targetPath, "utf8");
  } catch {
    return null;
  }
}

async function discoverNonGitFiles(cwd: string): Promise<{
  readonly paths: ReadonlyArray<string>;
  readonly partial: boolean;
}> {
  const paths: string[] = [];
  const stack = [cwd];
  let partial = false;

  while (stack.length > 0 && paths.length < MAX_CODE_STATS_FILES) {
    const currentPath = stack.pop()!;
    for (const entry of await listDirectoryEntries(currentPath)) {
      const nextPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(cwd, nextPath).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (shouldIgnoreCodeStatsPath(`${relativePath}/index.ts`)) {
          continue;
        }
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile()) {
        paths.push(relativePath);
        if (paths.length >= MAX_CODE_STATS_FILES) {
          partial = true;
          break;
        }
      }
    }
  }

  return { paths, partial };
}

export async function collectProjectCodeStats(input: {
  readonly cwd: string;
  readonly git: GitCoreShape;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}): Promise<ProjectIntelligenceCodeStats> {
  const isGitRepo = await input.runPromise(
    input.git.isInsideWorkTree(input.cwd).pipe(Effect.orElseSucceed(() => false)),
  );

  let candidatePaths: ReadonlyArray<string> = [];
  let partial = false;
  if (isGitRepo) {
    const listedFiles = await input.runPromise(
      input.git.listWorkspaceFiles(input.cwd).pipe(
        Effect.orElseSucceed(
          (): GitListWorkspaceFilesResult => ({
            paths: [],
            truncated: false,
          }),
        ),
      ),
    );
    candidatePaths = listedFiles.paths;
    partial ||= listedFiles.truncated;
  } else {
    const discovered = await discoverNonGitFiles(input.cwd);
    candidatePaths = discovered.paths;
    partial ||= discovered.partial;
  }

  let fileCount = 0;
  let loc = 0;
  let approxTokenCount = 0;
  for (const relativePath of candidatePaths) {
    if (!isSourceLikePath(relativePath)) {
      continue;
    }
    const content = await readTextIfExists(path.join(input.cwd, relativePath));
    if (content === null || isLikelyGeneratedSource(content)) {
      continue;
    }
    fileCount += 1;
    loc += countNonEmptyLines(content);
    approxTokenCount += approximateTokenCount(content);
  }

  return {
    basis: AUTHORED_SOURCE_CODE_STATS_BASIS,
    fileCount,
    loc,
    approxTokenCount,
    partial,
  };
}
