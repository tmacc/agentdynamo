import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const electronDownloadSkipEnvKeys = [
  "ELECTRON_SKIP_BINARY_DOWNLOAD",
  "npm_config_electron_skip_binary_download",
  "npm_package_config_electron_skip_binary_download",
];

const electronPackageJsonPath = require.resolve("electron/package.json");
const electronPackageDir = dirname(electronPackageJsonPath);
const electronDistDir = join(electronPackageDir, "dist");
const electronPathTxtPath = join(electronPackageDir, "path.txt");
const electronPlatformPath = getElectronPlatformPath();
const electronExecutablePath = join(electronDistDir, electronPlatformPath);

function getElectronPlatformPath() {
  const platform = process.env.npm_config_platform || process.platform;

  switch (platform) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

function getElectronBinaryStatus() {
  try {
    const electronPath = require("electron");
    if (typeof electronPath === "string" && existsSync(electronPath)) {
      return { ok: true, electronPath };
    }

    return {
      ok: false,
      electronPath,
      error: new Error(`Electron resolved to a missing binary path: ${String(electronPath)}`),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Electron failed to install correctly")) {
      return { ok: false, error };
    }
    throw error;
  }
}

function resetElectronRequireCache() {
  delete require.cache[require.resolve("electron")];
}

function repairElectronPathFileFromExtractedBinary() {
  if (existsSync(electronPathTxtPath) || !existsSync(electronExecutablePath)) {
    return false;
  }

  writeFileSync(electronPathTxtPath, electronPlatformPath);
  resetElectronRequireCache();
  return true;
}

function createElectronInstallEnv() {
  const env = { ...process.env };
  const removedKeys = [];

  for (const key of electronDownloadSkipEnvKeys) {
    if (key in env) {
      removedKeys.push(key);
      delete env[key];
    }
  }

  return { env, removedKeys };
}

function formatElectronDiagnostics(status) {
  const pathTxt = existsSync(electronPathTxtPath)
    ? readFileSync(electronPathTxtPath, "utf8").trim()
    : "<missing>";
  const skipEnv = electronDownloadSkipEnvKeys.filter((key) => key in process.env);

  return [
    `packageDir=${electronPackageDir}`,
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    `distExists=${existsSync(electronDistDir)}`,
    `executablePath=${electronExecutablePath}`,
    `executableExists=${existsSync(electronExecutablePath)}`,
    `pathTxt=${pathTxt || "<empty>"}`,
    `resolvedPath=${status.electronPath ?? "<unresolved>"}`,
    `skipDownloadEnv=${skipEnv.length > 0 ? skipEnv.join(",") : "<unset>"}`,
    `lastError=${status.error instanceof Error ? status.error.message : "<none>"}`,
  ].join("\n");
}

let electronStatus = getElectronBinaryStatus();

if (!electronStatus.ok) {
  if (repairElectronPathFileFromExtractedBinary()) {
    electronStatus = getElectronBinaryStatus();
  }
}

if (!electronStatus.ok) {
  rmSync(electronDistDir, { recursive: true, force: true });
  rmSync(electronPathTxtPath, { force: true });
  resetElectronRequireCache();

  const { env, removedKeys } = createElectronInstallEnv();
  if (removedKeys.length > 0) {
    console.warn(
      `Electron binary download was disabled by ${removedKeys.join(
        ", ",
      )}; overriding for desktop tests.`,
    );
  }

  const installScriptPath = join(electronPackageDir, "install.js");
  const result = spawnSync(process.execPath, [installScriptPath], {
    env,
    stdio: "inherit",
  });

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  resetElectronRequireCache();
  repairElectronPathFileFromExtractedBinary();
  electronStatus = getElectronBinaryStatus();
}

if (!electronStatus.ok) {
  throw new Error(
    `Electron binary is still unavailable after running the Electron install script.\n${formatElectronDiagnostics(
      electronStatus,
    )}`,
  );
}
