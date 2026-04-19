import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveWorktreeGitAdminDir,
  resolveWorktreeRuntimeEnvFilePath,
} from "./WorktreeReadinessShared.ts";

describe("Worktree runtime env path resolution", () => {
  it("resolves the git-admin dir for a normal checkout", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-worktree-paths-normal-"));

    try {
      await fs.mkdir(path.join(worktreePath, ".git"), { recursive: true });

      await expect(resolveWorktreeGitAdminDir(worktreePath)).resolves.toBe(
        path.join(worktreePath, ".git"),
      );
      await expect(resolveWorktreeRuntimeEnvFilePath(worktreePath)).resolves.toBe(
        path.join(worktreePath, ".git", "t3code/worktree.local.env"),
      );
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("resolves the git-admin dir for a linked worktree .git pointer file", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-worktree-paths-linked-"));
    const worktreePath = path.join(rootPath, "worktree");
    const gitAdminDir = path.join(rootPath, "repo-admin", "worktrees", "feature-a");

    try {
      await fs.mkdir(worktreePath, { recursive: true });
      await fs.mkdir(gitAdminDir, { recursive: true });
      await fs.writeFile(
        path.join(worktreePath, ".git"),
        "gitdir: ../repo-admin/worktrees/feature-a\n",
        "utf8",
      );

      await expect(resolveWorktreeGitAdminDir(worktreePath)).resolves.toBe(gitAdminDir);
      await expect(resolveWorktreeRuntimeEnvFilePath(worktreePath)).resolves.toBe(
        path.join(gitAdminDir, "t3code/worktree.local.env"),
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("throws a clear error when the worktree is not a git checkout", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-worktree-paths-invalid-"));

    try {
      await expect(resolveWorktreeGitAdminDir(worktreePath)).rejects.toThrow(
        `Worktree '${worktreePath}' is not a Git checkout.`,
      );
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });
});
