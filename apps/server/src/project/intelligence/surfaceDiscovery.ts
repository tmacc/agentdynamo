import * as OS from "node:os";
import type { Dirent } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import type {
  ProjectIntelligenceActivation,
  ProjectIntelligenceContentType,
  ProjectIntelligenceHealth,
  ProjectIntelligenceOwner,
  ProjectIntelligenceScope,
  ProjectIntelligenceSurfaceKind,
  ProjectIntelligenceSurfaceSummary,
  ProjectIntelligenceWarning,
  ProjectScript,
  ProjectWorktreeSetupProfile,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { approximateTokenCount, countNonEmptyLines } from "@t3tools/shared/codeStatsPolicy";

import { createProjectIntelligenceSurfaceId } from "./surfaceIds.ts";
import { redactJsonString } from "./settingsRedaction.ts";
import type { DiscoveredProjectIntelligenceSurface } from "./types.ts";

const EXCERPT_MAX_NON_EMPTY_LINES = 12;
const EXCERPT_MAX_CHARS = 700;
const MAX_DISCOVERY_FILES = 10_000;
const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const CLAUDE_PROVIDER = ProviderDriverKind.make("claudeAgent");

interface ProjectContext {
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly worktreeSetup?: ProjectWorktreeSetupProfile | null | undefined;
}

interface DiscoverProjectSurfacesInput {
  readonly projectCwd: string;
  readonly effectiveCwd?: string;
  readonly codexHome: string;
  readonly project?: ProjectContext | null;
  readonly warnings: ProjectIntelligenceWarning[];
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
    return (await fsPromises.readFile(targetPath, "utf8"))
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n");
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

function toExcerpt(content: string): string | undefined {
  const lines = content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const excerpt = lines
    .slice(0, EXCERPT_MAX_NON_EMPTY_LINES)
    .join("\n")
    .slice(0, EXCERPT_MAX_CHARS);
  return excerpt.trim().length > 0 ? excerpt : undefined;
}

function detectContentType(
  kind: ProjectIntelligenceSurfaceKind,
  filePath: string,
): ProjectIntelligenceContentType {
  if (kind === "settings") return "json";
  if (filePath.toLowerCase().endsWith(".md")) return "markdown";
  return "text";
}

function metadata(
  entries: ReadonlyArray<readonly [string, string | number | boolean | null | undefined]>,
): ProjectIntelligenceSurfaceSummary["metadata"] {
  return entries.flatMap(([label, value]) =>
    value === null || value === undefined || String(value).trim().length === 0
      ? []
      : [{ label, value: String(value) }],
  );
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
  if (!content.startsWith("---\n")) return { body: content, frontmatter: {} };
  const lines = content.split("\n");
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) return { body: content, frontmatter: {} };

  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, closingIndex)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (match?.[1]) {
      frontmatter[match[1]] = decodeQuotedValue(match[2] ?? "");
    }
  }
  return {
    body: lines.slice(closingIndex + 1).join("\n"),
    frontmatter,
  };
}

async function listTopLevelMarkdownFiles(rootPath: string): Promise<ReadonlyArray<string>> {
  const stat = await statIfExists(rootPath);
  if (!stat?.isDirectory()) return [];
  return (await listDirectoryEntries(rootPath))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => path.join(rootPath, entry.name));
}

async function findNamedFiles(
  rootPath: string,
  targetBasename: string,
): Promise<ReadonlyArray<string>> {
  const rootStat = await statIfExists(rootPath);
  if (!rootStat?.isDirectory()) return [];

  const results: string[] = [];
  const stack = [rootPath];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_DISCOVERY_FILES) {
    const currentPath = stack.pop()!;
    for (const entry of await listDirectoryEntries(currentPath)) {
      visited += 1;
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === targetBasename) {
        results.push(entryPath);
      }
      if (visited >= MAX_DISCOVERY_FILES) break;
    }
  }
  return results;
}

function normalizeProjectMemoryKey(cwd: string): string {
  return path
    .resolve(cwd)
    .replace(/[\\/:\s]+/g, "-")
    .replace(/-+/g, "-");
}

async function buildFileSurface(input: {
  readonly filePath: string;
  readonly owner: ProjectIntelligenceOwner;
  readonly provider?: ProjectIntelligenceSurfaceSummary["provider"];
  readonly kind: ProjectIntelligenceSurfaceKind;
  readonly scope: ProjectIntelligenceScope;
  readonly activation: ProjectIntelligenceActivation;
  readonly sourceLabel: string;
  readonly triggerLabel?: string;
  readonly description?: string;
  readonly health?: ProjectIntelligenceHealth;
}): Promise<DiscoveredProjectIntelligenceSurface | null> {
  const content = await readTextIfExists(input.filePath);
  if (content === null) return null;
  const realPath = await realPathOrSelf(input.filePath);
  const { body, frontmatter } = parseFrontmatter(content);
  const previewContent = input.kind === "settings" ? redactJsonString(content) : body || content;
  const label =
    frontmatter.name?.trim() ||
    frontmatter.displayName?.trim() ||
    path.basename(input.filePath).replace(/\.md$/i, "");
  const description =
    input.description ||
    frontmatter.description?.trim() ||
    frontmatter.shortDescription?.trim() ||
    undefined;
  const contentType = detectContentType(input.kind, input.filePath);
  const summary: ProjectIntelligenceSurfaceSummary = {
    id: createProjectIntelligenceSurfaceId([
      "file",
      input.owner,
      input.kind,
      input.scope,
      realPath,
    ]),
    owner: input.owner,
    ...(input.provider ? { provider: input.provider } : {}),
    kind: input.kind,
    label,
    path: input.filePath,
    openPath: input.filePath,
    scope: input.scope,
    activation: input.activation,
    enabled: true,
    health: input.health ?? "ok",
    ...(description ? { description } : {}),
    ...(input.triggerLabel ? { triggerLabel: input.triggerLabel } : {}),
    sourceLabel: input.sourceLabel,
    ...(toExcerpt(previewContent) ? { excerpt: toExcerpt(previewContent) } : {}),
    lineCount: countNonEmptyLines(previewContent),
    approxTokenCount: approximateTokenCount(previewContent),
    metadata: metadata([
      ["Source", input.sourceLabel],
      ["File", path.basename(input.filePath)],
      ...Object.entries(frontmatter).slice(0, 4),
    ]),
  };
  return {
    summary,
    readTarget: {
      mode: "file",
      path: realPath,
      kind: input.kind,
      contentType,
    },
  };
}

function buildVirtualSurface(input: {
  readonly owner: ProjectIntelligenceOwner;
  readonly provider?: ProjectIntelligenceSurfaceSummary["provider"];
  readonly kind: ProjectIntelligenceSurfaceKind;
  readonly label: string;
  readonly path: string;
  readonly scope: ProjectIntelligenceScope;
  readonly activation: ProjectIntelligenceActivation;
  readonly enabled: boolean;
  readonly content: string;
  readonly sourceLabel: string;
  readonly description?: string;
  readonly triggerLabel?: string;
  readonly metadata?: ProjectIntelligenceSurfaceSummary["metadata"];
}): DiscoveredProjectIntelligenceSurface {
  return {
    summary: {
      id: createProjectIntelligenceSurfaceId([
        "virtual",
        input.owner,
        input.kind,
        input.scope,
        input.path,
        input.label,
      ]),
      owner: input.owner,
      ...(input.provider ? { provider: input.provider } : {}),
      kind: input.kind,
      label: input.label,
      path: input.path,
      scope: input.scope,
      activation: input.activation,
      enabled: input.enabled,
      health: input.enabled ? "ok" : "info",
      ...(input.description ? { description: input.description } : {}),
      ...(input.triggerLabel ? { triggerLabel: input.triggerLabel } : {}),
      sourceLabel: input.sourceLabel,
      ...(toExcerpt(input.content) ? { excerpt: toExcerpt(input.content) } : {}),
      lineCount: countNonEmptyLines(input.content),
      approxTokenCount: approximateTokenCount(input.content),
      metadata: input.metadata ?? [],
    },
    readTarget: {
      mode: "virtual",
      contentType: "markdown",
      content: input.content,
    },
  };
}

function parseSettingsVirtualSurfaces(input: {
  readonly settingsPath: string;
  readonly content: string;
  readonly scope: ProjectIntelligenceScope;
  readonly warnings: ProjectIntelligenceWarning[];
}): ReadonlyArray<DiscoveredProjectIntelligenceSurface> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    input.warnings.push({
      id: `settings-parse:${input.settingsPath}`,
      severity: "warning",
      message: `Could not parse settings file ${path.basename(input.settingsPath)}.`,
      path: input.settingsPath,
    });
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  const surfaces: DiscoveredProjectIntelligenceSurface[] = [];
  const hooks = record.hooks;
  if (hooks && typeof hooks === "object") {
    for (const [eventName, eventValue] of Object.entries(hooks as Record<string, unknown>)) {
      const content = [
        `# ${eventName} hook`,
        "",
        `Configured in ${path.basename(input.settingsPath)}.`,
        "",
        "```json",
        JSON.stringify(eventValue, null, 2),
        "```",
      ].join("\n");
      surfaces.push(
        buildVirtualSurface({
          owner: CLAUDE_PROVIDER,
          provider: CLAUDE_PROVIDER,
          kind: "hook",
          label: `${eventName} hook`,
          path: `${input.settingsPath}#hook:${eventName}`,
          scope: input.scope,
          activation: "on-hook-event",
          enabled: true,
          sourceLabel: "Claude settings hook",
          triggerLabel: eventName,
          content,
          metadata: metadata([
            ["Event", eventName],
            ["Settings", path.basename(input.settingsPath)],
          ]),
        }),
      );
    }
  }

  const enabledPlugins =
    record.enabledPlugins && typeof record.enabledPlugins === "object"
      ? Object.entries(record.enabledPlugins as Record<string, unknown>)
          .filter(([, enabled]) => enabled === true)
          .map(([pluginId]) => pluginId)
      : [];
  for (const pluginId of enabledPlugins) {
    surfaces.push(
      buildVirtualSurface({
        owner: CLAUDE_PROVIDER,
        provider: CLAUDE_PROVIDER,
        kind: "plugin",
        label: pluginId,
        path: `plugin://claudeAgent/${pluginId}`,
        scope: input.scope,
        activation: "runtime-config",
        enabled: true,
        sourceLabel: "Claude settings plugin",
        content: [`# ${pluginId}`, "", `Enabled via ${path.basename(input.settingsPath)}.`].join(
          "\n",
        ),
      }),
    );
  }

  return surfaces;
}

async function addFileIfExists(
  surfaces: DiscoveredProjectIntelligenceSurface[],
  input: Parameters<typeof buildFileSurface>[0],
): Promise<void> {
  const stat = await statIfExists(input.filePath);
  if (!stat?.isFile()) return;
  const surface = await buildFileSurface(input);
  if (surface) surfaces.push(surface);
}

async function addProjectRootSurfaces(input: {
  readonly surfaces: DiscoveredProjectIntelligenceSurface[];
  readonly cwd: string;
  readonly scope: Extract<ProjectIntelligenceScope, "project" | "thread-workspace">;
  readonly warnings: ProjectIntelligenceWarning[];
}): Promise<void> {
  await addFileIfExists(input.surfaces, {
    filePath: path.join(input.cwd, "AGENTS.md"),
    owner: "shared",
    kind: "instruction",
    scope: input.scope,
    activation: "always-loaded",
    sourceLabel: "Project instruction",
  });
  await addFileIfExists(input.surfaces, {
    filePath: path.join(input.cwd, "CLAUDE.md"),
    owner: "shared",
    provider: CLAUDE_PROVIDER,
    kind: "instruction",
    scope: input.scope,
    activation: "always-loaded",
    sourceLabel: "Claude instruction",
  });
  await addFileIfExists(input.surfaces, {
    filePath: path.join(input.cwd, ".codex", "AGENTS.md"),
    owner: CODEX_PROVIDER,
    provider: CODEX_PROVIDER,
    kind: "instruction",
    scope: input.scope,
    activation: "always-loaded",
    sourceLabel: "Codex project instruction",
  });

  for (const skillPath of await findNamedFiles(
    path.join(input.cwd, ".codex", "skills"),
    "SKILL.md",
  )) {
    const surface = await buildFileSurface({
      filePath: skillPath,
      owner: CODEX_PROVIDER,
      provider: CODEX_PROVIDER,
      kind: "skill",
      scope: input.scope,
      activation: "on-skill-match",
      sourceLabel: "Codex project skill",
    });
    if (surface) input.surfaces.push(surface);
  }
  for (const skillPath of await findNamedFiles(
    path.join(input.cwd, ".agents", "skills"),
    "SKILL.md",
  )) {
    const surface = await buildFileSurface({
      filePath: skillPath,
      owner: CODEX_PROVIDER,
      provider: CODEX_PROVIDER,
      kind: "skill",
      scope: input.scope,
      activation: "on-skill-match",
      sourceLabel: ".agents project skill",
    });
    if (surface) input.surfaces.push(surface);
  }
  for (const agentPath of await listTopLevelMarkdownFiles(
    path.join(input.cwd, ".claude", "agents"),
  )) {
    const surface = await buildFileSurface({
      filePath: agentPath,
      owner: CLAUDE_PROVIDER,
      provider: CLAUDE_PROVIDER,
      kind: "custom-agent",
      scope: input.scope,
      activation: "on-agent-invoke",
      sourceLabel: "Claude project agent",
    });
    if (surface) input.surfaces.push(surface);
  }
  for (const commandPath of await listTopLevelMarkdownFiles(
    path.join(input.cwd, ".claude", "commands"),
  )) {
    const surface = await buildFileSurface({
      filePath: commandPath,
      owner: CLAUDE_PROVIDER,
      provider: CLAUDE_PROVIDER,
      kind: "slash-command",
      scope: input.scope,
      activation: "on-command",
      sourceLabel: "Claude project command",
      triggerLabel: `/${path.basename(commandPath).replace(/\.md$/i, "")}`,
    });
    if (surface) input.surfaces.push(surface);
  }
  for (const settingsPath of [
    path.join(input.cwd, ".claude", "settings.json"),
    path.join(input.cwd, ".claude", "settings.local.json"),
  ]) {
    const settingsSurface = await buildFileSurface({
      filePath: settingsPath,
      owner: CLAUDE_PROVIDER,
      provider: CLAUDE_PROVIDER,
      kind: "settings",
      scope: input.scope,
      activation: "runtime-config",
      sourceLabel: "Claude project settings",
    });
    if (!settingsSurface) continue;
    input.surfaces.push(settingsSurface);
    const content = await readTextIfExists(settingsPath);
    if (content) {
      input.surfaces.push(
        ...parseSettingsVirtualSurfaces({
          settingsPath,
          content,
          scope: input.scope,
          warnings: input.warnings,
        }),
      );
    }
  }
}

async function addUserSurfaces(input: {
  readonly surfaces: DiscoveredProjectIntelligenceSurface[];
  readonly codexHome: string;
  readonly activeCwd: string;
  readonly warnings: ProjectIntelligenceWarning[];
}): Promise<void> {
  const claudeHome = path.join(OS.homedir(), ".claude");
  const agentsHome = path.join(OS.homedir(), ".agents");

  for (const [rootPath, label] of [
    [input.codexHome, "Codex"],
    [claudeHome, "Claude"],
    [agentsHome, ".agents"],
  ] as const) {
    const stat = await statIfExists(rootPath);
    if (!stat?.isDirectory()) {
      input.warnings.push({
        id: `missing-root:${label}:${rootPath}`,
        severity: "info",
        message: `${label} root is unavailable. User-level agent context may be incomplete.`,
        path: rootPath,
      });
    }
  }

  await addFileIfExists(input.surfaces, {
    filePath: path.join(input.codexHome, "AGENTS.md"),
    owner: CODEX_PROVIDER,
    provider: CODEX_PROVIDER,
    kind: "instruction",
    scope: "user",
    activation: "always-loaded",
    sourceLabel: "Codex global instruction",
  });

  for (const skillPath of await findNamedFiles(path.join(input.codexHome, "skills"), "SKILL.md")) {
    const resolvedScope = skillPath.includes(`${path.sep}.system${path.sep}`) ? "system" : "user";
    const surface = await buildFileSurface({
      filePath: skillPath,
      owner: CODEX_PROVIDER,
      provider: CODEX_PROVIDER,
      kind: "skill",
      scope: resolvedScope,
      activation: "on-skill-match",
      sourceLabel: resolvedScope === "system" ? "Codex system skill" : "Codex user skill",
    });
    if (surface) input.surfaces.push(surface);
  }

  for (const skillPath of await findNamedFiles(path.join(agentsHome, "skills"), "SKILL.md")) {
    const surface = await buildFileSurface({
      filePath: skillPath,
      owner: CODEX_PROVIDER,
      provider: CODEX_PROVIDER,
      kind: "skill",
      scope: "user",
      activation: "on-skill-match",
      sourceLabel: ".agents user skill",
    });
    if (surface) input.surfaces.push(surface);
  }

  for (const agentPath of await listTopLevelMarkdownFiles(path.join(claudeHome, "agents"))) {
    const surface = await buildFileSurface({
      filePath: agentPath,
      owner: CLAUDE_PROVIDER,
      provider: CLAUDE_PROVIDER,
      kind: "custom-agent",
      scope: "user",
      activation: "on-agent-invoke",
      sourceLabel: "Claude user agent",
    });
    if (surface) input.surfaces.push(surface);
  }

  for (const commandPath of await listTopLevelMarkdownFiles(path.join(claudeHome, "commands"))) {
    const surface = await buildFileSurface({
      filePath: commandPath,
      owner: CLAUDE_PROVIDER,
      provider: CLAUDE_PROVIDER,
      kind: "slash-command",
      scope: "user",
      activation: "on-command",
      sourceLabel: "Claude user command",
      triggerLabel: `/${path.basename(commandPath).replace(/\.md$/i, "")}`,
    });
    if (surface) input.surfaces.push(surface);
  }

  for (const settingsPath of [
    path.join(claudeHome, "settings.json"),
    path.join(claudeHome, "settings.local.json"),
  ]) {
    const settingsSurface = await buildFileSurface({
      filePath: settingsPath,
      owner: CLAUDE_PROVIDER,
      provider: CLAUDE_PROVIDER,
      kind: "settings",
      scope: "user",
      activation: "runtime-config",
      sourceLabel: "Claude user settings",
    });
    if (!settingsSurface) continue;
    input.surfaces.push(settingsSurface);
    const content = await readTextIfExists(settingsPath);
    if (content) {
      input.surfaces.push(
        ...parseSettingsVirtualSurfaces({
          settingsPath,
          content,
          scope: "user",
          warnings: input.warnings,
        }),
      );
    }
  }

  const memoryDir = path.join(
    claudeHome,
    "projects",
    normalizeProjectMemoryKey(input.activeCwd),
    "memory",
  );
  for (const memoryPath of await listTopLevelMarkdownFiles(memoryDir)) {
    const surface = await buildFileSurface({
      filePath: memoryPath,
      owner: CLAUDE_PROVIDER,
      provider: CLAUDE_PROVIDER,
      kind: "memory",
      scope: "user",
      activation: "separate-memory",
      sourceLabel: "Claude project memory",
    });
    if (surface) input.surfaces.push(surface);
  }
}

function addDynamoRuntimeSurfaces(
  surfaces: DiscoveredProjectIntelligenceSurface[],
  project: ProjectContext | null | undefined,
): void {
  for (const script of project?.scripts ?? []) {
    surfaces.push(
      buildVirtualSurface({
        owner: "dynamo",
        kind: "project-script",
        label: script.name,
        path: `dynamo://project-script/${script.id}`,
        scope: "project",
        activation: script.runOnWorktreeCreate ? "runtime-config" : "manual",
        enabled: true,
        sourceLabel: "Dynamo project script",
        ...(script.runOnWorktreeCreate ? { triggerLabel: "worktree create" } : {}),
        content: [`# ${script.name}`, "", "```sh", script.command, "```"].join("\n"),
        metadata: metadata([
          ["Icon", script.icon],
          ["Run on worktree create", script.runOnWorktreeCreate],
        ]),
      }),
    );
  }

  if (project?.worktreeSetup) {
    const profile = project.worktreeSetup;
    surfaces.push(
      buildVirtualSurface({
        owner: "dynamo",
        kind: "worktree-setup",
        label: "Worktree setup profile",
        path: "dynamo://worktree-setup",
        scope: "project",
        activation: "runtime-config",
        enabled: profile.status === "configured",
        sourceLabel: "Dynamo worktree setup",
        description: "Dynamo-managed setup profile for new worktrees.",
        content: [
          "# Worktree setup profile",
          "",
          "```json",
          JSON.stringify(profile, null, 2),
          "```",
        ].join("\n"),
        metadata: metadata([
          ["Package manager", profile.packageManager],
          ["Framework", profile.framework],
          ["Auto-run", profile.autoRunSetupOnWorktreeCreate],
          ["Ports", profile.portCount],
        ]),
      }),
    );
  }
}

export async function discoverProjectSurfaces(
  input: DiscoverProjectSurfacesInput,
): Promise<ReadonlyArray<DiscoveredProjectIntelligenceSurface>> {
  const surfaces: DiscoveredProjectIntelligenceSurface[] = [];
  await addProjectRootSurfaces({
    surfaces,
    cwd: input.projectCwd,
    scope: "project",
    warnings: input.warnings,
  });
  if (input.effectiveCwd && input.effectiveCwd !== input.projectCwd) {
    await addProjectRootSurfaces({
      surfaces,
      cwd: input.effectiveCwd,
      scope: "thread-workspace",
      warnings: input.warnings,
    });
  }
  await addUserSurfaces({
    surfaces,
    codexHome: input.codexHome,
    activeCwd: input.effectiveCwd ?? input.projectCwd,
    warnings: input.warnings,
  });
  addDynamoRuntimeSurfaces(surfaces, input.project);
  return surfaces;
}
