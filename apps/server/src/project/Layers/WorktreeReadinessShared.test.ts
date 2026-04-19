import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildManagedWorktreeScriptFiles,
  materializeManagedWorktreeScripts,
  WORKTREE_MANAGED_HEADER,
} from "./WorktreeReadinessShared.ts";

async function writeScripts(
  rootPath: string,
  runtimeEnvPathMode: "git-admin" | "legacy-worktree",
): Promise<void> {
  const files = buildManagedWorktreeScriptFiles({
    installCommand: "bun install",
    envStrategy: "none",
    envSourcePath: null,
    framework: "vite",
    packageManager: "bun",
    devCommand: "bun run dev",
    runtimeEnvPathMode,
  });
  for (const [relativePath, content] of files) {
    const absolutePath = path.join(rootPath, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }
}

async function materialize(rootPath: string) {
  return materializeManagedWorktreeScripts({
    rootPath,
    installCommand: "bun install",
    envStrategy: "none",
    envSourcePath: null,
    framework: "vite",
    packageManager: "bun",
    devCommand: "bun run dev",
    policy: {
      mode: "bootstrap_safe",
    },
  });
}

describe("materializeManagedWorktreeScripts", () => {
  it("preserves identical current generated helpers", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-shared-identical-"));

    try {
      await writeScripts(rootPath, "git-admin");

      await expect(materialize(rootPath)).resolves.toEqual({
        files: [
          { path: ".t3code/worktree/setup.sh", action: "preserved" },
          { path: ".t3code/worktree/dev.sh", action: "preserved" },
        ],
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("overwrites exact legacy generated helpers in bootstrap_safe mode", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-shared-legacy-"));

    try {
      await writeScripts(rootPath, "legacy-worktree");

      await expect(materialize(rootPath)).resolves.toEqual({
        files: [
          { path: ".t3code/worktree/setup.sh", action: "overwritten" },
          { path: ".t3code/worktree/dev.sh", action: "overwritten" },
        ],
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("treats arbitrary managed content as drifted_managed", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-shared-managed-drift-"));

    try {
      await writeScripts(rootPath, "git-admin");
      await fs.writeFile(
        path.join(rootPath, ".t3code/worktree/setup.sh"),
        `#!/usr/bin/env zsh\n${WORKTREE_MANAGED_HEADER}\necho managed drift\n`,
        "utf8",
      );

      await expect(materialize(rootPath)).rejects.toThrow(
        "Worktree helper drift detected at .t3code/worktree/setup.sh (managed helper file).",
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("treats arbitrary non-managed content as drifted_unmanaged", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-shared-unmanaged-drift-"));

    try {
      await writeScripts(rootPath, "git-admin");
      await fs.writeFile(
        path.join(rootPath, ".t3code/worktree/dev.sh"),
        "#!/usr/bin/env zsh\necho unmanaged drift\n",
        "utf8",
      );

      await expect(materialize(rootPath)).rejects.toThrow(
        "Worktree helper drift detected at .t3code/worktree/dev.sh (unmanaged file).",
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
