import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProjectId } from "@t3tools/contracts";
import { afterEach, describe, it } from "vitest";

import {
  WORKTREE_DEV_POWERSHELL_HELPER_FILENAME,
  WORKTREE_DEV_WINDOWS_COMMAND_FILENAME,
  WORKTREE_POWERSHELL_ENV_RELATIVE_PATH,
  WORKTREE_SETUP_POWERSHELL_HELPER_FILENAME,
  WORKTREE_SETUP_WINDOWS_COMMAND_FILENAME,
  buildDevHelperContent,
  buildPowerShellDevHelperContent,
  buildPowerShellSetupHelperContent,
  buildSetupHelperContent,
  buildWorktreeSetupProfile,
  computeWorktreeSetupAnalysis,
  materializeWorktreeSetupHelpers,
  prepareWorktreeSetupRuntime,
  serializePowerShellWorktreeRuntimeEnv,
} from "./worktreeSetup.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dynamo-worktree-setup-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("worktreeSetup", () => {
  it("detects a Bun Vite project and produces stable recommendations", async () => {
    const projectCwd = makeTempDir();
    fs.writeFileSync(
      path.join(projectCwd, "package.json"),
      JSON.stringify({
        packageManager: "bun@1.2.0",
        scripts: { dev: "vite --mode dev" },
        dependencies: { vite: "^7.0.0" },
      }),
    );
    fs.writeFileSync(path.join(projectCwd, "bun.lockb"), "");
    fs.writeFileSync(path.join(projectCwd, ".env"), "SECRET=1\n");

    const first = await computeWorktreeSetupAnalysis({ projectCwd });
    const second = await computeWorktreeSetupAnalysis({ projectCwd });

    assert.equal(first.recommendation.packageManager, "bun");
    assert.equal(first.recommendation.framework, "vite");
    assert.equal(first.recommendation.installCommand, "bun install");
    assert.equal(first.recommendation.devCommand, "bun run dev");
    assert.equal(first.recommendation.envStrategy, "symlink_root");
    assert.equal(first.recommendation.envSourcePath, ".env");
    assert.equal(first.scanFingerprint, second.scanFingerprint);
  });

  it("materializes helpers in runtime storage without writing repo helper files", async () => {
    const projectCwd = makeTempDir();
    const stateDir = makeTempDir();
    fs.writeFileSync(
      path.join(projectCwd, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev" }, dependencies: { next: "^16.0.0" } }),
    );

    const analysis = await computeWorktreeSetupAnalysis({ projectCwd });
    const profile = buildWorktreeSetupProfile({
      scanFingerprint: analysis.scanFingerprint,
      recommendation: {
        ...analysis.recommendation,
        devCommand: analysis.recommendation.devCommand ?? "npm run dev",
      },
      autoRunSetupOnWorktreeCreate: true,
      now: "2026-04-24T00:00:00.000Z",
    });

    const helpers = await materializeWorktreeSetupHelpers({
      stateDir,
      projectId: ProjectId.make("project-1"),
      profile,
    });

    assert.equal(fs.existsSync(helpers.setupHelperPath), true);
    assert.equal(fs.existsSync(helpers.devHelperPath), true);
    assert.equal(fs.existsSync(helpers.setupPowerShellPath), true);
    assert.equal(fs.existsSync(helpers.devPowerShellPath), true);
    assert.equal(fs.existsSync(helpers.setupWindowsCommandPath), true);
    assert.equal(fs.existsSync(helpers.devWindowsCommandPath), true);
    assert.equal(
      path.basename(helpers.setupPowerShellPath),
      WORKTREE_SETUP_POWERSHELL_HELPER_FILENAME,
    );
    assert.equal(path.basename(helpers.devPowerShellPath), WORKTREE_DEV_POWERSHELL_HELPER_FILENAME);
    assert.equal(
      path.basename(helpers.setupWindowsCommandPath),
      WORKTREE_SETUP_WINDOWS_COMMAND_FILENAME,
    );
    assert.equal(
      path.basename(helpers.devWindowsCommandPath),
      WORKTREE_DEV_WINDOWS_COMMAND_FILENAME,
    );
    assert.equal(fs.existsSync(path.join(projectCwd, ".dynamo")), false);
    assert.equal(fs.existsSync(path.join(projectCwd, ".t3code")), false);
  });

  it("writes per-worktree env under the Git admin dir with Dynamo and compatibility vars", async () => {
    const projectCwd = makeTempDir();
    const stateDir = makeTempDir();
    execFileSync("git", ["init"], { cwd: projectCwd, stdio: "ignore" });
    fs.writeFileSync(
      path.join(projectCwd, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" }, dependencies: { vite: "^7.0.0" } }),
    );

    const analysis = await computeWorktreeSetupAnalysis({ projectCwd });
    const profile = buildWorktreeSetupProfile({
      scanFingerprint: analysis.scanFingerprint,
      recommendation: {
        ...analysis.recommendation,
        devCommand: analysis.recommendation.devCommand ?? "npm run dev",
      },
      autoRunSetupOnWorktreeCreate: true,
      now: "2026-04-24T00:00:00.000Z",
    });

    const prepared = await prepareWorktreeSetupRuntime({
      stateDir,
      projectId: ProjectId.make("project-1"),
      projectCwd,
      worktreePath: projectCwd,
      profile,
    });

    assert.equal(prepared.envFilePath, path.join(projectCwd, ".git", "dynamo", "worktree.env"));
    assert.equal(
      prepared.powerShellEnvFilePath,
      path.join(projectCwd, ".git", WORKTREE_POWERSHELL_ENV_RELATIVE_PATH),
    );
    const envFile = fs.readFileSync(prepared.envFilePath, "utf8");
    const powerShellEnvFile = fs.readFileSync(prepared.powerShellEnvFilePath, "utf8");
    assert.match(envFile, /DYNAMO_PROJECT_ROOT=/);
    assert.match(envFile, /DYNAMO_WORKTREE_PATH=/);
    assert.match(envFile, /DYNAMO_PRIMARY_PORT=/);
    assert.match(envFile, /T3CODE_PROJECT_ROOT=/);
    assert.match(envFile, /T3CODE_WORKTREE_PATH=/);
    assert.match(envFile, /T3CODE_PRIMARY_PORT=/);
    assert.match(powerShellEnvFile, /\$env:DYNAMO_PROJECT_ROOT = /);
    assert.match(powerShellEnvFile, /\$env:DYNAMO_WORKTREE_PATH = /);
    assert.match(powerShellEnvFile, /\$env:DYNAMO_PRIMARY_PORT = /);
  });

  it("escapes PowerShell env values with single quotes", () => {
    const serialized = serializePowerShellWorktreeRuntimeEnv({
      DYNAMO_PROJECT_ROOT: "C:\\Users\\TJ's Repo",
    });

    assert.equal(serialized, "$env:DYNAMO_PROJECT_ROOT = 'C:\\Users\\TJ''s Repo'\n");
  });

  it("builds PowerShell setup helpers with env validation, symlink fallback, and install command", () => {
    const setup = buildPowerShellSetupHelperContent({
      version: 1,
      status: "configured",
      scanFingerprint: "fingerprint-1",
      packageManager: "bun",
      framework: "vite",
      envStrategy: "symlink_root",
      envSourcePath: ".env",
      installCommand: "bun install",
      devCommand: "bun run dev",
      portCount: 5,
      storageMode: "dynamo-managed",
      autoRunSetupOnWorktreeCreate: true,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });

    assert.match(setup, /\$ErrorActionPreference = "Stop"/);
    assert.match(setup, /DYNAMO_WORKTREE_ENV_FILE is required/);
    assert.match(setup, /\. \$envFile/);
    assert.match(setup, /New-Item -ItemType SymbolicLink/);
    assert.match(setup, /copying instead/);
    assert.match(setup, /Copy-Item -LiteralPath \$sourcePath/);
    assert.match(setup, /\$installCommand = 'bun install'/);
    assert.match(setup, /Invoke-Expression \$installCommand/);
  });

  it("builds framework-specific dev helper port flags", () => {
    const setup = buildSetupHelperContent({
      version: 1,
      status: "configured",
      scanFingerprint: "fingerprint-1",
      packageManager: "bun",
      framework: "vite",
      envStrategy: "none",
      envSourcePath: null,
      installCommand: "bun install",
      devCommand: "bun run dev",
      portCount: 5,
      storageMode: "dynamo-managed",
      autoRunSetupOnWorktreeCreate: true,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    const dev = buildDevHelperContent({
      version: 1,
      status: "configured",
      scanFingerprint: "fingerprint-1",
      packageManager: "bun",
      framework: "vite",
      installCommand: null,
      devCommand: "bun run dev",
      envStrategy: "none",
      envSourcePath: null,
      portCount: 5,
      storageMode: "dynamo-managed",
      autoRunSetupOnWorktreeCreate: true,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });

    assert.match(setup, /bun install/);
    assert.match(dev, /-- --host "\$HOST" --port "\$PORT"/);
  });

  it("builds PowerShell dev helpers with framework-specific host and port flags", () => {
    const viteDev = buildPowerShellDevHelperContent({
      version: 1,
      status: "configured",
      scanFingerprint: "fingerprint-1",
      packageManager: "bun",
      framework: "vite",
      installCommand: null,
      devCommand: "bun run dev",
      envStrategy: "none",
      envSourcePath: null,
      portCount: 5,
      storageMode: "dynamo-managed",
      autoRunSetupOnWorktreeCreate: true,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    const nextDev = buildPowerShellDevHelperContent({
      version: 1,
      status: "configured",
      scanFingerprint: "fingerprint-1",
      packageManager: "npm",
      framework: "next",
      installCommand: null,
      devCommand: "npm run dev",
      envStrategy: "none",
      envSourcePath: null,
      portCount: 5,
      storageMode: "dynamo-managed",
      autoRunSetupOnWorktreeCreate: true,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });

    assert.match(viteDev, /\$env:PORT = \$env:DYNAMO_PRIMARY_PORT/);
    assert.match(viteDev, /\$env:HOST = "127\.0\.0\.1"/);
    assert.match(
      viteDev,
      /\$devCommand = 'bun run dev -- --host "\$env:HOST" --port "\$env:PORT"'/,
    );
    assert.match(nextDev, /\$devCommand = 'npm run dev -- -p "\$env:PORT" -H "\$env:HOST"'/);
  });
});
