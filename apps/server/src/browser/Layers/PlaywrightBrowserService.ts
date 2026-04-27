import type {
  Browser as PlaywrightBrowser,
  BrowserContext,
  Page,
  Playwright,
} from "playwright";
import {
  type BrowserExperienceResult,
  type BrowserGraphEdge,
  type BrowserGraphNode,
  type BrowserSession,
  type BrowserSessionId,
  type BrowserViewport,
  type ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, Path, Ref } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { BrowserService, type BrowserServiceShape } from "../Services/BrowserService.ts";

interface RuntimeSession {
  readonly id: BrowserSessionId;
  readonly threadId: ThreadId;
  readonly createdAt: string;
  readonly viewport: BrowserViewport;
  browser: PlaywrightBrowser | null;
  context: BrowserContext | null;
  page: Page | null;
  currentUrl: string | undefined;
  title: string | undefined;
  status: BrowserSession["status"];
  lastError: string | undefined;
  consoleErrors: Array<string>;
  failedRequests: Array<string>;
}

interface GraphSnapshot {
  readonly nodes: ReadonlyArray<BrowserGraphNode>;
  readonly edges: ReadonlyArray<BrowserGraphEdge>;
  readonly horizontalOverflow: number;
  readonly summary: string;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 } satisfies BrowserViewport;

function makeSessionId(threadId: ThreadId): BrowserSessionId {
  return `browser-session:${threadId}` as BrowserSessionId;
}

function toBrowserSession(session: RuntimeSession): BrowserSession {
  const now = new Date().toISOString();
  return {
    id: session.id,
    threadId: session.threadId,
    status: session.status,
    viewport: session.viewport,
    createdAt: session.createdAt,
    updatedAt: now,
    ...(session.currentUrl !== undefined ? { currentUrl: session.currentUrl } : {}),
    ...(session.title !== undefined ? { title: session.title } : {}),
    ...(session.lastError !== undefined ? { lastError: session.lastError } : {}),
  };
}

function hasInteractiveDisplay(mode: string): boolean {
  if (process.platform === "darwin" || process.platform === "win32") {
    return mode === "desktop";
  }
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1")
    );
  } catch {
    return false;
  }
}

async function evaluateGraph(page: Page): Promise<GraphSnapshot> {
  const script = String.raw`(() => {
    const isVisible = (element, rect) => {
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0.01
      );
    };
    const isInteractable = (element) => {
      const tagName = element.tagName.toLowerCase();
      const role = element.getAttribute("role") ?? "";
      return (
        ["a", "button", "input", "select", "textarea", "summary"].includes(tagName) ||
        ["button", "link", "tab", "menuitem", "checkbox", "radio"].includes(role) ||
        element.hasAttribute("onclick")
      );
    };
    const viewportForRect = (rect) => {
      if (rect.bottom < 0) return "above";
      if (rect.top > window.innerHeight) return "below";
      if (rect.right < 0) return "left";
      if (rect.left > window.innerWidth) return "right";
      return "in";
    };
    const labelFor = (element) =>
      (
        element.getAttribute("aria-label") ??
        element.getAttribute("title") ??
        element.textContent ??
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);

    const candidates = [...document.querySelectorAll("body *")].slice(0, 600);
    const nodes = candidates.flatMap((element, index) => {
      const rect = element.getBoundingClientRect();
      if (!isVisible(element, rect)) return [];
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
      const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
      const label = labelFor(element);
      const interactable = isInteractable(element);
      if (!interactable && text.length === 0) return [];
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const salience = Math.min(
        1,
        (interactable ? 0.45 : 0.15) +
          Math.min(0.35, (width * height) / Math.max(1, window.innerWidth * window.innerHeight)) +
          (viewportForRect(rect) === "in" ? 0.2 : 0),
      );
      return [
        {
          ref: `ref_${index + 1}`,
          role,
          ...(label ? { name: label } : {}),
          ...(text ? { text } : {}),
          tagName: element.tagName.toLowerCase(),
          bbox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width,
            height,
          },
          visible: true,
          interactable,
          disabled:
            element.disabled === true ||
            element.getAttribute("aria-disabled") === "true",
          viewport: viewportForRect(rect),
          owner: {
            route: location.pathname,
          },
          salience,
          changedSinceLastSnapshot: true,
          lastActionResult: "none" as const,
        },
      ];
    });
    const graphNodes = nodes
      .sort((a, b) => b.salience - a.salience)
      .slice(0, 80) as Array<BrowserGraphNode>;
    const edges = graphNodes
      .filter((node) => node.interactable)
      .slice(0, 40)
      .map((node) => ({
        fromRef: node.ref,
        action: node.tagName === "input" || node.tagName === "textarea" ? "type" : "click",
        confidence: node.viewport === "in" ? 0.8 : 0.35,
        observed: false,
      }));
    const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 2 ? 1 : 0;
    const title = document.title ? `Title: ${document.title}. ` : "";
    const visibleActions = graphNodes
      .filter((node) => node.interactable && node.viewport === "in")
      .slice(0, 6)
      .map((node) => node.name || node.text || node.role)
      .filter(Boolean)
      .join(", ");
    return {
      nodes: graphNodes,
      edges,
      horizontalOverflow,
      summary: `${title}${graphNodes.length} visible semantic nodes. Primary actions: ${visibleActions || "none"}.`,
    };
  })()`;
  return (await page.evaluate(script)) as GraphSnapshot;
}

const makeBrowserService = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;
  const path = yield* Path.Path;
  const sessionsRef = yield* Ref.make(new Map<ThreadId, RuntimeSession>());
  const readSettings = settingsService.getSettings.pipe(
    Effect.mapError((cause) => new Error(cause.message)),
  );

  const loadPlaywright = Effect.tryPromise({
    try: () => import("playwright"),
    catch: (cause) => new Error(`Playwright is unavailable: ${String(cause)}`),
  });

  const ensureSession = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const settings = yield* readSettings;
      const sessions = yield* Ref.get(sessionsRef);
      const existing = sessions.get(threadId);
      if (existing?.page && !existing.page.isClosed()) {
        return existing;
      }
      if (!settings.browserAutomation.enabled) {
        throw new Error("Browser automation is disabled in Dynamo settings.");
      }
      if (sessions.size >= settings.browserAutomation.maxActiveSessions && !existing) {
        throw new Error(
          `Browser automation already has ${sessions.size} active sessions; the limit is ${settings.browserAutomation.maxActiveSessions}.`,
        );
      }
      const viewport = {
        width: settings.browserAutomation.defaultViewport.width || DEFAULT_VIEWPORT.width,
        height: settings.browserAutomation.defaultViewport.height || DEFAULT_VIEWPORT.height,
        label: "desktop",
      } satisfies BrowserViewport;
      const session: RuntimeSession =
        existing ??
        ({
          id: makeSessionId(threadId),
          threadId,
          createdAt: new Date().toISOString(),
          viewport,
          browser: null,
          context: null,
          page: null,
          currentUrl: undefined,
          title: undefined,
          status: "starting",
          lastError: undefined,
          consoleErrors: [],
          failedRequests: [],
        } satisfies RuntimeSession);
      const displayAvailable = hasInteractiveDisplay(serverConfig.mode);
      const headless =
        settings.browserAutomation.visibility === "headless" ||
        (settings.browserAutomation.visibility === "auto" && !displayAvailable);
      const launched = yield* Effect.exit(
        Effect.gen(function* () {
          const playwright: Playwright = yield* loadPlaywright;
          const browser: PlaywrightBrowser = yield* Effect.tryPromise({
            try: () => playwright.chromium.launch({ headless }),
            catch: (cause) => new Error(`Failed to launch Chromium: ${String(cause)}`),
          });
          const context: BrowserContext = yield* Effect.tryPromise({
            try: () => browser.newContext({ viewport }),
            catch: (cause) => new Error(`Failed to create browser context: ${String(cause)}`),
          });
          const page: Page = yield* Effect.tryPromise({
            try: () => context.newPage(),
            catch: (cause) => new Error(`Failed to create browser page: ${String(cause)}`),
          });
          return { browser, context, page };
        }),
      );
      if (launched._tag === "Success") {
        const { browser, context, page } = launched.value;
        page.on("console", (message) => {
          if (message.type() === "error") {
            session.consoleErrors.push(message.text().slice(0, 1_000));
            session.consoleErrors = session.consoleErrors.slice(-50);
          }
        });
        page.on("requestfailed", (request) => {
          session.failedRequests.push(`${request.method()} ${request.url()}`.slice(0, 1_000));
          session.failedRequests = session.failedRequests.slice(-50);
        });
        session.browser = browser;
        session.context = context;
        session.page = page;
        session.status = "ready";
        session.lastError = undefined;
        yield* Ref.update(sessionsRef, (next) => new Map(next).set(threadId, session));
        return session;
      }
      {
        const cause = launched.cause;
        session.status = "unavailable";
        session.lastError = "Failed to launch browser automation.";
        yield* Ref.update(sessionsRef, (next) => new Map(next).set(threadId, session));
        return yield* Effect.fail(new Error(session.lastError));
      }
    });

  const snapshotFor = (session: RuntimeSession) =>
    Effect.gen(function* () {
      if (!session.page || session.page.isClosed()) {
        throw new Error("Browser page is not available.");
      }
      const graph = yield* Effect.tryPromise({
        try: () => evaluateGraph(session.page as Page),
        catch: (cause) => new Error(`Failed to inspect browser page: ${String(cause)}`),
      });
      session.currentUrl = session.page.url();
      session.title = yield* Effect.tryPromise({
        try: () => (session.page as Page).title(),
        catch: (cause) => new Error(`Failed to read browser title: ${String(cause)}`),
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      session.status = "idle";
      return {
        session: toBrowserSession(session),
        nodes: graph.nodes,
        edges: graph.edges,
        summary: graph.summary,
        consoleErrors: [...session.consoleErrors],
        failedRequests: [...session.failedRequests],
      };
    });

  const open: BrowserServiceShape["open"] = (input) =>
    Effect.gen(function* () {
      const settings = yield* readSettings;
      if (!settings.browserAutomation.allowPublicInternet && !isLoopbackUrl(input.url)) {
        throw new Error("Browser automation is limited to localhost targets by default.");
      }
      const session = yield* ensureSession(input.threadId);
      if (!session.page || session.page.isClosed()) {
        throw new Error(session.lastError ?? "Browser page is unavailable.");
      }
      session.status = "running";
      yield* Effect.tryPromise({
        try: () => (session.page as Page).goto(input.url, { waitUntil: "domcontentloaded" }),
        catch: (cause) => new Error(`Failed to open browser target: ${String(cause)}`),
      });
      yield* Effect.tryPromise({
        try: () => (session.page as Page).waitForLoadState("networkidle", { timeout: 2_000 }),
        catch: (cause) => new Error(`Browser network idle wait failed: ${String(cause)}`),
      }).pipe(Effect.catchAll(() => Effect.void));
      return yield* snapshotFor(session);
    });

  const snapshot: BrowserServiceShape["snapshot"] = (input) =>
    ensureSession(input.threadId).pipe(Effect.flatMap(snapshotFor));

  const screenshot: BrowserServiceShape["screenshot"] = (input) =>
    Effect.gen(function* () {
      const session = yield* ensureSession(input.threadId);
      if (!session.page || session.page.isClosed()) {
        throw new Error(session.lastError ?? "Browser page is unavailable.");
      }
      const artifactId = `browser-shot-${crypto.randomUUID()}.png`;
      const filePath = path.join(serverConfig.browserArtifactsDir, artifactId);
      yield* Effect.tryPromise({
        try: () => (session.page as Page).screenshot({ path: filePath, fullPage: true }),
        catch: (cause) => new Error(`Failed to capture screenshot: ${String(cause)}`),
      });
      return { session: toBrowserSession(session), artifactId, path: filePath };
    });

  const experience: BrowserServiceShape["experience"] = (input) =>
    Effect.gen(function* () {
      const opened = yield* open({ threadId: input.threadId, url: input.target });
      const screenshotResult = yield* screenshot({ threadId: input.threadId }).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      const primaryOptions = opened.nodes
        .filter((node) => node.interactable && node.viewport === "in")
        .slice(0, 5);
      const observations: Array<BrowserExperienceResult["observations"][number]> = [
        {
          id: "obs_1" as never,
          type: "semantic_snapshot",
          fact: opened.summary,
          refs: primaryOptions.map((node) => node.ref as never),
          evidenceIds: screenshotResult ? [screenshotResult.artifactId as never] : [],
        },
      ];
      if (opened.consoleErrors.length > 0) {
        observations.push({
          id: "obs_2" as never,
          type: "console_errors",
          fact: `${opened.consoleErrors.length} console error(s) were observed.`,
          refs: [],
          evidenceIds: [],
        });
      }
      if (opened.failedRequests.length > 0) {
        observations.push({
          id: "obs_3" as never,
          type: "failed_requests",
          fact: `${opened.failedRequests.length} failed request(s) were observed.`,
          refs: [],
          evidenceIds: [],
        });
      }
      const hasManyAmbiguousActions = primaryOptions.length >= 3;
      return {
        outcome: hasManyAmbiguousActions ? "decision_needed" : "completed",
        summary: hasManyAmbiguousActions
          ? "Dynamo inspected the page and found multiple plausible next actions."
          : "Dynamo inspected the page and returned objective browser evidence.",
        confidence: hasManyAmbiguousActions ? 0.68 : 0.78,
        observations,
        frictionHypotheses:
          opened.consoleErrors.length > 0 || opened.failedRequests.length > 0
            ? [
                {
                  severity: "medium",
                  moment: "initial page load",
                  claim: "The flow may be affected by runtime errors or failed requests.",
                  basedOnObservations: observations.slice(1).map((obs) => obs.id),
                  repro: [`open ${input.target}`],
                },
              ]
            : [],
        objectiveSignals: {
          deadClicks: 0,
          layoutShifts: 0,
          failedRequests: opened.failedRequests.length,
          horizontalOverflow: opened.nodes.some(
            (node) => node.viewport === "left" || node.viewport === "right",
          )
            ? 1
            : 0,
        },
        decisionNeeded: hasManyAmbiguousActions
          ? {
              reason: "Multiple plausible next actions are visible for the requested flow.",
              options: primaryOptions.slice(0, 3).map((node) => ({
                label: node.name ?? node.text ?? node.role,
                ref: node.ref as never,
                confidence: node.salience,
              })),
              currentStateSummary: opened.summary,
            }
          : null,
      } satisfies BrowserExperienceResult;
    });

  const close: BrowserServiceShape["close"] = (input) =>
    Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      const session = sessions.get(input.threadId);
      if (!session) return;
      yield* Effect.tryPromise({
        try: async () => {
          await session.context?.close().catch(() => undefined);
          await session.browser?.close().catch(() => undefined);
        },
        catch: (cause) => new Error(`Failed to close browser session: ${String(cause)}`),
      }).pipe(Effect.ignore);
      yield* Ref.update(sessionsRef, (next) => {
        const copy = new Map(next);
        copy.delete(input.threadId);
        return copy;
      });
    });

  const reset: BrowserServiceShape["reset"] = (input) =>
    close(input).pipe(
      Effect.andThen(
        ensureSession(input.threadId).pipe(Effect.map((session) => toBrowserSession(session))),
      ),
    );

  const closeAll: BrowserServiceShape["closeAll"] = Effect.gen(function* () {
    const sessions = yield* Ref.get(sessionsRef);
    yield* Effect.forEach(
      [...sessions.keys()],
      (threadId) => close({ threadId }),
      { discard: true, concurrency: 1 },
    );
  });

  yield* Effect.addFinalizer(() => closeAll.pipe(Effect.ignore));

  return {
    open,
    snapshot,
    screenshot,
    experience,
    reset,
    close,
    closeAll,
  } satisfies BrowserServiceShape;
});

export const BrowserServiceLive = Layer.effect(BrowserService, makeBrowserService);
