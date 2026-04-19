import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { WorktreeRuntimeEnvProvisioner } from "../Services/WorktreeRuntimeEnvProvisioner.ts";
import { WorktreeRuntimeEnvProvisionerLive } from "./WorktreeRuntimeEnvProvisioner.ts";
import {
  LEGACY_WORKTREE_LOCAL_ENV_PATH,
  resolveWorktreeRuntimeEnvFilePath,
} from "./WorktreeReadinessShared.ts";

async function makeProvisioner() {
  return Effect.runPromise(
    Effect.service(WorktreeRuntimeEnvProvisioner).pipe(
      Effect.provide(WorktreeRuntimeEnvProvisionerLive),
    ),
  );
}

async function initializeGitCheckout(worktreePath: string): Promise<void> {
  await fs.mkdir(path.join(worktreePath, ".git"), { recursive: true });
}

describe("WorktreeRuntimeEnvProvisioner", () => {
  it("creates the runtime env file under the git-admin dir", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-runtime-env-create-"));

    try {
      await initializeGitCheckout(worktreePath);
      const provisioner = await makeProvisioner();

      const result = await Effect.runPromise(
        provisioner.ensureEnvFile({
          projectCwd: worktreePath,
          worktreePath,
          portCount: 2,
        }),
      );

      expect(result.created).toBe(true);
      expect(result.envFilePath).toBe(await resolveWorktreeRuntimeEnvFilePath(worktreePath));
      await expect(fs.readFile(result.envFilePath, "utf8")).resolves.toContain(
        "T3CODE_PRIMARY_PORT=",
      );
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("reuses an existing git-admin runtime env file without reallocating", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-runtime-env-existing-"));

    try {
      await initializeGitCheckout(worktreePath);
      const provisioner = await makeProvisioner();
      const envFilePath = await resolveWorktreeRuntimeEnvFilePath(worktreePath);
      const contents =
        "HOST=127.0.0.1\nPORT=44000\nT3CODE_PRIMARY_PORT=44000\nT3CODE_PORT_1=44000\n";
      await fs.mkdir(path.dirname(envFilePath), { recursive: true });
      await fs.writeFile(envFilePath, contents, "utf8");

      const result = await Effect.runPromise(
        provisioner.ensureEnvFile({
          projectCwd: worktreePath,
          worktreePath,
          portCount: 1,
        }),
      );

      expect(result.created).toBe(false);
      expect(result.values.T3CODE_PRIMARY_PORT).toBe("44000");
      await expect(fs.readFile(envFilePath, "utf8")).resolves.toBe(contents);
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("migrates a legacy worktree env file into git-admin storage and removes the legacy file", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "t3-runtime-env-legacy-"));

    try {
      await initializeGitCheckout(worktreePath);
      const provisioner = await makeProvisioner();
      const legacyEnvPath = path.join(worktreePath, LEGACY_WORKTREE_LOCAL_ENV_PATH);
      const migratedContent =
        "HOST=127.0.0.1\nPORT=45000\nT3CODE_PRIMARY_PORT=45000\nT3CODE_PORT_1=45000\n";
      await fs.mkdir(path.dirname(legacyEnvPath), { recursive: true });
      await fs.writeFile(legacyEnvPath, migratedContent, "utf8");

      const result = await Effect.runPromise(
        provisioner.ensureEnvFile({
          projectCwd: worktreePath,
          worktreePath,
          portCount: 1,
        }),
      );

      const envFilePath = await resolveWorktreeRuntimeEnvFilePath(worktreePath);
      expect(result.created).toBe(false);
      expect(result.envFilePath).toBe(envFilePath);
      expect(result.values.T3CODE_PRIMARY_PORT).toBe("45000");
      const migratedFile = await fs.readFile(envFilePath, "utf8");
      expect(migratedFile).toContain("HOST=127.0.0.1");
      expect(migratedFile).toContain("PORT=45000");
      expect(migratedFile).toContain("T3CODE_PRIMARY_PORT=45000");
      expect(migratedFile).toContain("T3CODE_PORT_1=45000");
      await expect(fs.access(legacyEnvPath)).rejects.toThrow();
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });
});
