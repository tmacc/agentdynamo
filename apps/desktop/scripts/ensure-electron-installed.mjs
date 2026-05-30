import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function hasUsableElectronBinary() {
  try {
    require("electron");
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Electron failed to install correctly")) {
      return false;
    }
    throw error;
  }
}

if (!hasUsableElectronBinary()) {
  const electronPackageJsonPath = require.resolve("electron/package.json");
  const electronPackageDir = dirname(electronPackageJsonPath);
  rmSync(join(electronPackageDir, "dist"), { recursive: true, force: true });
  rmSync(join(electronPackageDir, "path.txt"), { force: true });

  const installScriptPath = join(electronPackageDir, "install.js");
  const result = spawnSync(process.execPath, [installScriptPath], {
    env: process.env,
    stdio: "inherit",
  });

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!hasUsableElectronBinary()) {
  throw new Error(
    "Electron binary is still unavailable after running the Electron install script.",
  );
}
