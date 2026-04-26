import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import type { GitCoreShape } from "../../git/Services/GitCore.ts";
import { collectProjectCodeStats } from "./codeStats.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dynamo-intel-code-stats-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function gitMock(input: {
  insideWorkTree: boolean;
  paths?: ReadonlyArray<string>;
  truncated?: boolean;
}): GitCoreShape {
  return {
    isInsideWorkTree: () => Effect.succeed(input.insideWorkTree),
    listWorkspaceFiles: () =>
      Effect.succeed({ paths: input.paths ?? [], truncated: input.truncated ?? false }),
  } as unknown as GitCoreShape;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("codeStats", () => {
  it("uses git file listing when inside a worktree", async () => {
    const cwd = makeTempDir();
    writeFile(cwd, "src/index.ts", "const x = 1;\n\nconsole.log(x);\n");
    writeFile(cwd, "README.md", "# ignored");

    const stats = await collectProjectCodeStats({
      cwd,
      git: gitMock({ insideWorkTree: true, paths: ["src/index.ts", "README.md"] }),
      runPromise: Effect.runPromise,
    });

    expect(stats.fileCount).toBe(1);
    expect(stats.loc).toBe(2);
    expect(stats.partial).toBe(false);
  });

  it("falls back to bounded non-git scanning", async () => {
    const cwd = makeTempDir();
    writeFile(cwd, "src/index.ts", "const x = 1;\n");
    writeFile(cwd, "dist/generated.js", "const ignored = true;\n");

    const stats = await collectProjectCodeStats({
      cwd,
      git: gitMock({ insideWorkTree: false }),
      runPromise: Effect.runPromise,
    });

    expect(stats.fileCount).toBe(1);
    expect(stats.loc).toBe(1);
  });

  it("marks partial when git listing is truncated", async () => {
    const cwd = makeTempDir();
    writeFile(cwd, "src/index.ts", "const x = 1;\n");

    const stats = await collectProjectCodeStats({
      cwd,
      git: gitMock({ insideWorkTree: true, paths: ["src/index.ts"], truncated: true }),
      runPromise: Effect.runPromise,
    });

    expect(stats.partial).toBe(true);
  });
});
