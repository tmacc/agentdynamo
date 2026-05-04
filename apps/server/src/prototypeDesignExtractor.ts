import { constants } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const DYNAMO_DESIGN_EXTRACT_ENV = "DYNAMO_DESIGN_EXTRACT";
export const DYNAMO_DESIGN_EXTRACT_APP_ROOT_ENV = "DYNAMO_DESIGN_EXTRACT_APP_ROOT";
export const DYNAMO_PROTOTYPE_VIEWER_ENV = "DYNAMO_PROTOTYPE_VIEWER";

const EXTRACTOR_SCRIPT_RELATIVE_PATH = path.join("scripts", "dynamo-design-extract.ts");
const EXTRACTOR_COMMAND_NAME = "dynamo-design-extract";
const VIEWER_SCRIPT_RELATIVE_PATH = path.join("scripts", "dynamo-prototype-viewer.ts");
const VIEWER_COMMAND_NAME = "dynamo-prototype-viewer";

export interface PrototypeDesignExtractorShimInstallResult {
  readonly installed: boolean;
  readonly appRoot: string | undefined;
  readonly commandPath: string | undefined;
  readonly binDir: string | undefined;
}

interface PrototypeDesignExtractorShimOptions {
  readonly stateDir: string;
  readonly cwd?: string;
  readonly moduleDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

interface PrototypeAppCommandShimOptions extends PrototypeDesignExtractorShimOptions {
  readonly scriptRelativePath: string;
  readonly commandName: string;
  readonly envName: string;
}

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const unique = <T>(values: readonly T[]): T[] => Array.from(new Set(values));

const findAncestorWithScript = async (
  startDir: string,
  scriptRelativePath: string,
): Promise<string | undefined> => {
  let current = path.resolve(startDir);
  while (true) {
    if (await pathExists(path.join(current, scriptRelativePath))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};

export async function resolvePrototypeDesignExtractorAppRoot(options?: {
  readonly cwd?: string;
  readonly moduleDir?: string;
}): Promise<string | undefined> {
  const candidates = unique([
    options?.cwd ?? process.cwd(),
    options?.moduleDir ?? import.meta.dirname,
  ]);

  for (const candidate of candidates) {
    const appRoot = await findAncestorWithScript(candidate, EXTRACTOR_SCRIPT_RELATIVE_PATH);
    if (appRoot) {
      return appRoot;
    }
  }

  return undefined;
}

const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function buildPosixPrototypeDesignExtractorShim(appRoot: string): string {
  return buildPosixPrototypeAppCommandShim({
    appRoot,
    scriptRelativePath: EXTRACTOR_SCRIPT_RELATIVE_PATH,
    commandName: EXTRACTOR_COMMAND_NAME,
    unavailableLabel: "Dynamo design extractor",
  });
}

export function buildPosixPrototypeViewerShim(appRoot: string): string {
  return buildPosixPrototypeAppCommandShim({
    appRoot,
    scriptRelativePath: VIEWER_SCRIPT_RELATIVE_PATH,
    commandName: VIEWER_COMMAND_NAME,
    unavailableLabel: "Dynamo prototype viewer",
  });
}

function buildPosixPrototypeAppCommandShim({
  appRoot,
  scriptRelativePath,
  commandName,
  unavailableLabel,
}: {
  readonly appRoot: string;
  readonly scriptRelativePath: string;
  readonly commandName: string;
  readonly unavailableLabel: string;
}): string {
  const quotedAppRoot = shellSingleQuote(appRoot);
  return `#!/bin/sh
set -eu
APP_ROOT=${quotedAppRoot}
EXTRACTOR_SCRIPT="$APP_ROOT/${scriptRelativePath}"
if [ ! -f "$EXTRACTOR_SCRIPT" ]; then
  echo "${unavailableLabel} is unavailable. Expected $EXTRACTOR_SCRIPT." >&2
  exit 2
fi
cd "$APP_ROOT"
exec bun run ${commandName} "$@"
`;
}

export function buildWindowsPrototypeDesignExtractorShim(appRoot: string): string {
  return buildWindowsPrototypeAppCommandShim({
    appRoot,
    scriptRelativePath: EXTRACTOR_SCRIPT_RELATIVE_PATH,
    commandName: EXTRACTOR_COMMAND_NAME,
    unavailableLabel: "Dynamo design extractor",
  });
}

export function buildWindowsPrototypeViewerShim(appRoot: string): string {
  return buildWindowsPrototypeAppCommandShim({
    appRoot,
    scriptRelativePath: VIEWER_SCRIPT_RELATIVE_PATH,
    commandName: VIEWER_COMMAND_NAME,
    unavailableLabel: "Dynamo prototype viewer",
  });
}

function buildWindowsPrototypeAppCommandShim({
  appRoot,
  scriptRelativePath,
  commandName,
  unavailableLabel,
}: {
  readonly appRoot: string;
  readonly scriptRelativePath: string;
  readonly commandName: string;
  readonly unavailableLabel: string;
}): string {
  return `@echo off
setlocal
set "APP_ROOT=${appRoot}"
set "EXTRACTOR_SCRIPT=%APP_ROOT%\\${scriptRelativePath.replaceAll(path.sep, "\\")}"
if not exist "%EXTRACTOR_SCRIPT%" (
  echo ${unavailableLabel} is unavailable. Expected %EXTRACTOR_SCRIPT%. 1>&2
  exit /b 2
)
cd /d "%APP_ROOT%"
bun run ${commandName} %*
`;
}

const prependPathEntry = (env: NodeJS.ProcessEnv, binDir: string) => {
  const currentPath = env.PATH ?? "";
  const entries = currentPath.split(path.delimiter).filter(Boolean);
  if (entries.includes(binDir)) {
    return;
  }
  env.PATH = currentPath ? `${binDir}${path.delimiter}${currentPath}` : binDir;
};

export async function installPrototypeDesignExtractorShim({
  stateDir,
  cwd,
  moduleDir,
  env = process.env,
  platform = process.platform,
}: PrototypeDesignExtractorShimOptions): Promise<PrototypeDesignExtractorShimInstallResult> {
  return installPrototypeAppCommandShim({
    stateDir,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(moduleDir !== undefined ? { moduleDir } : {}),
    env,
    platform,
    scriptRelativePath: EXTRACTOR_SCRIPT_RELATIVE_PATH,
    commandName: EXTRACTOR_COMMAND_NAME,
    envName: DYNAMO_DESIGN_EXTRACT_ENV,
  });
}

export async function installPrototypeViewerShim({
  stateDir,
  cwd,
  moduleDir,
  env = process.env,
  platform = process.platform,
}: PrototypeDesignExtractorShimOptions): Promise<PrototypeDesignExtractorShimInstallResult> {
  return installPrototypeAppCommandShim({
    stateDir,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(moduleDir !== undefined ? { moduleDir } : {}),
    env,
    platform,
    scriptRelativePath: VIEWER_SCRIPT_RELATIVE_PATH,
    commandName: VIEWER_COMMAND_NAME,
    envName: DYNAMO_PROTOTYPE_VIEWER_ENV,
  });
}

async function installPrototypeAppCommandShim({
  stateDir,
  cwd,
  moduleDir,
  env,
  platform,
  scriptRelativePath,
  commandName,
  envName,
}: PrototypeAppCommandShimOptions): Promise<PrototypeDesignExtractorShimInstallResult> {
  const targetEnv = env ?? process.env;
  const appRoot = await resolvePrototypeDesignExtractorAppRoot({
    ...(cwd !== undefined ? { cwd } : {}),
    ...(moduleDir !== undefined ? { moduleDir } : {}),
  });
  if (appRoot && !(await pathExists(path.join(appRoot, scriptRelativePath)))) {
    return {
      installed: false,
      appRoot: undefined,
      commandPath: undefined,
      binDir: undefined,
    };
  }
  if (!appRoot) {
    return {
      installed: false,
      appRoot: undefined,
      commandPath: undefined,
      binDir: undefined,
    };
  }

  const binDir = path.join(stateDir, "bin");
  await mkdir(binDir, { recursive: true });

  const commandPath = path.join(binDir, platform === "win32" ? `${commandName}.cmd` : commandName);
  const shim =
    platform === "win32"
      ? buildWindowsPrototypeAppCommandShim({
          appRoot,
          scriptRelativePath,
          commandName,
          unavailableLabel:
            commandName === EXTRACTOR_COMMAND_NAME
              ? "Dynamo design extractor"
              : "Dynamo prototype viewer",
        })
      : buildPosixPrototypeAppCommandShim({
          appRoot,
          scriptRelativePath,
          commandName,
          unavailableLabel:
            commandName === EXTRACTOR_COMMAND_NAME
              ? "Dynamo design extractor"
              : "Dynamo prototype viewer",
        });

  await writeFile(commandPath, shim, "utf8");
  if (platform !== "win32") {
    await chmod(commandPath, 0o755);
  }

  targetEnv[envName] = commandPath;
  targetEnv[DYNAMO_DESIGN_EXTRACT_APP_ROOT_ENV] = appRoot;
  prependPathEntry(targetEnv, binDir);

  return {
    installed: true,
    appRoot,
    commandPath,
    binDir,
  };
}
