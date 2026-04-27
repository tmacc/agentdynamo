export const IGNORED_WORKSPACE_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

export function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

export function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

export function basenameOf(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return input;
  }
  return input.slice(separatorIndex + 1);
}

export function isPathInIgnoredWorkspaceDirectory(relativePath: string): boolean {
  const firstSegment = relativePath.split("/")[0];
  if (!firstSegment) return false;
  return IGNORED_WORKSPACE_DIRECTORY_NAMES.has(firstSegment);
}

export function directoryAncestorsOf(relativePath: string): string[] {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return [];

  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

export function isSafeWorkspaceRelativePath(relativePath: string): boolean {
  return (
    !relativePath.includes("\0") &&
    !relativePath.startsWith("/") &&
    relativePath !== ".." &&
    !relativePath.startsWith("../") &&
    !relativePath.includes("/../") &&
    !relativePath.endsWith("/..")
  );
}
