# Technical Spec — T3 Code Design Mode

This is the contract-level spec. Interfaces, schemas, protocols. If a thing doesn't have a stable shape here, it's not done.

## Package layout

Following T3 Code's existing monorepo structure:

```
apps/
  desktop/                     (existing Electron app)
    src/main/design-mode/      (new — Design Mode Service)
    src/renderer/design-mode/  (new — Design Mode UI pane)

packages/
  design-mode-contracts/       (new — shared types)
  design-mode-adapters/        (new — ProjectAdapter implementations)
  design-mode-extractor/       (new — DesignSystemExtractor)
  design-mode-ast/             (new — ASTEditor on ts-morph)
  design-mode-bridge/          (new — iframe bridge protocol)
```

## Core types (`design-mode-contracts`)

```ts
// Project detection
export type FrameworkKind = "vite-react" | "tanstack-start" | "next-app" | "next-pages";

export interface ProjectInfo {
  rootDir: string;
  framework: FrameworkKind;
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  tsConfigPath: string;
  tailwindConfig: TailwindConfigInfo | null;
  cssEntryPoints: string[];
  componentRoots: string[]; // e.g. ['src/components', 'src/ui']
  routeRoot: string | null; // file-based router root, or null
}

export interface TailwindConfigInfo {
  version: 3 | 4;
  configPath: string | null; // null for v4 CSS-first
  cssThemePath: string | null; // for v4 @theme blocks
}

// Design manifest — the agent's mental model of the project's design system
export interface DesignManifest {
  schemaVersion: 1;
  generatedAt: string;
  tokens: DesignTokens;
  primitives: PrimitiveComponent[];
  composites: CompositeComponent[];
  routes: RouteEntry[];
  dialect: ClassDialect;
  patterns: CompositionPattern[];
}

export interface DesignTokens {
  colors: Record<string, string>; // resolved hex/rgb values
  spacing: Record<string, string>;
  fontSizes: Record<string, string>;
  fontFamilies: Record<string, string[]>;
  radii: Record<string, string>;
  shadows: Record<string, string>;
  breakpoints: Record<string, string>;
  cssVariables: Record<string, string>; // from :root
  custom: Record<string, unknown>; // anything else from theme.extend
}

export interface PrimitiveComponent {
  id: string; // stable hash of file path + export name
  name: string;
  filePath: string;
  exportName: string; // 'default' or named
  primitivenessScore: number; // 0..1
  propTypes: PropSignature[];
  variantPattern: VariantPattern | null;
  importCount: number; // how many places use this
  userConfirmed: boolean; // overridden via .t3design/overrides.json
}

export interface PropSignature {
  name: string;
  type: string; // TS type as string
  required: boolean;
  defaultValue: unknown | null;
  jsdoc: string | null;
}

export type VariantPattern =
  | { kind: "cva"; importPath: string }
  | { kind: "tv"; importPath: string } // tailwind-variants
  | { kind: "cn-conditional"; helperPath: string }
  | { kind: "discriminated-union" }
  | { kind: "unknown" };

export interface CompositeComponent {
  id: string;
  name: string;
  filePath: string;
  primitivesUsed: string[]; // primitive ids
  importCount: number;
}

export interface RouteEntry {
  urlPath: string; // '/settings/profile'
  filePath: string; // 'src/routes/settings/profile.tsx'
  componentName: string;
  layoutChain: string[]; // file paths of ancestor layouts
}

export interface ClassDialect {
  totalClassStrings: number;
  topClasses: { class: string; count: number }[]; // top 200
  arbitraryValueRatio: number; // 0..1, % of strings using []
  spacingScale: string[]; // sorted unique spacing utilities
  colorClasses: string[]; // sorted unique color utilities
  responsivePrefixes: string[]; // 'sm:', 'md:', etc. actually used
  perComponent: Record<string, string[]>; // componentId → its classes
}

export interface CompositionPattern {
  id: string;
  name: string; // 'Card with header and footer', 'Sidebar layout'
  exampleFiles: string[];
  structure: string; // simplified JSX skeleton
  primitivesUsed: string[];
  frequency: number;
}
```

## ProjectAdapter interface

```ts
// design-mode-adapters

export interface ProjectAdapter {
  readonly framework: FrameworkKind;

  detect(rootDir: string): Promise<boolean>;
  inspect(rootDir: string): Promise<ProjectInfo>;

  startDevServer(opts: DevServerOpts): Promise<DevServerHandle>;

  enumerateRoutes(info: ProjectInfo): Promise<RouteEntry[]>;
  enumerateComponents(info: ProjectInfo): Promise<ComponentFileEntry[]>;

  // Inject a virtual route for component isolation; returns the URL path
  injectVirtualRoute(opts: VirtualRouteOpts): Promise<string>;
  removeVirtualRoute(routeId: string): Promise<void>;

  // Subscribe to HMR events from the dev server
  onHmrUpdate(handler: (update: HmrUpdate) => void): Disposable;
}

export interface DevServerOpts {
  rootDir: string;
  port?: number; // 0 = auto
  env?: Record<string, string>;
}

export interface DevServerHandle {
  url: string; // 'http://localhost:5173'
  port: number;
  pid: number;
  stop(): Promise<void>;
  onLog(handler: (line: string) => void): Disposable;
  onError(handler: (err: DevServerError) => void): Disposable;
}

export interface VirtualRouteOpts {
  routeId: string; // stable id from caller
  componentImportPath: string; // resolvable import
  componentExportName: string;
  initialProps: Record<string, unknown>;
  wrapperPath?: string; // optional provider wrapper
}

export interface ComponentFileEntry {
  filePath: string;
  exports: { name: string; isDefault: boolean }[];
}

export interface HmrUpdate {
  type: "update" | "full-reload" | "error";
  file?: string;
  error?: { message: string; stack?: string };
}
```

### Vite adapter notes

- `startDevServer`: spawn `${packageManager} dev` as child process, parse stdout for "Local: http://..."
- `injectVirtualRoute`: write a Vite plugin loaded via `--config` override or via `VITE_PLUGINS` env mechanism. Plugin exposes a virtual module `virtual:t3design/route/:id` and the in-memory module map is refreshed via Vite's module graph API.
- `enumerateRoutes`: if TanStack Router is detected, parse the generated route tree. Otherwise, no routes (Vite + plain React Router uses runtime routing — fall back to scanning JSX `<Route>` elements).
- HMR events: connect to Vite's WebSocket as a passive observer, do not interfere with the user's HMR.

### TanStack Start adapter notes

- Inherits `ViteBaseAdapter`
- Route enumeration uses TanStack's file-based routing convention directly (`src/routes/**/*.tsx`)
- Layout chain comes from `__root.tsx` + nested `route.tsx` files

## Bridge protocol (`design-mode-bridge`)

`postMessage` envelope. All messages carry `{v: 1, type, ...payload}`.

```ts
// Host → iframe
type HostCommand =
  | { v: 1; type: "enter-select-mode" }
  | { v: 1; type: "exit-select-mode" }
  | { v: 1; type: "highlight"; fiberId: string }
  | { v: 1; type: "navigate"; path: string }
  | { v: 1; type: "set-viewport"; width: number; height: number }
  | { v: 1; type: "inject-styles"; css: string } // for live tweaks before AST commit
  | { v: 1; type: "reload" };

// iframe → Host
type IframeEvent =
  | { v: 1; type: "ready" }
  | {
      v: 1;
      type: "element-selected";
      fiberId: string;
      sourceFile: string;
      line: number;
      column: number;
    }
  | { v: 1; type: "element-hovered"; fiberId: string; rect: DOMRect }
  | { v: 1; type: "navigation"; path: string }
  | { v: 1; type: "console-error"; message: string; stack?: string }
  | { v: 1; type: "hmr"; file: string };
```

The iframe-side script is ~200 lines. It is injected by each adapter at dev-server startup, never modifies user source.

## ASTEditor operations (`design-mode-ast`)

Each operation is a discriminated union. Operations are validated then applied atomically per file.

```ts
export type ASTOperation =
  | AddVariantOp
  | ModifyClassStringOp
  | AddPropOp
  | CreateMockupRouteOp
  | ExtractComponentOp
  | ImportComponentOp;

export interface AddVariantOp {
  kind: "add-variant";
  componentPath: string;
  variantName: string; // 'destructive'
  variantValue: string; // 'bg-red-500 text-white'
  // The editor detects the project's variant pattern and extends it correctly
}

export interface ModifyClassStringOp {
  kind: "modify-classes";
  filePath: string;
  jsxNodeLocator: JsxNodeLocator; // see below
  newClassString: string;
}

// Locating a specific JSX node without using line/col (which drift on edits):
// We use a structural path: ['ExportDefault', 'JSXElement[0]', 'JSXElement[1]', 'JSXAttribute:className']
export type JsxNodeLocator = string[];

export interface CreateMockupRouteOp {
  kind: "create-mockup-route";
  routePath: string; // '/mockups/settings-v2'
  filePath: string; // resolved by adapter
  jsxBody: string; // the JSX
  imports: ImportSpec[];
}

export interface ImportSpec {
  source: string; // '@/components/ui/button'
  named: string[];
  default?: string;
}

// Validation
export interface ValidationError {
  kind: "unknown-import" | "unknown-class" | "invalid-prop" | "syntax";
  message: string;
  hint?: string;
}

export interface ASTEditor {
  validate(op: ASTOperation, manifest: DesignManifest): ValidationError[];
  apply(op: ASTOperation): Promise<AppliedEdit>;
  preview(op: ASTOperation): Promise<{ before: string; after: string }>; // unified diff
}

export interface AppliedEdit {
  filesChanged: string[];
  rollback: () => Promise<void>; // for failed iterations
}
```

## DesignContextPacker output

What the agent receives. This is the most important shape in the system.

```ts
export interface DesignContextPayload {
  turnKind: "tweak" | "variant" | "mockup" | "inspect";
  tokens: CompactTokens; // serialized for prompt, not full manifest
  availableImports: ImportCatalog;
  classDialect: CompactDialect;
  exemplars: Exemplar[]; // 0-3 reference compositions
  selection?: SelectionContext; // when tweaking
  constraints: AgentConstraint[]; // hard rules
  userIntent: string;
}

export interface ImportCatalog {
  primitives: { name: string; importFrom: string; props: PropSignature[] }[];
  composites: { name: string; importFrom: string }[];
  utilities: { name: string; importFrom: string }[]; // cn, cva, etc.
}

export interface CompactDialect {
  topClasses: string[]; // top 50 most-used
  spacingScale: string[];
  forbiddenPatterns: string[]; // 'arbitrary-values' if ratio < 5%
  preferredAliases: Record<string, string>;
}

export interface AgentConstraint {
  rule: "only-import-from" | "only-use-classes" | "match-pattern" | "preserve-prop";
  detail: unknown;
}

export interface Exemplar {
  filePath: string;
  jsx: string; // truncated source
  whyChosen: string; // 'most similar route by primitive overlap'
}
```

## Storage formats

`.t3design/manifest.json`: serialized `DesignManifest`. Cache, regenerable.

`.t3design/overrides.json`:

```json
{
  "schemaVersion": 1,
  "primitives": {
    "add": ["src/lib/Custom.tsx#default"],
    "remove": ["src/components/InternalThing.tsx#default"]
  },
  "dialect": {
    "blockedClasses": ["text-blue-500"],
    "preferredAliases": { "rounded-md": "rounded-lg" }
  },
  "wrappers": {
    "componentId": "src/lib/CustomDialog.tsx#default",
    "wrapperFile": "src/components/providers.tsx"
  }
}
```

`.t3design/wrappers.tsx`: optional. Exports a `Wrapper` component that renders providers (Theme, Auth, Router, QueryClient) around any isolated component. Auto-generated on first use by scanning the user's `App.tsx` or `__root.tsx`.

## Validation pipeline

Every AST operation runs through:

1. **Syntactic validation** — does it parse?
2. **Reference validation** — do all imports resolve to real files? Do all components exist? (cross-check with manifest)
3. **Class validation** — are all Tailwind classes valid (Tailwind's own validator) and in the project's dialect (or explicitly allowed)?
4. **Type validation** — do prop assignments match component prop types?
5. **Pattern validation** — if adding a variant, does it match the detected variant pattern shape?

Failures return structured errors that the agent can act on (it gets a chance to retry with the error feedback).

## Testing strategy

- **Adapter contract tests**: a shared test suite each adapter must pass, run against fixture projects (one tiny Vite project, one TanStack Start project).
- **Manifest extraction snapshots**: known fixture projects → expected manifest. Snapshot-tested.
- **AST operation tests**: input source + operation → expected output source. Pure function tests.
- **Bridge protocol tests**: exercise host↔iframe message exchange in JSDOM with a stub iframe.
- **End-to-end smoke**: spawn real dev server against fixture, take a screenshot of the iframe, assert basic correctness.

## Performance budgets

- Initial manifest extraction on a 200-component project: < 5s
- Manifest update on file save: < 200ms (incremental)
- Click-to-select round trip: < 100ms
- AST operation apply (typical tweak): < 500ms including HMR settle
- Mockup generation context-pack: < 300ms (excluding agent inference)

## Telemetry

Local-only by default. Optional opt-in to send anonymized:

- Framework + Tailwind version
- Manifest size buckets
- Operation success/failure rates
- Time-to-first-render

Never send: source code, file paths, prop values, generated content, user prompts.

## Open questions

- Should the manifest be incremental from day 1, or batch-rebuild for v1? **Recommendation**: batch for v1, incremental in v2 once we know what changes most often.
- Should virtual routes live in the user's source tree (visible) or be fully synthetic via Vite plugin (invisible)? **Recommendation**: synthetic. Don't pollute source.
- How do we handle projects with no TypeScript? **Recommendation**: `react-docgen` (the JS-friendly one) as fallback, with reduced prop fidelity.
- Where does the "design mode is active" flag live during agent turns? **Recommendation**: a per-turn metadata flag in the existing T3 Code chat envelope.
