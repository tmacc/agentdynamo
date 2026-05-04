import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const USAGE = "Usage: bun run dynamo-prototype-viewer <prototype-dir> [--title <title>] [--force]";

interface CliOptions {
  readonly prototypeDir: string;
  readonly title: string;
}

const parseArgs = (argv: readonly string[]): CliOptions => {
  let prototypeDir: string | undefined;
  let title = "Dynamo Prototype";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
    if (arg === "--force") {
      continue;
    }
    if (arg === "--title") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--title requires a value");
      }
      title = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (prototypeDir) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    prototypeDir = arg;
  }

  if (!prototypeDir) {
    throw new Error(USAGE);
  }

  return {
    prototypeDir,
    title,
  };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const escapeScriptJson = (value: string): string =>
  value.replaceAll("</script", "<\\/script").replaceAll("<!--", "<\\!--");

const readManifest = async (prototypeDir: string): Promise<string | undefined> => {
  try {
    return await readFile(path.join(prototypeDir, "prototype.json"), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

const viewerHtml = ({
  title,
  manifestJson,
}: {
  title: string;
  manifestJson?: string;
}): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="assets/prototype-viewer.css" />
  </head>
  <body>
    <main id="prototype-viewer" class="prototype-viewer" aria-label="Prototype canvas">
      <div class="prototype-viewer__toolbar">
        <div>
          <p class="prototype-viewer__eyebrow">Dynamo Prototype</p>
          <h1 id="prototype-title">${escapeHtml(title)}</h1>
        </div>
        <div class="prototype-viewer__controls" aria-label="Canvas controls">
          <button type="button" data-action="zoom-out" title="Zoom out">-</button>
          <output id="prototype-zoom">100%</output>
          <button type="button" data-action="zoom-in" title="Zoom in">+</button>
          <button type="button" data-action="fit" title="Fit to screen">Fit</button>
          <button type="button" data-action="reset" title="Reset view">Reset</button>
        </div>
      </div>
      <div id="prototype-error" class="prototype-viewer__error" hidden></div>
      <section id="prototype-canvas" class="prototype-viewer__canvas" tabindex="0">
        <div id="prototype-stage" class="prototype-viewer__stage"></div>
      </section>
    </main>
    <script type="application/json" id="prototype-manifest">${
      manifestJson ? escapeScriptJson(manifestJson) : ""
    }</script>
    <script src="assets/prototype-viewer.js"></script>
  </body>
</html>
`;

const viewerCss = `:root {
  color-scheme: light dark;
  --viewer-bg: #111318;
  --viewer-panel: #181b22;
  --viewer-panel-2: #20242d;
  --viewer-text: #f5f7fb;
  --viewer-muted: #a8b0bf;
  --viewer-border: rgba(255, 255, 255, 0.14);
  --viewer-accent: #80c7ff;
  --viewer-shadow: 0 22px 80px rgba(0, 0, 0, 0.36);
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--viewer-bg);
  color: var(--viewer-text);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button {
  height: 32px;
  border: 1px solid var(--viewer-border);
  border-radius: 7px;
  background: var(--viewer-panel-2);
  color: var(--viewer-text);
  font: inherit;
  padding: 0 10px;
}

button:hover {
  border-color: color-mix(in srgb, var(--viewer-accent) 55%, var(--viewer-border));
}

.prototype-viewer {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 100vh;
}

.prototype-viewer__toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 72px;
  border-bottom: 1px solid var(--viewer-border);
  background: color-mix(in srgb, var(--viewer-panel) 88%, transparent);
  backdrop-filter: blur(16px);
  padding: 12px 16px;
}

.prototype-viewer__eyebrow {
  margin: 0 0 3px;
  color: var(--viewer-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.prototype-viewer h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: 0;
}

.prototype-viewer__controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

#prototype-zoom {
  min-width: 54px;
  color: var(--viewer-muted);
  font-size: 13px;
  text-align: center;
}

.prototype-viewer__error {
  margin: 16px;
  border: 1px solid color-mix(in srgb, #ff7676 52%, var(--viewer-border));
  border-radius: 8px;
  background: color-mix(in srgb, #ff7676 12%, var(--viewer-panel));
  color: #ffd5d5;
  padding: 12px 14px;
}

.prototype-viewer__canvas {
  position: relative;
  min-height: calc(100vh - 72px);
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  outline: none;
}

.prototype-viewer__canvas:active {
  cursor: grabbing;
}

.prototype-viewer__stage {
  position: absolute;
  left: 0;
  top: 0;
  display: grid;
  grid-template-columns: repeat(var(--prototype-columns, 1), max-content);
  gap: 48px;
  padding: 48px;
  transform-origin: 0 0;
  will-change: transform;
}

.prototype-frame {
  width: var(--frame-width, 1440px);
}

.prototype-frame__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  margin-bottom: 10px;
  color: var(--viewer-muted);
  font-size: 13px;
}

.prototype-frame__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prototype-frame__open {
  color: var(--viewer-accent);
  text-decoration: none;
}

.prototype-frame__surface {
  width: var(--frame-width, 1440px);
  height: var(--frame-height, 960px);
  overflow: hidden;
  border: 1px solid var(--viewer-border);
  border-radius: 8px;
  background: white;
  box-shadow: var(--viewer-shadow);
}

.prototype-frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: white;
}

@media (max-width: 720px) {
  .prototype-viewer__toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .prototype-viewer__controls {
    justify-content: flex-start;
  }
}
`;

const viewerJs = `(() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const stage = document.querySelector("#prototype-stage");
  const canvas = document.querySelector("#prototype-canvas");
  const zoomOutput = document.querySelector("#prototype-zoom");
  const title = document.querySelector("#prototype-title");
  const errorBox = document.querySelector("#prototype-error");
  const manifestScript = document.querySelector("#prototype-manifest");
  const state = { x: 40, y: 40, scale: 0.75, dragging: false, pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0 };

  const showError = (message) => {
    if (!errorBox) return;
    errorBox.hidden = false;
    errorBox.textContent = message;
  };

  const readManifest = async () => {
    const embedded = manifestScript?.textContent?.trim();
    if (embedded) return JSON.parse(embedded);
    const response = await fetch("prototype.json");
    if (!response.ok) throw new Error("Could not load prototype.json");
    return response.json();
  };

  const validateManifest = (manifest) => {
    if (!manifest || typeof manifest !== "object") {
      throw new Error("prototype.json must contain an object.");
    }
    if (manifest.version !== 1) {
      throw new Error("prototype.json must use version 1.");
    }
    if (manifest.mode !== "page-canvas") {
      throw new Error('prototype.json must use mode "page-canvas".');
    }
    if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) {
      throw new Error("prototype.json must define at least one frame.");
    }
    for (const frame of manifest.frames) {
      if (!frame?.id || !frame?.title || !frame?.path) {
        throw new Error("Every prototype frame must include id, title, and path.");
      }
      if (!String(frame.path).startsWith("frames/") || !String(frame.path).endsWith(".html")) {
        throw new Error(\`Invalid frame path: \${frame.path}\`);
      }
    }
    return manifest;
  };

  const applyTransform = () => {
    stage.style.transform = \`translate3d(\${state.x}px, \${state.y}px, 0) scale(\${state.scale})\`;
    zoomOutput.textContent = \`\${Math.round(state.scale * 100)}%\`;
    history.replaceState(null, "", \`#x=\${Math.round(state.x)}&y=\${Math.round(state.y)}&z=\${state.scale.toFixed(3)}\`);
  };

  const restoreTransform = () => {
    const params = new URLSearchParams(location.hash.slice(1));
    const x = Number(params.get("x"));
    const y = Number(params.get("y"));
    const z = Number(params.get("z"));
    if (Number.isFinite(x)) state.x = x;
    if (Number.isFinite(y)) state.y = y;
    if (Number.isFinite(z)) state.scale = clamp(z, 0.25, 4);
  };

  const frameViewport = (frame) => ({
    width: Number(frame.viewport?.width ?? 1440),
    height: Number(frame.viewport?.height ?? 960),
  });

  const renderManifest = (manifest) => {
    title.textContent = manifest.title || "Dynamo Prototype";
    const frames = Array.isArray(manifest.frames) ? manifest.frames : [];
    if (frames.length === 0) {
      showError("prototype.json does not define any frames.");
      return;
    }

    const columns = manifest.canvas?.layout === "flow" ? 1 : Math.min(3, Math.max(1, Math.ceil(Math.sqrt(frames.length))));
    stage.style.setProperty("--prototype-columns", String(columns));
    stage.replaceChildren(
      ...frames.map((frame) => {
        const viewport = frameViewport(frame);
        const article = document.createElement("article");
        article.className = "prototype-frame";
        article.style.setProperty("--frame-width", \`\${viewport.width}px\`);
        article.style.setProperty("--frame-height", \`\${viewport.height}px\`);

        const header = document.createElement("header");
        header.className = "prototype-frame__header";
        const frameTitle = document.createElement("div");
        frameTitle.className = "prototype-frame__title";
        frameTitle.textContent = frame.title || frame.id || frame.path;
        const open = document.createElement("a");
        open.className = "prototype-frame__open";
        open.href = frame.path;
        open.target = "_blank";
        open.rel = "noreferrer";
        open.textContent = "Open";
        header.append(frameTitle, open);

        const surface = document.createElement("div");
        surface.className = "prototype-frame__surface";
        const iframe = document.createElement("iframe");
        iframe.loading = "lazy";
        iframe.src = frame.path;
        iframe.title = frame.title || frame.id || "Prototype frame";
        surface.append(iframe);
        article.append(header, surface);
        return article;
      }),
    );
  };

  const zoomAt = (nextScale, anchorX = canvas.clientWidth / 2, anchorY = canvas.clientHeight / 2) => {
    const scale = clamp(nextScale, 0.25, 4);
    const beforeX = (anchorX - state.x) / state.scale;
    const beforeY = (anchorY - state.y) / state.scale;
    state.scale = scale;
    state.x = anchorX - beforeX * state.scale;
    state.y = anchorY - beforeY * state.scale;
    applyTransform();
  };

  const fit = () => {
    const rect = stage.getBoundingClientRect();
    const unscaledWidth = rect.width / state.scale;
    const unscaledHeight = rect.height / state.scale;
    const nextScale = clamp(Math.min((canvas.clientWidth - 64) / unscaledWidth, (canvas.clientHeight - 64) / unscaledHeight), 0.25, 1.25);
    state.scale = nextScale;
    state.x = 32;
    state.y = 32;
    applyTransform();
  };

  document.addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.action;
    if (!action) return;
    if (action === "zoom-in") zoomAt(state.scale * 1.15);
    if (action === "zoom-out") zoomAt(state.scale / 1.15);
    if (action === "reset") {
      state.x = 40;
      state.y = 40;
      state.scale = 0.75;
      applyTransform();
    }
    if (action === "fit") fit();
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 1 / 1.08 : 1.08;
    zoomAt(state.scale * delta, event.clientX, event.clientY);
  }, { passive: false });

  canvas.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.originX = state.x;
    state.originY = state.y;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging || state.pointerId !== event.pointerId) return;
    state.x = state.originX + event.clientX - state.startX;
    state.y = state.originY + event.clientY - state.startY;
    applyTransform();
  });

  canvas.addEventListener("pointerup", () => {
    state.dragging = false;
    state.pointerId = null;
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") zoomAt(state.scale * 1.15);
    if (event.key === "-") zoomAt(state.scale / 1.15);
    if (event.key === "0") {
      state.x = 40;
      state.y = 40;
      state.scale = 0.75;
      applyTransform();
    }
    if (event.key === "ArrowLeft") state.x += 48;
    if (event.key === "ArrowRight") state.x -= 48;
    if (event.key === "ArrowUp") state.y += 48;
    if (event.key === "ArrowDown") state.y -= 48;
    applyTransform();
  });

  restoreTransform();
  readManifest()
    .then(validateManifest)
    .then((manifest) => {
      renderManifest(manifest);
      applyTransform();
      if (!location.hash) requestAnimationFrame(fit);
    })
    .catch((error) => showError(error instanceof Error ? error.message : "Could not load prototype manifest."));
})();
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prototypeDir = path.resolve(options.prototypeDir);
  const assetsDir = path.join(prototypeDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const manifestJson = await readManifest(prototypeDir);
  await writeFile(path.join(assetsDir, "prototype-viewer.css"), viewerCss, "utf8");
  await writeFile(path.join(assetsDir, "prototype-viewer.js"), viewerJs, "utf8");
  await writeFile(
    path.join(prototypeDir, "index.html"),
    viewerHtml({ title: options.title, ...(manifestJson ? { manifestJson } : {}) }),
    "utf8",
  );

  console.log(`Wrote Dynamo prototype viewer to ${prototypeDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
