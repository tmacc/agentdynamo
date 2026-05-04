import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const makeTempDir = (prefix: string) => mkdtemp(path.join(os.tmpdir(), prefix));

describe("dynamo-prototype-viewer", () => {
  it("materializes the app-owned viewer around a manifest and frames", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const prototypeDir = await makeTempDir("t3-prototype-viewer-");
    await mkdir(path.join(prototypeDir, "frames"), { recursive: true });
    await mkdir(path.join(prototypeDir, "assets"), { recursive: true });
    await writeFile(path.join(prototypeDir, "assets", "tokens.css"), ":root{--surface-app:#fff;}");
    await writeFile(path.join(prototypeDir, "frames", "option-a.html"), "<!doctype html>A");
    await writeFile(path.join(prototypeDir, "frames", "option-b.html"), "<!doctype html>B");
    await writeFile(
      path.join(prototypeDir, "prototype.json"),
      `${JSON.stringify(
        {
          version: 1,
          mode: "page-canvas",
          title: "Topbar options",
          canvas: { layout: "grid", initialZoom: 0.75 },
          frames: [
            {
              id: "option-a",
              title: "Option A",
              path: "frames/option-a.html",
              viewport: { width: 1440, height: 960 },
            },
            {
              id: "option-b",
              title: "Option B",
              path: "frames/option-b.html",
              viewport: { width: 1440, height: 960 },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    await execFileAsync(
      "bun",
      ["scripts/dynamo-prototype-viewer.ts", prototypeDir, "--title", "Topbar options"],
      {
        cwd: repoRoot,
      },
    );

    const indexHtml = await readFile(path.join(prototypeDir, "index.html"), "utf8");
    const viewerCss = await readFile(
      path.join(prototypeDir, "assets", "prototype-viewer.css"),
      "utf8",
    );
    const viewerJs = await readFile(
      path.join(prototypeDir, "assets", "prototype-viewer.js"),
      "utf8",
    );

    expect(indexHtml).toContain("Dynamo Prototype");
    expect(indexHtml).toContain('"mode": "page-canvas"');
    expect(indexHtml).toContain("assets/prototype-viewer.css");
    expect(viewerCss).toContain(".prototype-viewer__canvas");
    expect(viewerJs).toContain("validateManifest");
    expect(viewerJs).toContain("zoomAt");
  });
});
