import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  ProjectId,
  ProjectWorktreeSetupEnvStrategy,
  ProjectWorktreeSetupFramework,
  ProjectWorktreeSetupPackageManager,
  ProjectWorktreeSetupProfile,
  ProjectWorktreeSetupRecommendation,
  ProjectWorktreeSetupWarning,
} from "@t3tools/contracts";

export const WORKTREE_SETUP_RUNTIME_DIR = "worktree-runtime";
export const WORKTREE_SETUP_HELPER_FILENAME = "setup.sh";
export const WORKTREE_DEV_HELPER_FILENAME = "dev.sh";
export const WORKTREE_SETUP_POWERSHELL_HELPER_FILENAME = "setup.ps1";
export const WORKTREE_DEV_POWERSHELL_HELPER_FILENAME = "dev.ps1";
export const WORKTREE_SETUP_WINDOWS_COMMAND_FILENAME = "setup.cmd";
export const WORKTREE_DEV_WINDOWS_COMMAND_FILENAME = "dev.cmd";
export const WORKTREE_ENV_RELATIVE_PATH = "dynamo/worktree.env";
export const WORKTREE_POWERSHELL_ENV_RELATIVE_PATH = "dynamo/worktree.env.ps1";
export const WORKTREE_SETUP_PORT_RANGE_START = 41_000;
export const WORKTREE_SETUP_PORT_RANGE_END = 61_000;
export const DEFAULT_WORKTREE_SETUP_PORT_COUNT = 5;

type PackageJson = {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export interface WorktreeSetupAnalysis {
  readonly scanFingerprint: string;
  readonly detectedProjectType: string;
  readonly recommendation: ProjectWorktreeSetupRecommendation;
  readonly warnings: ReadonlyArray<ProjectWorktreeSetupWarning>;
}

export interface WorktreeSetupHelperPaths {
  readonly helperRoot: string;
  readonly setupHelperPath: string;
  readonly devHelperPath: string;
  readonly setupPowerShellPath: string;
  readonly devPowerShellPath: string;
  readonly setupWindowsCommandPath: string;
  readonly devWindowsCommandPath: string;
}

export interface WorktreeRuntimePreparation {
  readonly envFilePath: string;
  readonly powerShellEnvFilePath: string;
  readonly helperPaths: WorktreeSetupHelperPaths;
  readonly env: Record<string, string>;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readPackageJson(projectCwd: string): Promise<PackageJson | null> {
  const content = await readOptionalFile(path.join(projectCwd, "package.json"));
  if (content === null) {
    return null;
  }
  try {
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}

function detectFramework(input: {
  readonly packageJson: PackageJson | null;
  readonly filePresence: ReadonlyMap<string, boolean>;
  readonly fileContents: ReadonlyMap<string, string | null>;
}): ProjectWorktreeSetupFramework {
  const dependencies = {
    ...input.packageJson?.dependencies,
    ...input.packageJson?.devDependencies,
  };
  if (dependencies.next) return "next";
  if (dependencies.astro) return "astro";
  if (dependencies.vite || dependencies["@vitejs/plugin-react"]) return "vite";
  if (input.filePresence.get("manage.py")) return "django";
  if (input.filePresence.get("bin/rails") || input.filePresence.get("Gemfile")) return "rails";
  if (input.filePresence.get("mix.exs")) {
    const mix = input.fileContents.get("mix.exs") ?? "";
    return mix.includes(":phoenix") || mix.includes("phoenix") ? "phoenix" : "generic";
  }
  return "generic";
}

function detectPackageManager(input: {
  readonly packageJson: PackageJson | null;
  readonly filePresence: ReadonlyMap<string, boolean>;
}): ProjectWorktreeSetupPackageManager {
  const declared = input.packageJson?.packageManager?.split("@")[0]?.trim();
  if (declared === "bun" || declared === "pnpm" || declared === "npm" || declared === "yarn") {
    return declared;
  }
  if (input.filePresence.get("bun.lock") || input.filePresence.get("bun.lockb")) return "bun";
  if (input.filePresence.get("pnpm-lock.yaml")) return "pnpm";
  if (input.filePresence.get("package-lock.json")) return "npm";
  if (input.filePresence.get("yarn.lock")) return "yarn";
  if (input.filePresence.get("pyproject.toml")) {
    return input.filePresence.get("poetry.lock") ? "poetry" : "uv";
  }
  if (input.filePresence.get("requirements.txt")) return "pip";
  if (input.filePresence.get("Gemfile")) return "bundle";
  if (input.filePresence.get("mix.exs")) return "mix";
  return "unknown";
}

function detectInstallCommand(packageManager: ProjectWorktreeSetupPackageManager): string | null {
  switch (packageManager) {
    case "bun":
      return "bun install";
    case "pnpm":
      return "pnpm install";
    case "npm":
      return "npm install";
    case "yarn":
      return "yarn install";
    case "uv":
      return "uv sync";
    case "pip":
      return "python -m pip install -r requirements.txt";
    case "poetry":
      return "poetry install";
    case "bundle":
      return "bundle install";
    case "mix":
      return "mix deps.get";
    case "unknown":
      return null;
  }
}

function packageManagerDevCommand(
  packageManager: ProjectWorktreeSetupPackageManager,
): string | null {
  switch (packageManager) {
    case "npm":
      return "npm run dev";
    case "bun":
      return "bun run dev";
    case "pnpm":
      return "pnpm dev";
    case "yarn":
      return "yarn dev";
    default:
      return null;
  }
}

function detectDevCommand(input: {
  readonly framework: ProjectWorktreeSetupFramework;
  readonly packageManager: ProjectWorktreeSetupPackageManager;
  readonly packageJson: PackageJson | null;
  readonly filePresence: ReadonlyMap<string, boolean>;
}): string | null {
  const packageDev = packageManagerDevCommand(input.packageManager);
  if (input.packageJson?.scripts?.dev?.trim() && packageDev) {
    return packageDev;
  }
  switch (input.framework) {
    case "django":
      return input.filePresence.get("manage.py") ? "python manage.py runserver" : null;
    case "rails":
      return input.filePresence.get("bin/rails") ? "bin/rails server" : null;
    case "phoenix":
      return "mix phx.server";
    case "next":
    case "vite":
    case "astro":
      return packageDev;
    case "generic":
      return null;
  }
}

async function detectEnvSourcePath(projectCwd: string): Promise<string | null> {
  for (const candidate of [".env.local", ".env.development", ".env"]) {
    if (await fileExists(path.join(projectCwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

async function detectEnvTemplatePath(projectCwd: string): Promise<string | null> {
  for (const candidate of [".env.local.example", ".env.example"]) {
    if (await fileExists(path.join(projectCwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

export async function computeWorktreeSetupAnalysis(input: {
  readonly projectCwd: string;
  readonly profile?: ProjectWorktreeSetupProfile | null;
}): Promise<WorktreeSetupAnalysis> {
  const fingerprintFiles = [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "turbo.json",
    "pnpm-workspace.yaml",
    "nx.json",
    "pyproject.toml",
    "poetry.lock",
    "requirements.txt",
    "manage.py",
    "Gemfile",
    "bin/rails",
    "mix.exs",
    ".env.example",
    ".env.local.example",
    "devcontainer.json",
    "docker-compose.yml",
    "docker-compose.yaml",
  ];

  const filePresence = new Map<string, boolean>();
  const fileContents = new Map<string, string | null>();
  const fingerprint = crypto.createHash("sha256");
  for (const relativePath of fingerprintFiles) {
    const absolutePath = path.join(input.projectCwd, relativePath);
    const content = await readOptionalFile(absolutePath);
    const exists = content !== null;
    filePresence.set(relativePath, exists);
    fileContents.set(relativePath, content);
    fingerprint.update(relativePath);
    fingerprint.update("\0");
    fingerprint.update(exists ? content : "missing");
    fingerprint.update("\0");
  }

  const packageJson = await readPackageJson(input.projectCwd);
  const framework = detectFramework({ packageJson, filePresence, fileContents });
  const packageManager = detectPackageManager({ packageJson, filePresence });
  const installCommand = detectInstallCommand(packageManager);
  const devCommand = detectDevCommand({ framework, packageManager, packageJson, filePresence });
  const envSourcePath = await detectEnvSourcePath(input.projectCwd);
  const envTemplatePath =
    envSourcePath === null ? await detectEnvTemplatePath(input.projectCwd) : null;
  const envStrategy: ProjectWorktreeSetupEnvStrategy = envSourcePath ? "symlink_root" : "none";
  const recommendation: ProjectWorktreeSetupRecommendation = {
    packageManager,
    framework,
    installCommand,
    devCommand,
    envStrategy,
    envSourcePath,
    portCount: DEFAULT_WORKTREE_SETUP_PORT_COUNT,
    confidence: devCommand ? (framework === "generic" ? "medium" : "high") : "low",
  };
  const warnings: ProjectWorktreeSetupWarning[] = [];
  if (!devCommand) {
    warnings.push({
      id: "missing-dev-command",
      message: "No dev command was detected. Enter one before applying worktree setup.",
      severity: "warning",
    });
  }
  if (envStrategy === "none") {
    warnings.push({
      id: "missing-env-source",
      message:
        envTemplatePath !== null
          ? `Only ${envTemplatePath} was detected. Dynamo will skip env file handling until a real env file is present.`
          : "No root env file was detected. Dynamo will skip env file handling.",
      severity: "info",
    });
  }

  const scanFingerprint = fingerprint.digest("hex");
  if (input.profile && input.profile.scanFingerprint !== scanFingerprint) {
    warnings.push({
      id: "stale-worktree-setup",
      message: "The saved worktree setup is stale and should be reviewed.",
      severity: "warning",
    });
  }

  return {
    scanFingerprint,
    detectedProjectType: framework === "generic" ? packageManager : framework,
    recommendation,
    warnings,
  };
}

export function buildWorktreeSetupProfile(input: {
  readonly scanFingerprint: string;
  readonly recommendation: Omit<ProjectWorktreeSetupRecommendation, "confidence">;
  readonly autoRunSetupOnWorktreeCreate: boolean;
  readonly now: string;
}): ProjectWorktreeSetupProfile {
  return {
    version: 1,
    status: "configured",
    scanFingerprint: input.scanFingerprint,
    packageManager: input.recommendation.packageManager,
    framework: input.recommendation.framework,
    installCommand: input.recommendation.installCommand,
    devCommand: input.recommendation.devCommand ?? "",
    envStrategy: input.recommendation.envStrategy,
    envSourcePath: input.recommendation.envSourcePath,
    portCount: input.recommendation.portCount,
    storageMode: "dynamo-managed",
    autoRunSetupOnWorktreeCreate: input.autoRunSetupOnWorktreeCreate,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function appendScriptFlags(input: {
  readonly packageManager: ProjectWorktreeSetupPackageManager;
  readonly devCommand: string;
  readonly flags: string;
}) {
  switch (input.packageManager) {
    case "npm":
    case "bun":
      return `${input.devCommand} -- ${input.flags}`;
    case "pnpm":
    case "yarn":
      return `${input.devCommand} ${input.flags}`;
    default:
      return null;
  }
}

function appendPowerShellScriptFlags(input: {
  readonly packageManager: ProjectWorktreeSetupPackageManager;
  readonly devCommand: string;
  readonly flags: string;
}) {
  switch (input.packageManager) {
    case "npm":
    case "bun":
      return `${input.devCommand} -- ${input.flags}`;
    case "pnpm":
    case "yarn":
      return `${input.devCommand} ${input.flags}`;
    default:
      return null;
  }
}

function buildDevInvocation(profile: ProjectWorktreeSetupProfile): string {
  switch (profile.framework) {
    case "next":
      return (
        appendScriptFlags({
          packageManager: profile.packageManager,
          devCommand: profile.devCommand,
          flags: `-p "$PORT" -H "$HOST"`,
        }) ?? `PORT="$PORT" HOST="$HOST" ${profile.devCommand}`
      );
    case "vite":
    case "astro":
      return (
        appendScriptFlags({
          packageManager: profile.packageManager,
          devCommand: profile.devCommand,
          flags: `--host "$HOST" --port "$PORT"`,
        }) ?? `PORT="$PORT" HOST="$HOST" ${profile.devCommand}`
      );
    case "django":
      return `python manage.py runserver "$HOST:$PORT"`;
    case "rails":
      return `bin/rails server -b "$HOST" -p "$PORT"`;
    case "phoenix":
      return `PORT="$PORT" ${profile.devCommand}`;
    case "generic":
      return `PORT="$PORT" HOST="$HOST" ${profile.devCommand}`;
  }
}

function buildPowerShellDevInvocation(profile: ProjectWorktreeSetupProfile): string {
  switch (profile.framework) {
    case "next":
      return (
        appendPowerShellScriptFlags({
          packageManager: profile.packageManager,
          devCommand: profile.devCommand,
          flags: `-p "$env:PORT" -H "$env:HOST"`,
        }) ?? profile.devCommand
      );
    case "vite":
    case "astro":
      return (
        appendPowerShellScriptFlags({
          packageManager: profile.packageManager,
          devCommand: profile.devCommand,
          flags: `--host "$env:HOST" --port "$env:PORT"`,
        }) ?? profile.devCommand
      );
    case "django":
      return `python manage.py runserver "$($env:HOST):$($env:PORT)"`;
    case "rails":
      return `bin/rails server -b "$env:HOST" -p "$env:PORT"`;
    case "phoenix":
    case "generic":
      return profile.devCommand;
  }
}

export function buildSetupHelperContent(profile: ProjectWorktreeSetupProfile): string {
  const envBlock =
    profile.envStrategy !== "none" && profile.envSourcePath
      ? `
SOURCE_PATH="$DYNAMO_PROJECT_ROOT/${profile.envSourcePath}"
TARGET_PATH="$DYNAMO_WORKTREE_PATH/${profile.envSourcePath}"
if [[ -f "$SOURCE_PATH" ]]; then
  mkdir -p "\${TARGET_PATH:h}"
  if [[ ${shellQuote(profile.envStrategy)} == "symlink_root" ]]; then
    ln -sfn "$SOURCE_PATH" "$TARGET_PATH"
  else
    cp -f "$SOURCE_PATH" "$TARGET_PATH"
  fi
else
  echo "Dynamo warning: env source $SOURCE_PATH was not found."
fi
`
      : "";
  const installBlock = profile.installCommand
    ? `
cd "$DYNAMO_WORKTREE_PATH"
${profile.installCommand}
`
    : "";

  return `#!/usr/bin/env zsh
set -euo pipefail

ENV_FILE="\${DYNAMO_WORKTREE_ENV_FILE:?DYNAMO_WORKTREE_ENV_FILE is required}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing worktree setup env file: $ENV_FILE" >&2
  exit 1
fi

source "$ENV_FILE"
${envBlock}${installBlock}
echo "Worktree path: $DYNAMO_WORKTREE_PATH"
echo "Primary port: \${DYNAMO_PRIMARY_PORT:-unknown}"
echo "App URL: http://127.0.0.1:\${DYNAMO_PRIMARY_PORT:-unknown}"
`;
}

export function buildDevHelperContent(profile: ProjectWorktreeSetupProfile): string {
  const invocation = buildDevInvocation(profile);
  return `#!/usr/bin/env zsh
set -euo pipefail

ENV_FILE="\${DYNAMO_WORKTREE_ENV_FILE:?DYNAMO_WORKTREE_ENV_FILE is required}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing worktree setup env file: $ENV_FILE" >&2
  exit 1
fi

source "$ENV_FILE"
export PORT="\${DYNAMO_PRIMARY_PORT:-\${PORT:-41000}}"
export HOST="\${HOST:-127.0.0.1}"

cd "$DYNAMO_WORKTREE_PATH"
exec ${invocation}
	`;
}

function buildPowerShellEnvSyncBlock(profile: ProjectWorktreeSetupProfile): string {
  if (profile.envStrategy === "none" || !profile.envSourcePath) {
    return "";
  }

  return `
$sourcePath = Join-Path -Path $env:DYNAMO_PROJECT_ROOT -ChildPath ${powerShellQuote(profile.envSourcePath)}
$targetPath = Join-Path -Path $env:DYNAMO_WORKTREE_PATH -ChildPath ${powerShellQuote(profile.envSourcePath)}
if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
  $targetDir = Split-Path -Parent $targetPath
  if ($targetDir) {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  }
  if (${powerShellQuote(profile.envStrategy)} -eq 'symlink_root') {
    try {
      if (Test-Path -LiteralPath $targetPath) {
        Remove-Item -LiteralPath $targetPath -Force
      }
      New-Item -ItemType SymbolicLink -Path $targetPath -Target $sourcePath -Force | Out-Null
    } catch {
      Write-Warning "Dynamo warning: failed to symlink env source; copying instead. $($_.Exception.Message)"
      Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
    }
  } else {
    Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
  }
} else {
  Write-Host "Dynamo warning: env source $sourcePath was not found."
}
`;
}

function buildPowerShellExitBlock(): string {
  return `
if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
`;
}

function buildPowerShellHelperHeader(): string {
  return `$ErrorActionPreference = "Stop"

$envFile = $env:DYNAMO_WORKTREE_ENV_FILE
if ([string]::IsNullOrWhiteSpace($envFile)) {
  Write-Error "DYNAMO_WORKTREE_ENV_FILE is required"
  exit 1
}
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  Write-Error "Missing worktree setup env file: $envFile"
  exit 1
}

. $envFile
`;
}

export function buildPowerShellSetupHelperContent(profile: ProjectWorktreeSetupProfile): string {
  const envBlock = buildPowerShellEnvSyncBlock(profile);
  const installBlock = profile.installCommand
    ? `
Set-Location -LiteralPath $env:DYNAMO_WORKTREE_PATH
$installCommand = ${powerShellQuote(profile.installCommand)}
Invoke-Expression $installCommand
${buildPowerShellExitBlock()}`
    : "";

  return `${buildPowerShellHelperHeader()}${envBlock}${installBlock}
$primaryPort = $env:DYNAMO_PRIMARY_PORT
if ([string]::IsNullOrWhiteSpace($primaryPort)) {
  $primaryPort = "unknown"
}
Write-Host "Worktree path: $env:DYNAMO_WORKTREE_PATH"
Write-Host "Primary port: $primaryPort"
Write-Host "App URL: http://127.0.0.1:$primaryPort"
`;
}

export function buildPowerShellDevHelperContent(profile: ProjectWorktreeSetupProfile): string {
  const invocation = buildPowerShellDevInvocation(profile);
  return `${buildPowerShellHelperHeader()}
if (-not [string]::IsNullOrWhiteSpace($env:DYNAMO_PRIMARY_PORT)) {
  $env:PORT = $env:DYNAMO_PRIMARY_PORT
} elseif ([string]::IsNullOrWhiteSpace($env:PORT)) {
  $env:PORT = "41000"
}
if ([string]::IsNullOrWhiteSpace($env:HOST)) {
  $env:HOST = "127.0.0.1"
}

Set-Location -LiteralPath $env:DYNAMO_WORKTREE_PATH
$devCommand = ${powerShellQuote(invocation)}
Invoke-Expression $devCommand
${buildPowerShellExitBlock()}`;
}

function buildWindowsCommandWrapperContent(powerShellFileName: string): string {
  return `@echo off\r
setlocal\r
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0${powerShellFileName}"\r
exit /b %ERRORLEVEL%\r
`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

export function resolveWorktreeSetupHelperPaths(input: {
  readonly stateDir: string;
  readonly projectId: ProjectId;
  readonly profile: ProjectWorktreeSetupProfile;
}): WorktreeSetupHelperPaths {
  const helperRoot = path.join(
    input.stateDir,
    WORKTREE_SETUP_RUNTIME_DIR,
    "projects",
    encodePathSegment(input.projectId),
    input.profile.scanFingerprint,
  );
  return {
    helperRoot,
    setupHelperPath: path.join(helperRoot, WORKTREE_SETUP_HELPER_FILENAME),
    devHelperPath: path.join(helperRoot, WORKTREE_DEV_HELPER_FILENAME),
    setupPowerShellPath: path.join(helperRoot, WORKTREE_SETUP_POWERSHELL_HELPER_FILENAME),
    devPowerShellPath: path.join(helperRoot, WORKTREE_DEV_POWERSHELL_HELPER_FILENAME),
    setupWindowsCommandPath: path.join(helperRoot, WORKTREE_SETUP_WINDOWS_COMMAND_FILENAME),
    devWindowsCommandPath: path.join(helperRoot, WORKTREE_DEV_WINDOWS_COMMAND_FILENAME),
  };
}

async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
  await fs.chmod(filePath, 0o755);
}

export async function materializeWorktreeSetupHelpers(input: {
  readonly stateDir: string;
  readonly projectId: ProjectId;
  readonly profile: ProjectWorktreeSetupProfile;
}): Promise<WorktreeSetupHelperPaths> {
  const helperPaths = resolveWorktreeSetupHelperPaths(input);
  await writeExecutable(helperPaths.setupHelperPath, buildSetupHelperContent(input.profile));
  await writeExecutable(helperPaths.devHelperPath, buildDevHelperContent(input.profile));
  await writeExecutable(
    helperPaths.setupPowerShellPath,
    buildPowerShellSetupHelperContent(input.profile),
  );
  await writeExecutable(
    helperPaths.devPowerShellPath,
    buildPowerShellDevHelperContent(input.profile),
  );
  await writeExecutable(
    helperPaths.setupWindowsCommandPath,
    buildWindowsCommandWrapperContent(WORKTREE_SETUP_POWERSHELL_HELPER_FILENAME),
  );
  await writeExecutable(
    helperPaths.devWindowsCommandPath,
    buildWindowsCommandWrapperContent(WORKTREE_DEV_POWERSHELL_HELPER_FILENAME),
  );
  return helperPaths;
}

export async function resolveWorktreeGitAdminDir(worktreePath: string): Promise<string> {
  const dotGitPath = path.join(worktreePath, ".git");
  const dotGitStat = await fs.stat(dotGitPath).catch(() => null);
  if (dotGitStat === null) {
    throw new Error(`Worktree '${worktreePath}' is not a Git checkout.`);
  }
  if (dotGitStat.isDirectory()) {
    return dotGitPath;
  }
  if (!dotGitStat.isFile()) {
    throw new Error(`Worktree '${worktreePath}' has an invalid .git entry.`);
  }
  const pointer = await fs.readFile(dotGitPath, "utf8");
  const match = pointer.match(/^gitdir:\s*(.+)\s*$/im);
  if (!match?.[1]) {
    throw new Error(`Worktree '${worktreePath}' has an invalid .git pointer file.`);
  }
  const gitDir = path.resolve(worktreePath, match[1].trim());
  const gitDirStat = await fs.stat(gitDir).catch(() => null);
  if (gitDirStat === null || !gitDirStat.isDirectory()) {
    throw new Error(`Worktree '${worktreePath}' points to a missing Git admin dir.`);
  }
  return gitDir;
}

export function normalizePortBlockBase(hashSource: string, portCount: number): number {
  const normalizedPortCount = Math.max(1, portCount);
  const totalBlocks = Math.max(
    1,
    Math.floor(
      (WORKTREE_SETUP_PORT_RANGE_END - WORKTREE_SETUP_PORT_RANGE_START + 1) / normalizedPortCount,
    ),
  );
  const hash = crypto.createHash("sha1").update(hashSource).digest();
  const offset = hash.readUInt32BE(0) % totalBlocks;
  return WORKTREE_SETUP_PORT_RANGE_START + offset * normalizedPortCount;
}

function buildRuntimeEnvValues(input: {
  readonly projectCwd: string;
  readonly worktreePath: string;
  readonly profile: ProjectWorktreeSetupProfile;
}): Record<string, string> {
  const portCount = Math.max(1, input.profile.portCount);
  const primaryPort = normalizePortBlockBase(
    `${input.projectCwd}\0${input.worktreePath}\0${input.profile.scanFingerprint}`,
    portCount,
  );
  const env: Record<string, string> = {
    DYNAMO_PROJECT_ROOT: input.projectCwd,
    DYNAMO_WORKTREE_PATH: input.worktreePath,
    DYNAMO_PRIMARY_PORT: String(primaryPort),
    T3CODE_PROJECT_ROOT: input.projectCwd,
    T3CODE_WORKTREE_PATH: input.worktreePath,
    T3CODE_PRIMARY_PORT: String(primaryPort),
  };
  for (let index = 0; index < portCount; index += 1) {
    env[`DYNAMO_PORT_${index + 1}`] = String(primaryPort + index);
  }
  return env;
}

export function serializeWorktreeRuntimeEnv(values: Record<string, string>): string {
  return `${Object.entries(values)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n")}\n`;
}

export function serializePowerShellWorktreeRuntimeEnv(values: Record<string, string>): string {
  return `${Object.entries(values)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `$env:${key} = ${powerShellQuote(value)}`)
    .join("\n")}\n`;
}

export async function prepareWorktreeSetupRuntime(input: {
  readonly stateDir: string;
  readonly projectId: ProjectId;
  readonly projectCwd: string;
  readonly worktreePath: string;
  readonly profile: ProjectWorktreeSetupProfile;
}): Promise<WorktreeRuntimePreparation> {
  const gitAdminDir = await resolveWorktreeGitAdminDir(input.worktreePath);
  const envFilePath = path.join(gitAdminDir, WORKTREE_ENV_RELATIVE_PATH);
  const powerShellEnvFilePath = path.join(gitAdminDir, WORKTREE_POWERSHELL_ENV_RELATIVE_PATH);
  const env = buildRuntimeEnvValues(input);
  const helperPaths = await materializeWorktreeSetupHelpers(input);
  await fs.mkdir(path.dirname(envFilePath), { recursive: true });
  await fs.writeFile(envFilePath, serializeWorktreeRuntimeEnv(env), "utf8");
  await fs.mkdir(path.dirname(powerShellEnvFilePath), { recursive: true });
  await fs.writeFile(powerShellEnvFilePath, serializePowerShellWorktreeRuntimeEnv(env), "utf8");
  return {
    envFilePath,
    powerShellEnvFilePath,
    helperPaths,
    env,
  };
}
