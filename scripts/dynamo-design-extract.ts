import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type BrowserElement = any;
declare const CSS: { escape(value: string): string };
declare const document: any;
declare const location: { href: string };
declare const window: any;

interface CliArgs {
  readonly url: string;
  readonly outDir: string;
  readonly waitMs: number;
  readonly timeoutMs: number;
  readonly screenshot: boolean;
  readonly selector: string | undefined;
}

interface RuntimeMessage {
  readonly type: string;
  readonly text: string;
  readonly location?: string | undefined;
}

interface ElementSummary {
  readonly selector: string;
  readonly tagName: string;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly role?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly text?: string | undefined;
  readonly boundingBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}

interface CaptureMeta {
  readonly url: string;
  readonly title: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly deviceScaleFactor: number;
  };
  readonly fonts: ReadonlyArray<string>;
  readonly stylesheets: ReadonlyArray<string>;
  readonly scripts: ReadonlyArray<string>;
  readonly colors: Record<string, number>;
  readonly bodyTextSample: string;
  readonly visibleElementCount: number;
  readonly appRoots: ReadonlyArray<
    ElementSummary & {
      readonly childElementCount: number;
      readonly descendantElementCount: number;
    }
  >;
  readonly layoutRegions: ReadonlyArray<ElementSummary>;
  readonly target?:
    | {
        readonly selector: string;
        readonly matchCount: number;
        readonly matches: ReadonlyArray<
          ElementSummary & { readonly ancestry: ReadonlyArray<ElementSummary> }
        >;
      }
    | undefined;
  readonly consoleMessages?: ReadonlyArray<RuntimeMessage> | undefined;
  readonly pageErrors?: ReadonlyArray<string> | undefined;
}

export function getCaptureValidationError(meta: CaptureMeta): string | undefined {
  if (meta.target && meta.target.matchCount === 0) {
    return `Target selector "${meta.target.selector}" did not match any rendered DOM nodes.`;
  }

  const hasClientAppScript = meta.scripts.some((script) =>
    /(?:\/src\/main\.[jt]sx?|@vite\/client|\/_next\/|webpack|vite)/.test(script),
  );
  const hasEmptyAppRoot = meta.appRoots.some(
    (root) =>
      root.childElementCount === 0 &&
      root.descendantElementCount === 0 &&
      root.boundingBox.width > 0 &&
      root.boundingBox.height > 0,
  );
  const visibleText = meta.bodyTextSample.trim();
  if (hasClientAppScript && hasEmptyAppRoot && visibleText.length === 0) {
    return "Captured a blank client-app root. The route likely failed to mount or the URL/port is wrong.";
  }

  if (hasClientAppScript && meta.visibleElementCount <= 1 && meta.layoutRegions.length === 0) {
    return "Captured only the app shell, with no rendered page regions.";
  }

  return undefined;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const [url, ...rest] = argv;
  if (!url || url === "--help" || url === "-h") {
    console.error(
      "Usage: bun run dynamo-design-extract <url> [--out <dir>] [--wait <ms>] [--timeout <ms>] [--selector <css>] [--no-screenshot]",
    );
    process.exit(url ? 0 : 1);
  }

  let outDir = ".dynamo/prototypes/reference/.reference";
  let waitMs = 1500;
  let timeoutMs = 15000;
  let screenshot = true;
  let selector: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--out") {
      const value = rest[index + 1];
      if (!value) {
        console.error("Missing value for --out.");
        process.exit(1);
      }
      outDir = value;
      index += 1;
      continue;
    }
    if (arg === "--wait") {
      const value = rest[index + 1];
      const parsed = Number(value);
      if (!value || !Number.isFinite(parsed) || parsed < 0) {
        console.error("Missing or invalid millisecond value for --wait.");
        process.exit(1);
      }
      waitMs = parsed;
      index += 1;
      continue;
    }
    if (arg === "--timeout") {
      const value = rest[index + 1];
      const parsed = Number(value);
      if (!value || !Number.isFinite(parsed) || parsed <= 0) {
        console.error("Missing or invalid millisecond value for --timeout.");
        process.exit(1);
      }
      timeoutMs = parsed;
      index += 1;
      continue;
    }
    if (arg === "--selector") {
      const value = rest[index + 1];
      if (!value) {
        console.error("Missing value for --selector.");
        process.exit(1);
      }
      selector = value;
      index += 1;
      continue;
    }
    if (arg === "--no-screenshot") {
      screenshot = false;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }

  return { url, outDir, waitMs, timeoutMs, screenshot, selector };
}

const STYLE_PROPERTIES = [
  "display",
  "position",
  "box-sizing",
  "width",
  "height",
  "margin",
  "padding",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "background",
  "background-color",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "gap",
  "grid-template-columns",
  "align-items",
  "justify-content",
  "overflow",
] as const;

async function main(): Promise<void> {
  const { url, outDir, waitMs, timeoutMs, screenshot, selector } = parseArgs(process.argv.slice(2));
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch (cause) {
    console.error("Playwright is required for DOM extraction. Run `bun install` and try again.");
    if (process.env.DEBUG) {
      console.error(cause);
    }
    process.exit(2);
  }

  await mkdir(outDir, { recursive: true });
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const consoleMessages: Array<RuntimeMessage> = [];
    const pageErrors: Array<string> = [];
    page.on("console", (message) => {
      if (!["error", "warning"].includes(message.type())) {
        return;
      }
      consoleMessages.push({
        type: message.type(),
        text: message.text().slice(0, 1000),
        location: message.location().url
          ? `${message.location().url}:${message.location().lineNumber}:${message.location().columnNumber}`
          : undefined,
      });
    });
    page.on("pageerror", (error) => {
      pageErrors.push((error.stack || error.message || String(error)).slice(0, 2000));
    });
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }

    const dom = await page.locator("html").evaluate((element) => element.outerHTML);
    const computedStyles = await page.evaluate(
      (properties) => {
        function selectorFor(element: BrowserElement): string {
          if (element.id) {
            return `#${CSS.escape(element.id)}`;
          }
          const parts: string[] = [];
          let current: BrowserElement | null = element;
          while (current && current !== document.documentElement) {
            const tag = current.tagName.toLowerCase();
            const className = Array.from(current.classList)
              .slice(0, 2)
              .map((value: any) => `.${CSS.escape(String(value))}`)
              .join("");
            const parent = current.parentElement;
            const siblings = parent
              ? Array.from(parent.children).filter(
                  (child: any) => child.tagName === current!.tagName,
                )
              : [];
            const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
            parts.unshift(`${tag}${className}${nth}`);
            current = current.parentElement;
          }
          return parts.join(" > ");
        }

        return Array.from(document.querySelectorAll("body *"))
          .filter((element: any) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none"
            );
          })
          .slice(0, 800)
          .map((element: any, index) => {
            const style = window.getComputedStyle(element);
            const declarations = properties
              .map((property) => `  ${property}: ${style.getPropertyValue(property)};`)
              .join("\n");
            return `/* ${index + 1} */ ${selectorFor(element)} {\n${declarations}\n}`;
          })
          .join("\n\n");
      },
      [...STYLE_PROPERTIES],
    );

    const meta = await page.evaluate((targetSelector) => {
      function selectorFor(element: BrowserElement): string {
        if (element.id) {
          return `#${CSS.escape(element.id)}`;
        }
        const parts: string[] = [];
        let current: BrowserElement | null = element;
        while (current && current !== document.documentElement) {
          const tag = current.tagName.toLowerCase();
          const className = Array.from(current.classList)
            .slice(0, 2)
            .map((value: any) => `.${CSS.escape(String(value))}`)
            .join("");
          const parent = current.parentElement;
          const siblings = parent
            ? Array.from(parent.children).filter((child: any) => child.tagName === current!.tagName)
            : [];
          const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
          parts.unshift(`${tag}${className}${nth}`);
          current = current.parentElement;
        }
        return parts.join(" > ");
      }

      const elementSummary = (element: BrowserElement) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: selectorFor(element),
          tagName: element.tagName.toLowerCase(),
          id: element.id || undefined,
          className: typeof element.className === "string" ? element.className : undefined,
          role: element.getAttribute("role") ?? undefined,
          ariaLabel: element.getAttribute("aria-label") ?? undefined,
          text:
            String(element.innerText ?? element.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 240) || undefined,
          boundingBox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
          },
        };
      };

      const visibleElements = Array.from(document.querySelectorAll("body *")).filter(
        (element: any) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none"
          );
        },
      );

      const stylesheets = Array.from(document.styleSheets).flatMap((sheet: any) => {
        try {
          return sheet.href ? [sheet.href] : [];
        } catch {
          return [];
        }
      });
      const scripts = Array.from(document.scripts).flatMap((script: any) =>
        script.src ? [script.src] : [],
      );
      const fonts = Array.from(document.fonts).map((font: any) => font.family);
      const colors: Record<string, number> = {};
      for (const element of visibleElements.slice(0, 1000)) {
        const style = window.getComputedStyle(element);
        for (const property of ["color", "background-color", "border-color"]) {
          const value = style.getPropertyValue(property);
          if (value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent") {
            colors[value] = (colors[value] ?? 0) + 1;
          }
        }
      }
      const layoutRegions = visibleElements
        .filter((element: any) => {
          const tag = element.tagName.toLowerCase();
          const role = element.getAttribute("role");
          return (
            ["header", "nav", "main", "aside", "footer", "section", "dialog"].includes(tag) ||
            ["banner", "navigation", "main", "complementary", "contentinfo", "dialog"].includes(
              role,
            )
          );
        })
        .slice(0, 80)
        .map((element: any) => elementSummary(element));

      const bodyTextSample = String(document.body?.innerText ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1000);
      const appRoots = ["#root", "#__next", "#app", "[data-reactroot]"].flatMap((rootSelector) =>
        Array.from(document.querySelectorAll(rootSelector)).map((element: any) =>
          Object.assign(elementSummary(element), {
            childElementCount: element.childElementCount,
            descendantElementCount: element.querySelectorAll("*").length,
          }),
        ),
      );

      let target;
      if (targetSelector) {
        const allMatches = Array.from(document.querySelectorAll(targetSelector));
        target = {
          selector: targetSelector,
          matchCount: allMatches.length,
          matches: allMatches.slice(0, 20).map((element: any) => {
            const ancestry = [];
            let current = element.parentElement;
            while (current && current !== document.body && ancestry.length < 8) {
              ancestry.push(elementSummary(current));
              current = current.parentElement;
            }
            return Object.assign(elementSummary(element), { ancestry });
          }),
        };
      }

      return {
        url: location.href,
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          deviceScaleFactor: window.devicePixelRatio,
        },
        fonts: Array.from(new Set(fonts)).toSorted(),
        stylesheets,
        scripts,
        colors,
        bodyTextSample,
        visibleElementCount: visibleElements.length,
        appRoots,
        layoutRegions,
        target,
      };
    }, selector);

    const metaWithRuntime = {
      ...meta,
      consoleMessages,
      pageErrors,
    };
    const validationError = getCaptureValidationError(metaWithRuntime);

    await writeFile(path.join(outDir, "dom.html"), dom, "utf8");
    await writeFile(path.join(outDir, "computed-styles.css"), computedStyles, "utf8");
    await writeFile(
      path.join(outDir, "meta.json"),
      `${JSON.stringify(metaWithRuntime, null, 2)}\n`,
      "utf8",
    );
    if (screenshot) {
      await page.screenshot({
        path: path.join(outDir, "screenshot.png"),
        fullPage: true,
      });
    }
    if (validationError) {
      console.error(
        `${validationError} Captured artifacts were written to ${outDir} for inspection.`,
      );
      process.exitCode = 3;
      return;
    }
    console.log(`Captured design reference to ${outDir}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exit(1);
  });
}
