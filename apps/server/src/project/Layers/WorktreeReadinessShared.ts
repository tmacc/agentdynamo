import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  ProjectScript,
  ProjectWorktreeReadinessEnvStrategy,
  ProjectWorktreeReadinessFramework,
  ProjectWorktreeReadinessPackageManager,
  ProjectWorktreeReadinessProfile,
  ProjectWorktreeReadinessProposedFile,
  ProjectWorktreeReadinessProposedScript,
  ProjectWorktreeReadinessRecommendation,
  ProjectWorktreeReadinessWarning,
} from "@t3tools/contracts";

export const WORKTREE_SETUP_SCRIPT_PATH = ".t3code/worktree/setup.sh";
export const WORKTREE_DEV_SCRIPT_PATH = ".t3code/worktree/dev.sh";
export const WORKTREE_LOCAL_ENV_PATH = ".t3code/worktree.local.env";
export const WORKTREE_MANAGED_HEADER =
  "# T3 Code managed file. Reapply Worktree Readiness to regenerate this file.";
const WORKTREE_PORT_RANGE_START = 41000;
const WORKTREE_PORT_RANGE_END = 61000;
const DEFAULT_PORT_COUNT = 5;

type PackageJson = {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export interface WorktreeReadinessAnalysis {
  readonly scanFingerprint: string;
  readonly detectedProjectType: string;
  readonly recommendation: ProjectWorktreeReadinessRecommendation;
  readonly warnings: ReadonlyArray<ProjectWorktreeReadinessWarning>;
  readonly proposedScripts: ReadonlyArray<ProjectWorktreeReadinessProposedScript>;
  readonly proposedFiles: ReadonlyArray<ProjectWorktreeReadinessProposedFile>;
  readonly generatedFiles: ReadonlyArray<string>;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
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
  const packageJsonPath = path.join(projectCwd, "package.json");
  const content = await readOptionalFile(packageJsonPath);
  if (!content) {
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
}): ProjectWorktreeReadinessFramework {
  const dependencies = {
    ...(input.packageJson?.dependencies ?? {}),
    ...(input.packageJson?.devDependencies ?? {}),
  };

  if (dependencies.next) {
    return "next";
  }
  if (dependencies.astro) {
    return "astro";
  }
  if (dependencies.vite || dependencies["@vitejs/plugin-react"]) {
    return "vite";
  }
  if (input.filePresence.get("manage.py")) {
    return "django";
  }
  if (input.filePresence.get("bin/rails") || input.filePresence.get("Gemfile")) {
    return "rails";
  }
  if (input.filePresence.get("mix.exs")) {
    return "phoenix";
  }
  return "generic";
}

function detectPackageManager(input: {
  readonly packageJson: PackageJson | null;
  readonly filePresence: ReadonlyMap<string, boolean>;
}): ProjectWorktreeReadinessPackageManager {
  const declared = input.packageJson?.packageManager?.split("@")[0]?.trim();
  if (declared === "bun" || declared === "pnpm" || declared === "npm" || declared === "yarn") {
    return declared;
  }
  if (input.filePresence.get("bun.lock") || input.filePresence.get("bun.lockb")) {
    return "bun";
  }
  if (input.filePresence.get("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (input.filePresence.get("package-lock.json")) {
    return "npm";
  }
  if (input.filePresence.get("yarn.lock")) {
    return "yarn";
  }
  if (input.filePresence.get("pyproject.toml")) {
    const pyproject = input.filePresence.get("poetry.lock") ? "poetry" : "uv";
    return pyproject;
  }
  if (input.filePresence.get("requirements.txt")) {
    return "pip";
  }
  if (input.filePresence.get("Gemfile")) {
    return "bundle";
  }
  if (input.filePresence.get("mix.exs")) {
    return "mix";
  }
  return "unknown";
}

function detectInstallCommand(
  packageManager: ProjectWorktreeReadinessPackageManager,
): string | null {
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
    default:
      return null;
  }
}

function detectDevCommand(input: {
  readonly framework: ProjectWorktreeReadinessFramework;
  readonly packageManager: ProjectWorktreeReadinessPackageManager;
  readonly packageJson: PackageJson | null;
  readonly filePresence: ReadonlyMap<string, boolean>;
}): string | null {
  const packageManagerDevCommand =
    input.packageManager === "npm"
      ? "npm run dev"
      : input.packageManager === "bun"
        ? "bun run dev"
        : input.packageManager === "pnpm"
          ? "pnpm dev"
          : input.packageManager === "yarn"
            ? "yarn dev"
            : null;
  const scriptDev = input.packageJson?.scripts?.dev?.trim();
  if (scriptDev && packageManagerDevCommand) {
    return packageManagerDevCommand;
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
      return packageManagerDevCommand;
    default:
      return null;
  }
}

async function detectEnvSourcePath(projectCwd: string): Promise<string | null> {
  const candidates = [".env.local", ".env.development", ".env"];
  for (const candidate of candidates) {
    if (await fileExists(path.join(projectCwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

async function detectEnvTemplatePath(projectCwd: string): Promise<string | null> {
  const candidates = [".env.local.example", ".env.example"];
  for (const candidate of candidates) {
    if (await fileExists(path.join(projectCwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

function buildFrameworkDevInvocation(input: {
  readonly framework: ProjectWorktreeReadinessFramework;
  readonly packageManager: ProjectWorktreeReadinessPackageManager;
  readonly devCommand: string;
}): string {
  const appendScriptFlags = (flags: string) => {
    switch (input.packageManager) {
      case "npm":
      case "bun":
        return `${input.devCommand} -- ${flags}`;
      case "pnpm":
      case "yarn":
        return `${input.devCommand} ${flags}`;
      default:
        return null;
    }
  };

  switch (input.framework) {
    case "next":
      return (
        appendScriptFlags(`-p "$T3CODE_PRIMARY_PORT" -H "$HOST"`) ??
        `PORT="$T3CODE_PRIMARY_PORT" HOST="$HOST" ${input.devCommand}`
      );
    case "vite":
      return (
        appendScriptFlags(`--host "$HOST" --port "$T3CODE_PRIMARY_PORT"`) ??
        `PORT="$T3CODE_PRIMARY_PORT" HOST="$HOST" ${input.devCommand}`
      );
    case "astro":
      return (
        appendScriptFlags(`--host "$HOST" --port "$T3CODE_PRIMARY_PORT"`) ??
        `PORT="$T3CODE_PRIMARY_PORT" HOST="$HOST" ${input.devCommand}`
      );
    case "django":
      return `python manage.py runserver "$HOST:$T3CODE_PRIMARY_PORT"`;
    case "rails":
      return `bin/rails server -b "$HOST" -p "$T3CODE_PRIMARY_PORT"`;
    case "phoenix":
      return `PORT="$T3CODE_PRIMARY_PORT" ${input.devCommand}`;
    default:
      return `PORT="$T3CODE_PRIMARY_PORT" HOST="$HOST" ${input.devCommand}`;
  }
}

export function buildSetupScriptContent(input: {
  readonly installCommand: string | null;
  readonly envStrategy: ProjectWorktreeReadinessEnvStrategy;
  readonly envSourcePath: string | null;
}): string {
  const envBlock =
    input.envStrategy !== "none" && input.envSourcePath
      ? `
SOURCE_PATH="$PROJECT_ROOT/${input.envSourcePath}"
TARGET_PATH="$WORKTREE_ROOT/${input.envSourcePath}"
if [[ -f "$SOURCE_PATH" ]]; then
  mkdir -p "\${TARGET_PATH:h}"
  if [[ ${shellQuote(input.envStrategy)} == 'symlink_root' ]]; then
    ln -sfn "$SOURCE_PATH" "$TARGET_PATH"
  else
    cp -f "$SOURCE_PATH" "$TARGET_PATH"
  fi
else
  echo "T3 Code warning: env source $SOURCE_PATH was not found."
fi
`
      : "";

  const installBlock = input.installCommand
    ? `
cd "$WORKTREE_ROOT"
${input.installCommand}
`
    : "";

  return `#!/usr/bin/env zsh
set -euo pipefail

${WORKTREE_MANAGED_HEADER}
# Manual edits may be overwritten the next time Worktree Readiness is applied.

SCRIPT_DIR=\${0:A:h}
WORKTREE_ROOT=\${SCRIPT_DIR:h:h}
PROJECT_ROOT=\${T3CODE_PROJECT_ROOT:-$WORKTREE_ROOT}
LOCAL_ENV_PATH="$WORKTREE_ROOT/${WORKTREE_LOCAL_ENV_PATH}"

mkdir -p "$WORKTREE_ROOT/.t3code"
if [[ ! -f "$LOCAL_ENV_PATH" ]]; then
  echo "Missing $LOCAL_ENV_PATH. Re-run Setup worktree from T3 Code."
  exit 1
fi

source "$LOCAL_ENV_PATH"
${envBlock}${installBlock}
echo "Worktree path: $WORKTREE_ROOT"
echo "Primary port: \${T3CODE_PRIMARY_PORT:-unknown}"
echo "App URL: http://127.0.0.1:\${T3CODE_PRIMARY_PORT:-unknown}"
`;
}

export function buildDevScriptContent(input: {
  readonly framework: ProjectWorktreeReadinessFramework;
  readonly packageManager: ProjectWorktreeReadinessPackageManager;
  readonly devCommand: string;
}): string {
  const invocation = buildFrameworkDevInvocation(input);
  return `#!/usr/bin/env zsh
set -euo pipefail

${WORKTREE_MANAGED_HEADER}
# Manual edits may be overwritten the next time Worktree Readiness is applied.

SCRIPT_DIR=\${0:A:h}
WORKTREE_ROOT=\${SCRIPT_DIR:h:h}
LOCAL_ENV_PATH="$WORKTREE_ROOT/${WORKTREE_LOCAL_ENV_PATH}"

if [[ -f "$LOCAL_ENV_PATH" ]]; then
  source "$LOCAL_ENV_PATH"
fi

export PORT="\${T3CODE_PRIMARY_PORT:-\${PORT:-41000}}"
export HOST="\${HOST:-127.0.0.1}"

cd "$WORKTREE_ROOT"
exec ${invocation}
`;
}

export function buildManagedScripts(input: {
  readonly recommendation: ProjectWorktreeReadinessRecommendation;
}): ReadonlyArray<ProjectScript> {
  const setupCommand = WORKTREE_SETUP_SCRIPT_PATH;
  const devCommand = WORKTREE_DEV_SCRIPT_PATH;
  return [
    {
      id: "setup-worktree",
      name: "Setup worktree",
      command: setupCommand,
      icon: "configure",
      runOnWorktreeCreate: true,
    },
    {
      id: "run-dev",
      name: "Run dev",
      command: devCommand,
      icon: "play",
      runOnWorktreeCreate: false,
    },
  ];
}

export function buildManagedWorktreeScriptFiles(input: {
  readonly installCommand: string | null;
  readonly envStrategy: ProjectWorktreeReadinessEnvStrategy;
  readonly envSourcePath: string | null;
  readonly framework: ProjectWorktreeReadinessFramework;
  readonly packageManager: ProjectWorktreeReadinessPackageManager;
  readonly devCommand: string | null;
}): ReadonlyArray<readonly [string, string]> {
  const setupContent = buildSetupScriptContent({
    installCommand: input.installCommand,
    envStrategy: input.envStrategy,
    envSourcePath: input.envSourcePath,
  });
  const devContent = buildDevScriptContent({
    framework: input.framework,
    packageManager: input.packageManager,
    devCommand:
      input.devCommand ??
      "zsh -lc 'echo \"No dev command configured for this worktree.\" >&2; exit 1'",
  });

  return [
    [WORKTREE_SETUP_SCRIPT_PATH, setupContent],
    [WORKTREE_DEV_SCRIPT_PATH, devContent],
  ] as const;
}

export function mergeReadinessScripts(
  existingScripts: ReadonlyArray<ProjectScript>,
  nextManagedScripts: ReadonlyArray<ProjectScript>,
): ReadonlyArray<ProjectScript> {
  const byId = new Map(existingScripts.map((script) => [script.id, script] as const));
  const [nextSetupScript, nextDevScript] = nextManagedScripts;
  const nextSetupCommand = nextSetupScript?.command ?? WORKTREE_SETUP_SCRIPT_PATH;

  const preserved = existingScripts.map((script) => {
    if (script.id === nextSetupScript?.id) {
      return nextSetupScript;
    }
    if (script.id === nextDevScript?.id) {
      return nextDevScript;
    }
    if (script.runOnWorktreeCreate && script.command !== nextSetupCommand) {
      return { ...script, runOnWorktreeCreate: false };
    }
    return script;
  });

  const results = [...preserved];
  for (const managedScript of nextManagedScripts) {
    if (!byId.has(managedScript.id)) {
      results.push(managedScript);
    }
  }

  let setupAssigned = false;
  return results.map((script) => {
    if (!script.runOnWorktreeCreate) {
      return script;
    }
    if (!setupAssigned && script.command === nextSetupCommand) {
      setupAssigned = true;
      return script;
    }
    return { ...script, runOnWorktreeCreate: false };
  });
}

export async function computeReadinessAnalysis(input: {
  readonly projectCwd: string;
  readonly profile?: ProjectWorktreeReadinessProfile | null;
}): Promise<WorktreeReadinessAnalysis> {
  const trackedFiles = [
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
    WORKTREE_SETUP_SCRIPT_PATH,
    WORKTREE_DEV_SCRIPT_PATH,
  ];

  const filePresence = new Map<string, boolean>();
  const fingerprint = crypto.createHash("sha256");
  for (const relativePath of trackedFiles) {
    const absolutePath = path.join(input.projectCwd, relativePath);
    const exists = await fileExists(absolutePath);
    filePresence.set(relativePath, exists);
    if (!exists) {
      fingerprint.update(relativePath);
      fingerprint.update("\0missing\0");
      continue;
    }
    const content = await readOptionalFile(absolutePath);
    fingerprint.update(relativePath);
    fingerprint.update("\0");
    fingerprint.update(content ?? "");
    fingerprint.update("\0");
  }
  const scanFingerprint = fingerprint.digest("hex");

  const packageJson = await readPackageJson(input.projectCwd);
  const framework = detectFramework({ packageJson, filePresence });
  const packageManager = detectPackageManager({ packageJson, filePresence });
  const installCommand = detectInstallCommand(packageManager);
  const devCommand = detectDevCommand({
    framework,
    packageManager,
    packageJson,
    filePresence,
  });
  const envSourcePath = await detectEnvSourcePath(input.projectCwd);
  const envTemplatePath =
    envSourcePath === null ? await detectEnvTemplatePath(input.projectCwd) : null;
  const envStrategy: ProjectWorktreeReadinessEnvStrategy = envSourcePath ? "symlink_root" : "none";
  const recommendation: ProjectWorktreeReadinessRecommendation = {
    packageManager,
    framework,
    installCommand,
    devCommand,
    envStrategy,
    envSourcePath,
    portCount: DEFAULT_PORT_COUNT,
    confidence: devCommand ? (framework === "generic" ? "medium" : "high") : "low",
  };

  const generatedFiles = [WORKTREE_SETUP_SCRIPT_PATH, WORKTREE_DEV_SCRIPT_PATH];
  const setupContent = buildSetupScriptContent({
    installCommand: recommendation.installCommand,
    envStrategy: recommendation.envStrategy,
    envSourcePath: recommendation.envSourcePath,
  });
  const devContent = buildDevScriptContent({
    framework: recommendation.framework,
    packageManager: recommendation.packageManager,
    devCommand: recommendation.devCommand ?? "echo 'Add a dev command before running this script.'",
  });
  const proposedFiles: ProjectWorktreeReadinessProposedFile[] = [];
  for (const [relativePath, contentPreview] of [
    [WORKTREE_SETUP_SCRIPT_PATH, setupContent],
    [WORKTREE_DEV_SCRIPT_PATH, devContent],
  ] as const) {
    const existing = await readOptionalFile(path.join(input.projectCwd, relativePath));
    proposedFiles.push({
      path: relativePath,
      managed: true,
      contentPreview,
      action: existing === null ? "create" : existing === contentPreview ? "preserve" : "update",
    });
  }

  const warnings: ProjectWorktreeReadinessWarning[] = [];
  if (!recommendation.devCommand) {
    warnings.push({
      id: "missing-dev-command",
      message: "No dev command was detected. Enter one before applying worktree readiness.",
      severity: "warning",
    });
  }
  if (recommendation.envStrategy === "none") {
    warnings.push({
      id: "missing-env-source",
      message:
        envTemplatePath !== null
          ? `Only ${envTemplatePath} was detected. Worktree readiness will skip env file linking until a real env file is present.`
          : "No root env file was detected. Worktree readiness will skip env file linking.",
      severity: "info",
    });
  }
  if (input.profile && input.profile.scanFingerprint !== scanFingerprint) {
    warnings.push({
      id: "stale-readiness-profile",
      message: "The saved worktree readiness profile is stale and should be reviewed.",
      severity: "warning",
    });
  }

  return {
    scanFingerprint,
    detectedProjectType: framework === "generic" ? packageManager : framework,
    recommendation,
    warnings,
    proposedScripts: [
      {
        kind: "setup",
        label: "Setup worktree",
        command: WORKTREE_SETUP_SCRIPT_PATH,
      },
      {
        kind: "dev",
        label: "Run dev",
        command: WORKTREE_DEV_SCRIPT_PATH,
      },
    ],
    proposedFiles,
    generatedFiles,
  };
}

export function isManagedWorktreeFile(content: string): boolean {
  return content.includes(WORKTREE_MANAGED_HEADER);
}

export async function writeExecutableFile(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
  await fs.chmod(filePath, 0o755);
}

export async function materializeManagedWorktreeScripts(input: {
  readonly rootPath: string;
  readonly installCommand: string | null;
  readonly envStrategy: ProjectWorktreeReadinessEnvStrategy;
  readonly envSourcePath: string | null;
  readonly framework: ProjectWorktreeReadinessFramework;
  readonly packageManager: ProjectWorktreeReadinessPackageManager;
  readonly devCommand: string | null;
}): Promise<ReadonlyArray<string>> {
  const files = buildManagedWorktreeScriptFiles({
    installCommand: input.installCommand,
    envStrategy: input.envStrategy,
    envSourcePath: input.envSourcePath,
    framework: input.framework,
    packageManager: input.packageManager,
    devCommand: input.devCommand,
  });

  for (const [relativePath, content] of files) {
    await writeExecutableFile(path.join(input.rootPath, relativePath), content);
  }

  return files.map(([relativePath]) => relativePath);
}

export async function ensureGitignoreEntry(projectCwd: string, entry: string): Promise<boolean> {
  const gitignorePath = path.join(projectCwd, ".gitignore");
  const existing = (await readOptionalFile(gitignorePath)) ?? "";
  const normalized = existing.split(/\r?\n/);
  if (normalized.includes(entry)) {
    return false;
  }
  const next = `${existing.trimEnd()}${existing.length > 0 ? "\n" : ""}${entry}\n`;
  await fs.writeFile(gitignorePath, next, "utf8");
  return true;
}

export async function readWorktreeLocalEnv(
  envFilePath: string,
): Promise<Record<string, string> | null> {
  const content = await readOptionalFile(envFilePath);
  if (!content) {
    return null;
  }
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    values[trimmed.slice(0, separatorIndex)] = trimmed.slice(separatorIndex + 1);
  }
  return values;
}

export function serializeWorktreeLocalEnv(values: Record<string, string>): string {
  const orderedEntries = Object.entries(values).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `${orderedEntries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

export function normalizePortBlockBase(hashSource: string, portCount: number): number {
  const totalBlocks = Math.max(
    1,
    Math.floor((WORKTREE_PORT_RANGE_END - WORKTREE_PORT_RANGE_START + 1) / Math.max(1, portCount)),
  );
  const hash = crypto.createHash("sha1").update(hashSource).digest();
  const offset = hash.readUInt32BE(0) % totalBlocks;
  return WORKTREE_PORT_RANGE_START + offset * portCount;
}
