import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DYNAMO_DESIGN_EXTRACT_APP_ROOT_ENV,
  DYNAMO_DESIGN_EXTRACT_ENV,
  DYNAMO_PROTOTYPE_VIEWER_ENV,
  installPrototypeDesignExtractorShim,
  installPrototypeViewerShim,
  resolvePrototypeDesignExtractorAppRoot,
} from "./prototypeDesignExtractor.ts";

const makeTempDir = (prefix: string) => mkdtemp(path.join(os.tmpdir(), prefix));

describe("prototype design extractor shim", () => {
  it("resolves the Dynamo app root from a nested directory", async () => {
    const appRoot = await makeTempDir("t3-prototype-app-root-");
    await mkdir(path.join(appRoot, "scripts"), { recursive: true });
    await mkdir(path.join(appRoot, "apps", "server", "src"), { recursive: true });
    await writeFile(path.join(appRoot, "scripts", "dynamo-design-extract.ts"), "");
    await writeFile(path.join(appRoot, "scripts", "dynamo-prototype-viewer.ts"), "");

    await expect(
      resolvePrototypeDesignExtractorAppRoot({
        cwd: path.join(appRoot, "apps", "server", "src"),
        moduleDir: path.join(appRoot, "apps", "server", "dist"),
      }),
    ).resolves.toBe(appRoot);
  });

  it("installs an app-owned executable shim and exports it through env", async () => {
    const appRoot = await makeTempDir("t3-prototype-app-");
    const stateDir = await makeTempDir("t3-prototype-state-");
    await mkdir(path.join(appRoot, "scripts"), { recursive: true });
    await mkdir(path.join(appRoot, "target-worktree"), { recursive: true });
    await writeFile(path.join(appRoot, "scripts", "dynamo-design-extract.ts"), "");
    await writeFile(path.join(appRoot, "scripts", "dynamo-prototype-viewer.ts"), "");

    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const result = await installPrototypeDesignExtractorShim({
      stateDir,
      cwd: path.join(appRoot, "target-worktree"),
      moduleDir: path.join(appRoot, "apps", "server", "dist"),
      env,
      platform: "darwin",
    });

    expect(result.installed).toBe(true);
    expect(result.appRoot).toBe(appRoot);
    expect(result.binDir).toBe(path.join(stateDir, "bin"));
    expect(result.commandPath).toBe(path.join(stateDir, "bin", "dynamo-design-extract"));
    expect(env[DYNAMO_DESIGN_EXTRACT_ENV]).toBe(result.commandPath);
    expect(env[DYNAMO_DESIGN_EXTRACT_APP_ROOT_ENV]).toBe(appRoot);
    expect(env.PATH?.split(path.delimiter)[0]).toBe(result.binDir);

    const shim = await readFile(result.commandPath!, "utf8");
    expect(shim).toContain("bun run dynamo-design-extract");
    expect(shim).toContain(appRoot);
    expect((await stat(result.commandPath!)).mode & 0o111).not.toBe(0);
  });

  it("installs an app-owned prototype viewer shim and exports it through env", async () => {
    const appRoot = await makeTempDir("t3-prototype-viewer-app-");
    const stateDir = await makeTempDir("t3-prototype-viewer-state-");
    await mkdir(path.join(appRoot, "scripts"), { recursive: true });
    await mkdir(path.join(appRoot, "target-worktree"), { recursive: true });
    await writeFile(path.join(appRoot, "scripts", "dynamo-design-extract.ts"), "");
    await writeFile(path.join(appRoot, "scripts", "dynamo-prototype-viewer.ts"), "");

    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const result = await installPrototypeViewerShim({
      stateDir,
      cwd: path.join(appRoot, "target-worktree"),
      moduleDir: path.join(appRoot, "apps", "server", "dist"),
      env,
      platform: "darwin",
    });

    expect(result.installed).toBe(true);
    expect(result.commandPath).toBe(path.join(stateDir, "bin", "dynamo-prototype-viewer"));
    expect(env[DYNAMO_PROTOTYPE_VIEWER_ENV]).toBe(result.commandPath);
    expect(env[DYNAMO_DESIGN_EXTRACT_APP_ROOT_ENV]).toBe(appRoot);
    expect(env.PATH?.split(path.delimiter)[0]).toBe(result.binDir);

    const shim = await readFile(result.commandPath!, "utf8");
    expect(shim).toContain("bun run dynamo-prototype-viewer");
    expect(shim).toContain(appRoot);
    expect((await stat(result.commandPath!)).mode & 0o111).not.toBe(0);
  });

  it("does not install a shim when the app extractor script is unavailable", async () => {
    const missingRoot = await makeTempDir("t3-prototype-missing-");
    const stateDir = await makeTempDir("t3-prototype-state-missing-");
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

    const result = await installPrototypeDesignExtractorShim({
      stateDir,
      cwd: missingRoot,
      moduleDir: missingRoot,
      env,
      platform: "darwin",
    });

    expect(result).toEqual({
      installed: false,
      appRoot: undefined,
      commandPath: undefined,
      binDir: undefined,
    });
    expect(env[DYNAMO_DESIGN_EXTRACT_ENV]).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });
});
