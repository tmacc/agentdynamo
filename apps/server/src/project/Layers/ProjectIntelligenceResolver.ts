import * as OS from "node:os";
import type { Dirent } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import type {
  ProjectGetIntelligenceInput,
  ProjectGetIntelligenceResult,
  ProjectIntelligenceCodeStats,
  ProjectIntelligenceContentType,
  ProjectIntelligenceHookConfigSummary,
  ProjectIntelligenceOwner,
  ProjectIntelligenceProviderRuntimeSummary,
  ProjectIntelligenceScope,
  ProjectIntelligenceScopeSummary,
  ProjectIntelligenceSettingsSummary,
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceSurfaceKind,
  ProjectIntelligenceSurfaceSummary,
  ProjectIntelligenceWarning,
  ProjectReadIntelligenceSurfaceResult,
  ServerProvider,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import {
  AUTHORED_SOURCE_CODE_STATS_BASIS,
  approximateTokenCount,
  countNonEmptyLines,
  isLikelyGeneratedSource,
  isSourceLikePath,
  shouldIgnoreCodeStatsPath,
} from "@t3tools/shared/codeStatsPolicy";

import {
  GitCore,
  type GitCoreShape,
  type GitListWorkspaceFilesResult,
} from "../../git/Services/GitCore.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { WorkspacePaths } from "../../workspace/Services/WorkspacePaths.ts";
import {
  ProjectIntelligenceResolver,
  ProjectIntelligenceResolverError,
  type ProjectIntelligenceResolverShape,
} from "../Services/ProjectIntelligenceResolver.ts";

const EXCERPT_MAX_NON_EMPTY_LINES = 12;
const EXCERPT_MAX_CHARS = 700;
const MAX_SURFACE_CONTENT_BYTES = 64 * 1024;
const MAX_CODE_STATS_FILES = 25_000;
const READ_TARGET_PREFIX = "intel:";
const SECRET_KEY_PATTERN = /(secret|token|password|api[_-]?key|credential|private[_-]?key)/i;
const BOOLEAN_LIKE_PATTERN = /^(true|false|0|1)$/i;

type SurfaceReadTarget =
  | {
      readonly mode: "file";
      readonly contentType: ProjectIntelligenceContentType;
      readonly path: string;
      readonly kind: ProjectIntelligenceSurfaceKind;
    }
  | {
      readonly mode: "virtual";
      readonly contentType: ProjectIntelligenceContentType;
      readonly kind: ProjectIntelligenceSurfaceKind;
      readonly content: string;
    };

type SurfaceSeed = {
  readonly dedupeKey: string;
  readonly id: ProjectIntelligenceSurfaceId;
  readonly owner: ProjectIntelligenceOwner;
  readonly kind: ProjectIntelligenceSurfaceKind;
  readonly label: string;
  readonly path: string;
  readonly openPath?: string;
  readonly aliases?: readonly string[];
  readonly scope: ProjectIntelligenceScope;
  readonly activation: ProjectIntelligenceSurfaceSummary["activation"];
  readonly enabled: boolean;
  readonly description?: string;
  readonly triggerLabel?: string;
  readonly sourceLabel?: string;
  readonly promptExcerpt?: string;
  readonly lineCount: number;
  readonly approxTokenCount: number;
  readonly frontmatter?: Record<string, string>;
  readonly derivedFrom?: ProjectIntelligenceSurfaceId;
  readonly hookConfig?: ProjectIntelligenceHookConfigSummary;
  readonly settingsSummary?: ProjectIntelligenceSettingsSummary;
};

type SurfaceAccumulator = {
  readonly dedupeKey: string;
  id: ProjectIntelligenceSurfaceId;
  owner: ProjectIntelligenceOwner;
  kind: ProjectIntelligenceSurfaceKind;
  label: string;
  path: string;
  openPath?: string;
  aliases: Set<string>;
  scope: ProjectIntelligenceScope;
  activation: ProjectIntelligenceSurfaceSummary["activation"];
  enabled: boolean;
  description?: string;
  triggerLabel?: string;
  sourceLabel?: string;
  promptExcerpt?: string;
  lineCount: number;
  approxTokenCount: number;
  frontmatter: Record<string, string>;
  derivedFrom?: ProjectIntelligenceSurfaceId;
  hookConfig?: ProjectIntelligenceHookConfigSummary;
  settingsSummary?: ProjectIntelligenceSettingsSummary;
};

function toResolverError(
  operation: string,
  detail: string,
  cause?: unknown,
): ProjectIntelligenceResolverError {
  return new ProjectIntelligenceResolverError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function normalizeText(content: string): string {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function basename(input: string): string {
  return path.basename(input);
}

function normalizeProjectMemoryKey(cwd: string): string {
  return path
    .resolve(cwd)
    .replace(/[\\/:\s]+/g, "-")
    .replace(/-+/g, "-");
}

function surfaceIdFromTarget(target: SurfaceReadTarget): ProjectIntelligenceSurfaceId {
  return `${READ_TARGET_PREFIX}${Buffer.from(JSON.stringify(target)).toString("base64url")}` as ProjectIntelligenceSurfaceId;
}

function decodeSurfaceId(surfaceId: ProjectIntelligenceSurfaceId): SurfaceReadTarget | null {
  if (!surfaceId.startsWith(READ_TARGET_PREFIX)) {
    return null;
  }

  try {
    const decoded = Buffer.from(surfaceId.slice(READ_TARGET_PREFIX.length), "base64url").toString(
      "utf8",
    );
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as SurfaceReadTarget;
  } catch {
    return null;
  }
}

function toExcerpt(content: string): string | undefined {
  const nonEmptyLines = content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    return undefined;
  }

  const excerpt = nonEmptyLines
    .slice(0, EXCERPT_MAX_NON_EMPTY_LINES)
    .join("\n")
    .slice(0, EXCERPT_MAX_CHARS);
  return excerpt.trim().length > 0 ? excerpt : undefined;
}

function decodeQuotedValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(content: string): {
  readonly body: string;
  readonly frontmatter: Record<string, string>;
} {
  if (!content.startsWith("---\n")) {
    return { body: content, frontmatter: {} };
  }

  const lines = content.split("\n");
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    return { body: content, frontmatter: {} };
  }

  const frontmatter: Record<string, string> = {};
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index] ?? "";
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const [, key = "", rawValue = ""] = match;
    if (key.length === 0) {
      continue;
    }
    if (rawValue === "|" || rawValue === ">") {
      const blockLines: string[] = [];
      for (let nestedIndex = index + 1; nestedIndex < closingIndex; nestedIndex += 1) {
        const nestedLine = lines[nestedIndex] ?? "";
        if (nestedLine.length > 0 && !/^\s/.test(nestedLine)) {
          break;
        }
        blockLines.push(nestedLine.replace(/^\s+/, ""));
        index = nestedIndex;
      }
      const joinedValue =
        rawValue === ">" ? blockLines.join(" ").replace(/\s+/g, " ") : blockLines.join("\n");
      frontmatter[key] = joinedValue.trim();
      continue;
    }
    frontmatter[key] = decodeQuotedValue(rawValue);
  }

  return {
    body: lines.slice(closingIndex + 1).join("\n"),
    frontmatter,
  };
}

function mergeSourceLabel(
  currentValue: string | undefined,
  nextValue: string | undefined,
): string | undefined {
  if (!nextValue) {
    return currentValue;
  }
  if (!currentValue || currentValue === nextValue) {
    return nextValue;
  }
  const parts = new Set([...currentValue.split(" + "), nextValue]);
  return [...parts].join(" + ");
}

function addSurface(accumulator: Map<string, SurfaceAccumulator>, seed: SurfaceSeed): void {
  const existing = accumulator.get(seed.dedupeKey);
  if (!existing) {
    accumulator.set(seed.dedupeKey, {
      dedupeKey: seed.dedupeKey,
      id: seed.id,
      owner: seed.owner,
      kind: seed.kind,
      label: seed.label,
      path: seed.path,
      ...(seed.openPath ? { openPath: seed.openPath } : {}),
      aliases: new Set(seed.aliases ?? []),
      scope: seed.scope,
      activation: seed.activation,
      enabled: seed.enabled,
      ...(seed.description ? { description: seed.description } : {}),
      ...(seed.triggerLabel ? { triggerLabel: seed.triggerLabel } : {}),
      ...(seed.sourceLabel ? { sourceLabel: seed.sourceLabel } : {}),
      ...(seed.promptExcerpt ? { promptExcerpt: seed.promptExcerpt } : {}),
      lineCount: seed.lineCount,
      approxTokenCount: seed.approxTokenCount,
      frontmatter: { ...seed.frontmatter },
      ...(seed.derivedFrom ? { derivedFrom: seed.derivedFrom } : {}),
      ...(seed.hookConfig ? { hookConfig: seed.hookConfig } : {}),
      ...(seed.settingsSummary ? { settingsSummary: seed.settingsSummary } : {}),
    });
    return;
  }

  existing.aliases.add(basename(seed.path));
  for (const alias of seed.aliases ?? []) {
    existing.aliases.add(alias);
  }
  const mergedSourceLabel = mergeSourceLabel(existing.sourceLabel, seed.sourceLabel);
  if (mergedSourceLabel) {
    existing.sourceLabel = mergedSourceLabel;
  }
  existing.enabled &&= seed.enabled;
  if (!existing.description && seed.description) {
    existing.description = seed.description;
  }
  if (!existing.triggerLabel && seed.triggerLabel) {
    existing.triggerLabel = seed.triggerLabel;
  }
  if (!existing.promptExcerpt && seed.promptExcerpt) {
    existing.promptExcerpt = seed.promptExcerpt;
  }
  if (!existing.openPath && seed.openPath) {
    existing.openPath = seed.openPath;
  }
  if (Object.keys(existing.frontmatter).length === 0 && seed.frontmatter) {
    existing.frontmatter = { ...seed.frontmatter };
  }
  if (!existing.settingsSummary && seed.settingsSummary) {
    existing.settingsSummary = seed.settingsSummary;
  }
}

function toSurfaceSummary(accumulator: SurfaceAccumulator): ProjectIntelligenceSurfaceSummary {
  const aliases = [...accumulator.aliases].filter((alias) => alias !== basename(accumulator.path));
  return {
    id: accumulator.id,
    owner: accumulator.owner,
    kind: accumulator.kind,
    label: accumulator.label.trim(),
    path: accumulator.path,
    ...(accumulator.openPath ? { openPath: accumulator.openPath } : {}),
    aliases,
    scope: accumulator.scope,
    activation: accumulator.activation,
    enabled: accumulator.enabled,
    ...(accumulator.description ? { description: accumulator.description } : {}),
    ...(accumulator.triggerLabel ? { triggerLabel: accumulator.triggerLabel } : {}),
    ...(accumulator.sourceLabel ? { sourceLabel: accumulator.sourceLabel } : {}),
    ...(accumulator.promptExcerpt ? { promptExcerpt: accumulator.promptExcerpt } : {}),
    lineCount: accumulator.lineCount,
    approxTokenCount: accumulator.approxTokenCount,
    frontmatter: accumulator.frontmatter,
    ...(accumulator.derivedFrom ? { derivedFrom: accumulator.derivedFrom } : {}),
    ...(accumulator.hookConfig ? { hookConfig: accumulator.hookConfig } : {}),
    ...(accumulator.settingsSummary ? { settingsSummary: accumulator.settingsSummary } : {}),
  };
}

function isSecretLikeKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function redactSettingsValue(value: unknown, keyPath: ReadonlyArray<string> = []): unknown {
  const currentKey = keyPath[keyPath.length - 1] ?? "";
  if (Array.isArray(value)) {
    return value.map((entry) => redactSettingsValue(entry, keyPath));
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (keyPath.includes("env") && !BOOLEAN_LIKE_PATTERN.test(value)) {
        return "[redacted]";
      }
      if (isSecretLikeKey(currentKey)) {
        return "[redacted]";
      }
    }
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, entryValue]) => {
      if (isSecretLikeKey(key)) {
        return [key, "[redacted]"];
      }
      return [key, redactSettingsValue(entryValue, [...keyPath, key])];
    }),
  );
}

function formatVirtualSurfaceContent(input: {
  readonly label: string;
  readonly description?: string;
  readonly triggerLabel?: string;
  readonly sourceLabel?: string;
}): string {
  const lines = [`# ${input.label}`];
  if (input.triggerLabel) {
    lines.push(``, `Trigger: ${input.triggerLabel}`);
  }
  if (input.sourceLabel) {
    lines.push(`Source: ${input.sourceLabel}`);
  }
  if (input.description) {
    lines.push(``, input.description);
  }
  return lines.join("\n");
}

function parseClaudeHooks(
  settingsPath: string,
  value: unknown,
  derivedFrom: ProjectIntelligenceSurfaceId,
  scope: ProjectIntelligenceScope,
  warnings: ProjectIntelligenceWarning[],
): ReadonlyArray<SurfaceSeed> {
  if (!value || typeof value !== "object") {
    return [];
  }

  const hooksRecord = value as Record<string, unknown>;
  const surfaces: SurfaceSeed[] = [];
  for (const [eventName, eventValue] of Object.entries(hooksRecord)) {
    const normalizedEvent = eventName.trim();
    if (normalizedEvent.length === 0) {
      continue;
    }

    const normalizedEntries: ReadonlyArray<{ readonly matcher: string; readonly value: unknown }> =
      Array.isArray(eventValue)
        ? eventValue.map((entry) => ({ matcher: "", value: entry }))
        : eventValue && typeof eventValue === "object"
          ? Object.entries(eventValue as Record<string, unknown>).map(
              ([matcher, matcherValue]) => ({
                matcher,
                value: matcherValue,
              }),
            )
          : [];

    let hookIndex = 0;
    for (const entry of normalizedEntries) {
      const matcher = entry.matcher.trim() || undefined;
      const rawValue = entry.value;
      const rawValueRecord =
        rawValue && typeof rawValue === "object" ? (rawValue as Record<string, unknown>) : null;
      const commands: ReadonlyArray<unknown> = Array.isArray(rawValue)
        ? rawValue
        : Array.isArray(rawValueRecord?.hooks)
          ? rawValueRecord.hooks
          : Array.isArray(rawValueRecord?.commands)
            ? rawValueRecord.commands
            : [];
      const commandSummary = commands
        .map((command: unknown): string => {
          if (typeof command === "string") {
            return command.trim();
          }
          if (command && typeof command === "object") {
            const commandRecord = command as Record<string, unknown>;
            if (typeof commandRecord.command === "string") {
              return commandRecord.command.trim();
            }
            return JSON.stringify(command);
          }
          return "";
        })
        .filter((command): command is string => command.length > 0);

      if (commandSummary.length === 0) {
        warnings.push({
          id: `hook:${settingsPath}:${normalizedEvent}:${hookIndex}`,
          message: `Ignored a Claude hook entry without executable actions for ${normalizedEvent}.`,
          severity: "info",
          path: settingsPath,
        });
        hookIndex += 1;
        continue;
      }

      const content = [
        `# ${normalizedEvent} Hook`,
        "",
        `Event: ${normalizedEvent}`,
        ...(matcher ? [`Matcher: ${matcher}`] : []),
        "",
        "Actions:",
        ...commandSummary.map((command) => `- ${command}`),
      ].join("\n");
      const id = surfaceIdFromTarget({
        mode: "virtual",
        contentType: "markdown",
        kind: "hook",
        content,
      });
      const promptExcerpt = toExcerpt(content);
      surfaces.push({
        dedupeKey: `${settingsPath}#hook:${normalizedEvent}:${hookIndex}`,
        id,
        owner: "claude",
        kind: "hook",
        label: `${normalizedEvent} hook`,
        path: settingsPath,
        openPath: settingsPath,
        scope,
        activation: "on-event",
        enabled: !(
          rawValue &&
          typeof rawValue === "object" &&
          (rawValue as Record<string, unknown>).enabled === false
        ),
        triggerLabel: normalizedEvent,
        sourceLabel: "Claude Hook",
        ...(promptExcerpt ? { promptExcerpt } : {}),
        lineCount: countNonEmptyLines(content),
        approxTokenCount: approximateTokenCount(content),
        derivedFrom,
        hookConfig: {
          event: normalizedEvent,
          ...(matcher ? { matcher } : {}),
          enabled: !(
            rawValue &&
            typeof rawValue === "object" &&
            (rawValue as Record<string, unknown>).enabled === false
          ),
          actionSummary: commandSummary.join(" | "),
        },
      });
      hookIndex += 1;
    }
  }

  return surfaces;
}

function parseSettingsSummary(value: unknown): ProjectIntelligenceSettingsSummary {
  if (!value || typeof value !== "object") {
    return {
      allowCount: 0,
      askCount: 0,
      denyCount: 0,
      enabledPluginIds: [],
      featureFlags: [],
    };
  }

  const record = value as Record<string, unknown>;
  const permissions =
    record.permissions && typeof record.permissions === "object"
      ? (record.permissions as Record<string, unknown>)
      : {};
  const enabledPlugins =
    record.enabledPlugins && typeof record.enabledPlugins === "object"
      ? (record.enabledPlugins as Record<string, unknown>)
      : {};
  const env =
    record.env && typeof record.env === "object" ? (record.env as Record<string, unknown>) : {};
  const featureFlags = [
    ...Object.entries(record)
      .filter(
        ([key, value]) =>
          typeof value === "boolean" &&
          value === true &&
          key !== "skipDangerousModePermissionPrompt",
      )
      .map(([key]) => key),
    ...Object.entries(env)
      .filter(
        ([, value]) =>
          typeof value === "string" && BOOLEAN_LIKE_PATTERN.test(value) && value !== "0",
      )
      .map(([key]) => key),
  ];

  return {
    ...(typeof permissions.defaultMode === "string"
      ? { permissionsMode: permissions.defaultMode.trim() }
      : {}),
    allowCount: Array.isArray(permissions.allow) ? permissions.allow.length : 0,
    askCount: Array.isArray(permissions.ask) ? permissions.ask.length : 0,
    denyCount: Array.isArray(permissions.deny) ? permissions.deny.length : 0,
    enabledPluginIds: Object.entries(enabledPlugins)
      .filter(([, enabled]) => enabled === true)
      .map(([pluginId]) => pluginId),
    featureFlags,
  };
}

async function statIfExists(
  targetPath: string,
): Promise<Awaited<ReturnType<typeof fsPromises.stat>> | null> {
  try {
    return await fsPromises.stat(targetPath);
  } catch {
    return null;
  }
}

async function realPathOrSelf(targetPath: string): Promise<string> {
  try {
    return await fsPromises.realpath(targetPath);
  } catch {
    return targetPath;
  }
}

async function readTextIfExists(targetPath: string): Promise<string | null> {
  try {
    const content = await fsPromises.readFile(targetPath, "utf8");
    return normalizeText(content);
  } catch {
    return null;
  }
}

async function listDirectoryEntries(targetPath: string): Promise<ReadonlyArray<Dirent>> {
  try {
    return await fsPromises.readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function findNamedFiles(
  rootPath: string,
  targetBasename: string,
): Promise<ReadonlyArray<string>> {
  const rootStat = await statIfExists(rootPath);
  if (!rootStat || !rootStat.isDirectory()) {
    return [];
  }

  const results: string[] = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const currentPath = stack.pop()!;
    for (const entry of await listDirectoryEntries(currentPath)) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === targetBasename) {
        results.push(entryPath);
      }
    }
  }
  return results;
}

async function listTopLevelMarkdownFiles(rootPath: string): Promise<ReadonlyArray<string>> {
  const rootStat = await statIfExists(rootPath);
  if (!rootStat || !rootStat.isDirectory()) {
    return [];
  }
  const entries = await listDirectoryEntries(rootPath);
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => path.join(rootPath, entry.name));
}

function detectContentType(
  kind: ProjectIntelligenceSurfaceKind,
  filePath: string,
): ProjectIntelligenceContentType {
  if (kind === "settings") {
    return "json";
  }
  if (filePath.toLowerCase().endsWith(".md")) {
    return "markdown";
  }
  return "text";
}

async function buildMarkdownSurface(input: {
  readonly filePath: string;
  readonly owner: ProjectIntelligenceOwner;
  readonly kind: Extract<
    ProjectIntelligenceSurfaceKind,
    "instruction" | "agent" | "command" | "skill" | "memory"
  >;
  readonly scope: ProjectIntelligenceScope;
  readonly activation: ProjectIntelligenceSurfaceSummary["activation"];
  readonly sourceLabel: string;
  readonly triggerLabel?: string;
  readonly descriptionOverride?: string;
}): Promise<SurfaceSeed | null> {
  const content = await readTextIfExists(input.filePath);
  if (content === null) {
    return null;
  }
  const realPath = await realPathOrSelf(input.filePath);
  const { body, frontmatter } = parseFrontmatter(content);
  const previewSource = body.trim().length > 0 ? body : content;
  const resolvedLabel =
    frontmatter.name?.trim() ||
    frontmatter.displayName?.trim() ||
    basename(input.filePath).replace(/\.md$/i, "");
  const resolvedDescription =
    input.descriptionOverride ||
    frontmatter.description?.trim() ||
    frontmatter.shortDescription?.trim();
  const contentType = detectContentType(input.kind, input.filePath);
  const promptExcerpt = toExcerpt(previewSource);
  return {
    dedupeKey: realPath,
    id: surfaceIdFromTarget({
      mode: "file",
      contentType,
      kind: input.kind,
      path: realPath,
    }),
    owner: input.owner,
    kind: input.kind,
    label: resolvedLabel,
    path: input.filePath,
    openPath: input.filePath,
    aliases: realPath === input.filePath ? [] : [basename(input.filePath)],
    scope: input.scope,
    activation: input.activation,
    enabled: true,
    ...(resolvedDescription ? { description: resolvedDescription } : {}),
    ...(input.triggerLabel ? { triggerLabel: input.triggerLabel } : {}),
    sourceLabel: input.sourceLabel,
    ...(promptExcerpt ? { promptExcerpt } : {}),
    lineCount: countNonEmptyLines(content),
    approxTokenCount: approximateTokenCount(content),
    frontmatter,
  };
}

async function buildSettingsSurface(input: {
  readonly filePath: string;
  readonly scope: ProjectIntelligenceScope;
  readonly warnings: ProjectIntelligenceWarning[];
}): Promise<{
  readonly settingsSurface: SurfaceSeed;
  readonly hookSurfaces: ReadonlyArray<SurfaceSeed>;
} | null> {
  const content = await readTextIfExists(input.filePath);
  if (content === null) {
    return null;
  }
  const realPath = await realPathOrSelf(input.filePath);
  let parsed: unknown = null;
  let redactedContent = content;
  let settingsSummary = parseSettingsSummary(undefined);
  try {
    parsed = JSON.parse(content);
    settingsSummary = parseSettingsSummary(parsed);
    redactedContent = JSON.stringify(redactSettingsValue(parsed), null, 2);
  } catch (cause) {
    input.warnings.push({
      id: `settings-parse:${input.filePath}`,
      message: `Could not parse Claude settings file ${basename(input.filePath)}.`,
      severity: "warning",
      path: input.filePath,
    });
    input.warnings.push({
      id: `settings-parse-detail:${input.filePath}`,
      message:
        cause instanceof Error
          ? cause.message.trim() || "Invalid JSON in Claude settings file."
          : "Invalid JSON in Claude settings file.",
      severity: "info",
      path: input.filePath,
    });
  }

  const surfaceId = surfaceIdFromTarget({
    mode: "file",
    contentType: "json",
    kind: "settings",
    path: realPath,
  });
  const promptExcerpt = toExcerpt(redactedContent);
  const settingsSurface: SurfaceSeed = {
    dedupeKey: realPath,
    id: surfaceId,
    owner: "claude",
    kind: "settings",
    label: basename(input.filePath),
    path: input.filePath,
    openPath: input.filePath,
    aliases: realPath === input.filePath ? [] : [basename(input.filePath)],
    scope: input.scope,
    activation: "runtime-config",
    enabled: true,
    description: "Claude runtime configuration and plugin/permission settings.",
    sourceLabel: "Claude Settings",
    ...(promptExcerpt ? { promptExcerpt } : {}),
    lineCount: countNonEmptyLines(redactedContent),
    approxTokenCount: approximateTokenCount(redactedContent),
    settingsSummary,
  };

  const hookSurfaces =
    parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).hooks !== undefined
      ? parseClaudeHooks(
          input.filePath,
          (parsed as Record<string, unknown>).hooks,
          surfaceId,
          input.scope,
          input.warnings,
        )
      : [];
  return {
    settingsSurface,
    hookSurfaces,
  };
}

function buildSettingsPluginSurfaces(input: {
  readonly settingsPath: string;
  readonly scope: ProjectIntelligenceScope;
  readonly derivedFrom: ProjectIntelligenceSurfaceId;
  readonly settingsSummary: ProjectIntelligenceSettingsSummary;
}): ReadonlyArray<SurfaceSeed> {
  return input.settingsSummary.enabledPluginIds.map((pluginId) => {
    const content = [
      `# ${pluginId}`,
      "",
      `Enabled via ${basename(input.settingsPath)}`,
      "",
      "This plugin is enabled in Claude runtime settings.",
    ].join("\n");
    const promptExcerpt = toExcerpt(content);

    return {
      dedupeKey: `claude-plugin:${input.scope}:${pluginId}`,
      id: surfaceIdFromTarget({
        mode: "virtual",
        contentType: "markdown",
        kind: "plugin",
        content,
      }),
      owner: "claude",
      kind: "plugin",
      label: pluginId,
      path: `plugin://claude/${pluginId}`,
      scope: input.scope,
      activation: "runtime-config",
      enabled: true,
      description: "Enabled Claude plugin.",
      sourceLabel: "Claude Plugin",
      ...(promptExcerpt ? { promptExcerpt } : {}),
      lineCount: countNonEmptyLines(content),
      approxTokenCount: approximateTokenCount(content),
      derivedFrom: input.derivedFrom,
    };
  });
}

async function collectCodeStats(input: {
  readonly cwd: string;
  readonly git: GitCoreShape;
}): Promise<ProjectIntelligenceCodeStats> {
  const isGitRepo = await Effect.runPromise(
    input.git.isInsideWorkTree(input.cwd).pipe(Effect.orElseSucceed(() => false)),
  );

  let candidatePaths: readonly string[] = [];
  let partial = false;
  if (isGitRepo) {
    const listedFiles: GitListWorkspaceFilesResult = await Effect.runPromise(
      input.git.listWorkspaceFiles(input.cwd).pipe(
        Effect.orElseSucceed(
          (): GitListWorkspaceFilesResult => ({
            paths: [] as readonly string[],
            truncated: false,
          }),
        ),
      ),
    );
    candidatePaths = listedFiles.paths;
    partial ||= listedFiles.truncated;
  } else {
    const discoveredPaths: string[] = [];
    const stack = [input.cwd];
    while (stack.length > 0 && discoveredPaths.length < MAX_CODE_STATS_FILES) {
      const currentPath = stack.pop()!;
      for (const entry of await listDirectoryEntries(currentPath)) {
        const nextPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(input.cwd, nextPath).replaceAll("\\", "/");
        if (entry.isDirectory()) {
          if (shouldIgnoreCodeStatsPath(`${relativePath}/index.ts`)) {
            continue;
          }
          stack.push(nextPath);
          continue;
        }
        if (entry.isFile()) {
          discoveredPaths.push(relativePath);
          if (discoveredPaths.length >= MAX_CODE_STATS_FILES) {
            partial = true;
            break;
          }
        }
      }
    }
    candidatePaths = discoveredPaths;
  }

  let fileCount = 0;
  let loc = 0;
  let approxTokens = 0;
  for (const relativePath of candidatePaths) {
    if (!isSourceLikePath(relativePath)) {
      continue;
    }
    const absolutePath = path.join(input.cwd, relativePath);
    const content = await readTextIfExists(absolutePath);
    if (content === null || isLikelyGeneratedSource(content)) {
      continue;
    }
    fileCount += 1;
    loc += countNonEmptyLines(content);
    approxTokens += approximateTokenCount(content);
  }

  return {
    basis: AUTHORED_SOURCE_CODE_STATS_BASIS,
    fileCount,
    loc,
    approxTokenCount: approxTokens,
    partial,
  };
}

function sortSurfaces(
  left: ProjectIntelligenceSurfaceSummary,
  right: ProjectIntelligenceSurfaceSummary,
): number {
  return (
    left.owner.localeCompare(right.owner) ||
    left.scope.localeCompare(right.scope) ||
    left.kind.localeCompare(right.kind) ||
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
  );
}

function summarizeProviderRuntime(
  providers: ReadonlyArray<ServerProvider>,
  settingsSurfaceByScope: Map<ProjectIntelligenceScope, ProjectIntelligenceSettingsSummary>,
): ReadonlyArray<ProjectIntelligenceProviderRuntimeSummary> {
  const preferredSettingsSummary =
    settingsSurfaceByScope.get("effective-project") ??
    settingsSurfaceByScope.get("base-project") ??
    settingsSurfaceByScope.get("user");

  return providers.map((provider) => ({
    provider: provider.provider,
    status: provider.status,
    auth: provider.auth,
    models: provider.models,
    discoveredSkillCount: provider.skills.length,
    discoveredSlashCommandCount: provider.slashCommands.length,
    ...(provider.provider === "claudeAgent" && preferredSettingsSummary
      ? {
          permissionsSummary: {
            defaultMode: preferredSettingsSummary.permissionsMode ?? "acceptEdits",
            allowCount: preferredSettingsSummary.allowCount,
            askCount: preferredSettingsSummary.askCount,
            denyCount: preferredSettingsSummary.denyCount,
          },
          enabledPluginIds: preferredSettingsSummary.enabledPluginIds,
          featureFlags: preferredSettingsSummary.featureFlags,
        }
      : {
          enabledPluginIds: [],
          featureFlags: [],
        }),
  }));
}

export const makeProjectIntelligenceResolver = Effect.gen(function* () {
  const workspacePaths = yield* WorkspacePaths;
  const git = yield* GitCore;
  const providerRegistry = yield* ProviderRegistry;
  const serverSettings = yield* ServerSettingsService;
  const runtimeContext = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(runtimeContext);

  const collectIntelligence = async (
    input: ProjectGetIntelligenceInput,
  ): Promise<ProjectGetIntelligenceResult> => {
    const warnings: ProjectIntelligenceWarning[] = [];

    let normalizedProjectCwd: string;
    try {
      normalizedProjectCwd = await runPromise(
        workspacePaths.normalizeWorkspaceRoot(input.projectCwd),
      );
    } catch (cause) {
      throw toResolverError(
        "projectIntelligence.normalizeProjectRoot",
        "Project root is unavailable.",
        cause,
      );
    }

    const requestedEffectiveCwd =
      input.viewMode === "thread" && input.effectiveCwd && input.effectiveCwd.trim().length > 0
        ? input.effectiveCwd
        : undefined;

    let normalizedEffectiveCwd: string | undefined;
    if (requestedEffectiveCwd) {
      const maybeEffectiveCwd = await runPromise(
        workspacePaths.normalizeWorkspaceRoot(requestedEffectiveCwd).pipe(Effect.option),
      );
      if (maybeEffectiveCwd._tag === "Some") {
        normalizedEffectiveCwd = maybeEffectiveCwd.value;
      } else {
        warnings.push({
          id: `effective-root:${requestedEffectiveCwd}`,
          message: "Effective thread workspace is unavailable. Showing base project context.",
          severity: "warning",
          path: requestedEffectiveCwd,
        });
      }
    }

    const settings = await runPromise(serverSettings.getSettings);
    const configuredCodexHome = settings.providers.codex.homePath.trim();
    const codexHome = path.resolve(
      configuredCodexHome.length > 0
        ? configuredCodexHome
        : process.env.CODEX_HOME || path.join(OS.homedir(), ".codex"),
    );
    const claudeHome = path.join(OS.homedir(), ".claude");
    const agentsHome = path.join(OS.homedir(), ".agents");
    const activeProjectRoot =
      input.viewMode === "thread"
        ? (normalizedEffectiveCwd ?? normalizedProjectCwd)
        : normalizedProjectCwd;
    const currentMemoryDir = path.join(
      claudeHome,
      "projects",
      normalizeProjectMemoryKey(activeProjectRoot),
      "memory",
    );

    const surfaces = new Map<string, SurfaceAccumulator>();
    const settingsSummaryByScope = new Map<
      ProjectIntelligenceScope,
      ProjectIntelligenceSettingsSummary
    >();

    const addProjectInstructionCandidates = async (
      cwd: string,
      scope: Extract<ProjectIntelligenceScope, "base-project" | "effective-project">,
    ): Promise<void> => {
      for (const candidateName of ["AGENTS.md", "CLAUDE.md"] as const) {
        const candidatePath = path.join(cwd, candidateName);
        const candidateStat = await statIfExists(candidatePath);
        if (!candidateStat?.isFile()) {
          continue;
        }

        const surface = await buildMarkdownSurface({
          filePath: candidatePath,
          owner: "shared",
          kind: "instruction",
          scope,
          activation: "always-loaded",
          sourceLabel: candidateName === "CLAUDE.md" ? "Claude Instruction" : "Project Instruction",
        });
        if (surface) {
          addSurface(surfaces, surface);
        }
      }
    };

    const addClaudeSurfaces = async (input: {
      readonly claudeRoot: string;
      readonly scope: ProjectIntelligenceScope;
      readonly sourceLabelPrefix: "Claude User" | "Claude Project";
    }): Promise<void> => {
      for (const agentPath of await listTopLevelMarkdownFiles(
        path.join(input.claudeRoot, "agents"),
      )) {
        const surface = await buildMarkdownSurface({
          filePath: agentPath,
          owner: "claude",
          kind: "agent",
          scope: input.scope,
          activation: "on-agent-invoke",
          sourceLabel: `${input.sourceLabelPrefix} Agent`,
        });
        if (surface) {
          addSurface(surfaces, surface);
        }
      }

      for (const commandPath of await listTopLevelMarkdownFiles(
        path.join(input.claudeRoot, "commands"),
      )) {
        const triggerLabel = `/${basename(commandPath).replace(/\.md$/i, "")}`;
        const surface = await buildMarkdownSurface({
          filePath: commandPath,
          owner: "claude",
          kind: "command",
          scope: input.scope,
          activation: "on-command",
          sourceLabel: `${input.sourceLabelPrefix} Command`,
          triggerLabel,
        });
        if (surface) {
          addSurface(surfaces, surface);
        }
      }

      for (const skillPath of await findNamedFiles(
        path.join(input.claudeRoot, "skills"),
        "SKILL.md",
      )) {
        const surface = await buildMarkdownSurface({
          filePath: skillPath,
          owner: "claude",
          kind: "skill",
          scope: input.scope,
          activation: "on-skill-match",
          sourceLabel: `${input.sourceLabelPrefix} Skill`,
        });
        if (surface) {
          addSurface(surfaces, surface);
        }
      }

      for (const settingsPath of [
        path.join(input.claudeRoot, "settings.json"),
        path.join(input.claudeRoot, "settings.local.json"),
      ]) {
        const settingsStat = await statIfExists(settingsPath);
        if (!settingsStat?.isFile()) {
          continue;
        }

        const settingsSurfaces = await buildSettingsSurface({
          filePath: settingsPath,
          scope: input.scope,
          warnings,
        });
        if (!settingsSurfaces) {
          continue;
        }

        addSurface(surfaces, settingsSurfaces.settingsSurface);
        settingsSummaryByScope.set(input.scope, settingsSurfaces.settingsSurface.settingsSummary!);
        for (const hookSurface of settingsSurfaces.hookSurfaces) {
          addSurface(surfaces, hookSurface);
        }
        for (const pluginSurface of buildSettingsPluginSurfaces({
          settingsPath,
          scope: input.scope,
          derivedFrom: settingsSurfaces.settingsSurface.id,
          settingsSummary: settingsSurfaces.settingsSurface.settingsSummary!,
        })) {
          addSurface(surfaces, pluginSurface);
        }
      }
    };

    const addCodexSurfaces = async (input: {
      readonly codexRoot: string;
      readonly agentsRoot: string;
      readonly scope: ProjectIntelligenceScope;
      readonly instructionLabel: "Codex Global Instruction" | "Codex Project Instruction";
      readonly skillLabel: "Codex User Skill" | "Codex Project Skill";
      readonly agentsSkillLabel: ".agents User Skill" | ".agents Project Skill";
    }): Promise<void> => {
      const codexInstructionPath = path.join(input.codexRoot, "AGENTS.md");
      const codexInstructionStat = await statIfExists(codexInstructionPath);
      if (codexInstructionStat?.isFile()) {
        const surface = await buildMarkdownSurface({
          filePath: codexInstructionPath,
          owner: "codex",
          kind: "instruction",
          scope: input.scope,
          activation: "always-loaded",
          sourceLabel: input.instructionLabel,
        });
        if (surface) {
          addSurface(surfaces, surface);
        }
      }

      for (const skillPath of await findNamedFiles(
        path.join(input.codexRoot, "skills"),
        "SKILL.md",
      )) {
        const resolvedScope =
          skillPath.includes(`${path.sep}.system${path.sep}`) || skillPath.includes("/.system/")
            ? ("system" as const satisfies ProjectIntelligenceScope)
            : input.scope;
        const surface = await buildMarkdownSurface({
          filePath: skillPath,
          owner: "codex",
          kind: "skill",
          scope: resolvedScope,
          activation: "on-skill-match",
          sourceLabel: resolvedScope === "system" ? "Codex System Skill" : input.skillLabel,
        });
        if (surface) {
          addSurface(surfaces, surface);
        }
      }

      for (const skillPath of await findNamedFiles(
        path.join(input.agentsRoot, "skills"),
        "SKILL.md",
      )) {
        const surface = await buildMarkdownSurface({
          filePath: skillPath,
          owner: "codex",
          kind: "skill",
          scope: input.scope,
          activation: "on-skill-match",
          sourceLabel: input.agentsSkillLabel,
        });
        if (surface) {
          addSurface(surfaces, surface);
        }
      }
    };

    const addMissingUserRootWarning = async (rootPath: string, label: string): Promise<void> => {
      const rootStat = await statIfExists(rootPath);
      if (rootStat?.isDirectory()) {
        return;
      }
      warnings.push({
        id: `missing-root:${label}:${rootPath}`,
        message: `${label} root is unavailable. User-level intelligence may be incomplete.`,
        severity: "info",
        path: rootPath,
      });
    };

    await addProjectInstructionCandidates(normalizedProjectCwd, "base-project");
    await addClaudeSurfaces({
      claudeRoot: path.join(normalizedProjectCwd, ".claude"),
      scope: "base-project",
      sourceLabelPrefix: "Claude Project",
    });
    await addCodexSurfaces({
      codexRoot: path.join(normalizedProjectCwd, ".codex"),
      agentsRoot: path.join(normalizedProjectCwd, ".agents"),
      scope: "base-project",
      instructionLabel: "Codex Project Instruction",
      skillLabel: "Codex Project Skill",
      agentsSkillLabel: ".agents Project Skill",
    });

    if (normalizedEffectiveCwd && normalizedEffectiveCwd !== normalizedProjectCwd) {
      await addProjectInstructionCandidates(normalizedEffectiveCwd, "effective-project");
      await addClaudeSurfaces({
        claudeRoot: path.join(normalizedEffectiveCwd, ".claude"),
        scope: "effective-project",
        sourceLabelPrefix: "Claude Project",
      });
      await addCodexSurfaces({
        codexRoot: path.join(normalizedEffectiveCwd, ".codex"),
        agentsRoot: path.join(normalizedEffectiveCwd, ".agents"),
        scope: "effective-project",
        instructionLabel: "Codex Project Instruction",
        skillLabel: "Codex Project Skill",
        agentsSkillLabel: ".agents Project Skill",
      });
    }

    await addMissingUserRootWarning(claudeHome, "Claude");
    await addMissingUserRootWarning(codexHome, "Codex");
    await addMissingUserRootWarning(agentsHome, ".agents");

    await addClaudeSurfaces({
      claudeRoot: claudeHome,
      scope: "user",
      sourceLabelPrefix: "Claude User",
    });
    await addCodexSurfaces({
      codexRoot: codexHome,
      agentsRoot: agentsHome,
      scope: "user",
      instructionLabel: "Codex Global Instruction",
      skillLabel: "Codex User Skill",
      agentsSkillLabel: ".agents User Skill",
    });

    const memoryDirStat = await statIfExists(currentMemoryDir);
    if (memoryDirStat?.isDirectory()) {
      for (const memoryPath of await listTopLevelMarkdownFiles(currentMemoryDir)) {
        const surface = await buildMarkdownSurface({
          filePath: memoryPath,
          owner: "claude",
          kind: "memory",
          scope: "user",
          activation: "separate-memory",
          sourceLabel: "Claude Project Memory",
        });
        if (surface) {
          addSurface(surfaces, surface);
        }
      }
    }

    const providers = await runPromise(providerRegistry.getProviders);
    for (const provider of providers) {
      if (provider.enabled && !provider.installed) {
        warnings.push({
          id: `provider-install:${provider.provider}`,
          message: `${provider.provider} is not installed. Provider-discovered context may be unavailable.`,
          severity: "warning",
        });
      } else if (provider.status !== "ready" && provider.message) {
        warnings.push({
          id: `provider-status:${provider.provider}`,
          message: provider.message,
          severity: provider.status === "disabled" ? "info" : "warning",
        });
      }

      if (provider.provider === "codex") {
        for (const skill of provider.skills) {
          const skillDescription = skill.shortDescription?.trim() || skill.description?.trim();
          const content = formatVirtualSurfaceContent({
            label: skill.displayName?.trim() || skill.name,
            ...(skillDescription ? { description: skillDescription } : {}),
            triggerLabel: skill.name,
            sourceLabel: "Provider Discovery",
          });
          const skillScope = skill.scope?.trim().toLowerCase() === "system" ? "system" : "user";
          const discoveredSurface =
            skill.path.trim().length > 0
              ? await buildMarkdownSurface({
                  filePath: skill.path,
                  owner: "codex",
                  kind: "skill",
                  scope: skillScope,
                  activation: "on-skill-match",
                  sourceLabel: "Provider Discovery",
                  triggerLabel: skill.name,
                  ...(skillDescription ? { descriptionOverride: skillDescription } : {}),
                })
              : null;
          const promptExcerpt = toExcerpt(content);

          addSurface(
            surfaces,
            discoveredSurface
              ? { ...discoveredSurface, enabled: skill.enabled }
              : {
                  dedupeKey: `provider-skill:${provider.provider}:${skill.name}`,
                  id: surfaceIdFromTarget({
                    mode: "virtual",
                    contentType: "markdown",
                    kind: "skill",
                    content,
                  }),
                  owner: "codex",
                  kind: "skill",
                  label: skill.displayName?.trim() || skill.name,
                  path: `provider://codex/skill/${skill.name}`,
                  scope: skillScope,
                  activation: "on-skill-match",
                  enabled: skill.enabled,
                  ...(skillDescription ? { description: skillDescription } : {}),
                  triggerLabel: skill.name,
                  sourceLabel: "Provider Discovery",
                  ...(promptExcerpt ? { promptExcerpt } : {}),
                  lineCount: countNonEmptyLines(content),
                  approxTokenCount: approximateTokenCount(content),
                },
          );
        }
      }

      if (provider.provider === "claudeAgent") {
        for (const slashCommand of provider.slashCommands) {
          const slashCommandDescription = slashCommand.description?.trim();
          const content = formatVirtualSurfaceContent({
            label: slashCommand.name,
            ...(slashCommandDescription ? { description: slashCommandDescription } : {}),
            triggerLabel: `/${slashCommand.name}`,
            sourceLabel:
              typeof slashCommand.input?.hint === "string"
                ? `Input hint: ${slashCommand.input.hint}`
                : "Provider Discovery",
          });
          const promptExcerpt = toExcerpt(content);
          addSurface(surfaces, {
            dedupeKey: `provider-slash-command:${slashCommand.name}`,
            id: surfaceIdFromTarget({
              mode: "virtual",
              contentType: "markdown",
              kind: "slash-command",
              content,
            }),
            owner: "claude",
            kind: "slash-command",
            label: slashCommand.name,
            path: `provider://claudeAgent/slash-command/${slashCommand.name}`,
            scope: "user",
            activation: "on-command",
            enabled: true,
            ...(slashCommand.description ? { description: slashCommand.description } : {}),
            triggerLabel: `/${slashCommand.name}`,
            sourceLabel: "Provider Discovery",
            ...(promptExcerpt ? { promptExcerpt } : {}),
            lineCount: countNonEmptyLines(content),
            approxTokenCount: approximateTokenCount(content),
          });
        }
      }
    }

    const scopeSummaries: ProjectIntelligenceScopeSummary[] = [];
    const baseCodeStats = await collectCodeStats({ cwd: normalizedProjectCwd, git });
    scopeSummaries.push({
      kind: "base-project",
      cwd: normalizedProjectCwd,
      surfaceIds: [...surfaces.values()]
        .filter((surface) => surface.scope === "base-project")
        .map((surface) => surface.id),
      codeStats: baseCodeStats,
    });
    if (baseCodeStats.partial) {
      warnings.push({
        id: `code-stats:${normalizedProjectCwd}`,
        message:
          "Base project code stats are partial because the file set exceeded the scan limit.",
        severity: "info",
        path: normalizedProjectCwd,
      });
    }

    if (normalizedEffectiveCwd && normalizedEffectiveCwd !== normalizedProjectCwd) {
      const effectiveCodeStats = await collectCodeStats({ cwd: normalizedEffectiveCwd, git });
      scopeSummaries.push({
        kind: "effective-project",
        cwd: normalizedEffectiveCwd,
        surfaceIds: [...surfaces.values()]
          .filter((surface) => surface.scope === "effective-project")
          .map((surface) => surface.id),
        codeStats: effectiveCodeStats,
      });
      if (effectiveCodeStats.partial) {
        warnings.push({
          id: `code-stats:${normalizedEffectiveCwd}`,
          message:
            "Effective project code stats are partial because the file set exceeded the scan limit.",
          severity: "info",
          path: normalizedEffectiveCwd,
        });
      }
    }

    return {
      resolvedAt: new Date().toISOString(),
      viewMode: input.viewMode,
      projectCwd: normalizedProjectCwd,
      ...(normalizedEffectiveCwd ? { effectiveCwd: normalizedEffectiveCwd } : {}),
      surfaces: [...surfaces.values()].map(toSurfaceSummary).toSorted(sortSurfaces),
      scopeSummaries,
      providerRuntime: summarizeProviderRuntime(providers, settingsSummaryByScope),
      warnings,
    } satisfies ProjectGetIntelligenceResult;
  };

  const getIntelligence: ProjectIntelligenceResolverShape["getIntelligence"] = (input) =>
    Effect.tryPromise({
      try: () => collectIntelligence(input),
      catch: (cause) =>
        Schema.is(ProjectIntelligenceResolverError)(cause)
          ? cause
          : toResolverError(
              "projectIntelligence.getIntelligence",
              "Unable to resolve project intelligence.",
              cause,
            ),
    });

  const readSurface: ProjectIntelligenceResolverShape["readSurface"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const target = decodeSurfaceId(input.surfaceId);
        if (!target) {
          throw toResolverError(
            "projectIntelligence.readSurface.decode",
            "Project intelligence surface id is invalid.",
          );
        }

        if (target.mode === "virtual") {
          return {
            surfaceId: input.surfaceId,
            contentType: target.contentType,
            content: target.content,
            truncated: false,
            maxBytes: MAX_SURFACE_CONTENT_BYTES,
          } satisfies ProjectReadIntelligenceSurfaceResult;
        }

        const rawContent = await readTextIfExists(target.path);
        if (rawContent === null) {
          throw toResolverError(
            "projectIntelligence.readSurface.file",
            `Project intelligence file is unavailable: ${target.path}`,
          );
        }

        let content = rawContent;
        if (target.kind === "settings") {
          try {
            content = JSON.stringify(redactSettingsValue(JSON.parse(rawContent)), null, 2);
          } catch {
            content = rawContent;
          }
        }

        const bytes = Buffer.byteLength(content, "utf8");
        const truncated = bytes > MAX_SURFACE_CONTENT_BYTES;
        const finalContent = truncated
          ? Buffer.from(content, "utf8").subarray(0, MAX_SURFACE_CONTENT_BYTES).toString("utf8")
          : content;
        return {
          surfaceId: input.surfaceId,
          contentType: target.contentType,
          content: finalContent,
          truncated,
          maxBytes: MAX_SURFACE_CONTENT_BYTES,
          ...(truncated
            ? { warning: "Surface content exceeded the preview size limit and was truncated." }
            : {}),
        } satisfies ProjectReadIntelligenceSurfaceResult;
      },
      catch: (cause) =>
        Schema.is(ProjectIntelligenceResolverError)(cause)
          ? cause
          : toResolverError(
              "projectIntelligence.readSurface",
              "Unable to read project intelligence surface.",
              cause,
            ),
    });

  return {
    getIntelligence,
    readSurface,
  } satisfies ProjectIntelligenceResolverShape;
});

export const ProjectIntelligenceResolverLive = Layer.effect(
  ProjectIntelligenceResolver,
  makeProjectIntelligenceResolver,
);
