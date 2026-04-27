export interface FileBrowserRouteSearch {
  files?: "1";
  filePath?: string;
}

export function parseFileBrowserRouteSearch(
  search: Record<string, unknown>,
): FileBrowserRouteSearch {
  const files = search.files === "1" ? "1" : undefined;
  const filePath =
    typeof search.filePath === "string" && search.filePath.length > 0 ? search.filePath : undefined;
  return {
    ...(files ? { files } : {}),
    ...(filePath ? { filePath } : {}),
  };
}

export function stripFileBrowserRouteSearchParams(
  search: Record<string, unknown>,
): Record<string, unknown> {
  const { files: _files, filePath: _filePath, ...rest } = search;
  return rest;
}
