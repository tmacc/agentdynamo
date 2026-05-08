import { EDITORS, EditorId, EnvironmentId, LocalApi } from "@t3tools/contracts";
import { getSavedEnvironmentDesktopTarget } from "./environments/runtime/catalog";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { useMemo } from "react";
import { ensureLocalApi } from "./localApi";
import { getSavedEnvironmentRecord } from "./environments/runtime";

const LAST_EDITOR_KEY = "dynamo:last-editor";

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const effectiveEditor = useMemo(() => {
    if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
    return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
  }, [lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const availableEditorIds = new Set(availableEditors);
  const stored = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  if (stored && availableEditorIds.has(stored)) return stored;
  const editor = EDITORS.find((editor) => availableEditorIds.has(editor.id))?.id ?? null;
  if (editor) setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
  return editor ?? null;
}

export async function openInPreferredEditor(api: LocalApi, targetPath: string): Promise<EditorId> {
  const { availableEditors } = await api.server.getConfig();
  const editor = resolveAndPersistPreferredEditor(availableEditors);
  if (!editor) throw new Error("No available editors found.");
  await api.shell.openInEditor(targetPath, editor);
  return editor;
}

export async function openEnvironmentPathInPreferredEditor(input: {
  environmentId: EnvironmentId;
  targetPath: string;
}): Promise<EditorId> {
  const record = getSavedEnvironmentRecord(input.environmentId);
  const desktopTarget = record ? getSavedEnvironmentDesktopTarget(record) : null;
  if (desktopTarget?.kind === "wsl") {
    const bridge = window.desktopBridge;
    if (!bridge?.openWslPathInEditor) {
      throw new Error("WSL editor bridge is only available in the Windows desktop app.");
    }
    const editor = resolveAndPersistPreferredEditor(["vscode", "vscode-insiders"]) ?? "vscode";
    await bridge.openWslPathInEditor({
      target: desktopTarget.wsl,
      path: input.targetPath,
      editor: editor === "vscode-insiders" ? "vscode-insiders" : "vscode",
    });
    return editor === "vscode-insiders" ? "vscode-insiders" : "vscode";
  }
  return await openInPreferredEditor(ensureLocalApi(), input.targetPath);
}
