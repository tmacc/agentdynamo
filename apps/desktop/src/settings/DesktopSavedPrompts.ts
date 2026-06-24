// oxlint-disable t3code/namespace-node-imports
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
import * as FS from "node:fs";
import * as NodePath from "node:path";

import type { DesktopStorageMutationResult, DesktopStorageReadResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export interface DesktopSavedPromptsShape {
  readonly read: Effect.Effect<DesktopStorageReadResult>;
  readonly write: (value: string) => Effect.Effect<DesktopStorageMutationResult>;
  readonly remove: Effect.Effect<DesktopStorageMutationResult>;
}

export class DesktopSavedPrompts extends Context.Service<
  DesktopSavedPrompts,
  DesktopSavedPromptsShape
>()("@t3tools/desktop/settings/DesktopSavedPrompts") {}

function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeCorruptBackupPath(filePath: string): string {
  const directory = NodePath.dirname(filePath);
  const extension = NodePath.extname(filePath) || ".json";
  const basename = NodePath.basename(filePath, extension);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return NodePath.join(directory, `${basename}.corrupt-${timestamp}${extension}`);
}

function writeTextFile(filePath: string, value: string): void {
  const directory = NodePath.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, value, "utf8");
  FS.renameSync(tempPath, filePath);
}

function readSavedPromptStorageWithRecovery(storagePath: string): DesktopStorageReadResult {
  let raw: string;
  try {
    raw = FS.readFileSync(storagePath, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "error", message: errorMessage(error) };
  }

  try {
    JSON.parse(raw);
    return { status: "ok", value: raw };
  } catch (error) {
    const message = errorMessage(error);
    const backupPath = makeCorruptBackupPath(storagePath);
    try {
      FS.renameSync(storagePath, backupPath);
      return { status: "corrupt", message, backupPath };
    } catch {
      return { status: "corrupt", message };
    }
  }
}

function preserveExistingCorruptSavedPromptStorageBeforeWrite(storagePath: string): void {
  let raw: string;
  try {
    raw = FS.readFileSync(storagePath, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  try {
    JSON.parse(raw);
  } catch {
    const backupPath = makeCorruptBackupPath(storagePath);
    try {
      FS.renameSync(storagePath, backupPath);
    } catch (renameError) {
      throw new Error(
        `Failed to preserve corrupt saved prompt storage before write: ${errorMessage(
          renameError,
        )}`,
        { cause: renameError },
      );
    }
  }
}

function writeSavedPromptStorage(storagePath: string, value: string): DesktopStorageMutationResult {
  try {
    JSON.parse(value);
    preserveExistingCorruptSavedPromptStorageBeforeWrite(storagePath);
    writeTextFile(storagePath, value);
    return { status: "ok" };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

function removeSavedPromptStorage(storagePath: string): DesktopStorageMutationResult {
  try {
    FS.rmSync(storagePath, { force: true });
    return { status: "ok" };
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return { status: "ok" };
    }
    return { status: "error", message: errorMessage(error) };
  }
}

export const layer = Layer.effect(
  DesktopSavedPrompts,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const storagePath = environment.savedPromptsPath;

    return DesktopSavedPrompts.of({
      read: Effect.sync(() => readSavedPromptStorageWithRecovery(storagePath)).pipe(
        Effect.withSpan("desktop.savedPrompts.read"),
      ),
      write: (value) =>
        Effect.sync(() => writeSavedPromptStorage(storagePath, value)).pipe(
          Effect.withSpan("desktop.savedPrompts.write"),
        ),
      remove: Effect.sync(() => removeSavedPromptStorage(storagePath)).pipe(
        Effect.withSpan("desktop.savedPrompts.remove"),
      ),
    });
  }),
);
