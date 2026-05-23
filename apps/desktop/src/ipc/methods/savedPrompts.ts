import {
  DesktopStorageMutationResultSchema,
  DesktopStorageReadResultSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopSavedPrompts from "../../settings/DesktopSavedPrompts.ts";
import * as IpcChannels from "../channels.ts";
import { makeSyncIpcMethod, makeSyncIpcMethodWithPayload } from "../DesktopIpc.ts";

export const getSavedPromptStorage = makeSyncIpcMethod({
  channel: IpcChannels.GET_SAVED_PROMPT_STORAGE_CHANNEL,
  result: DesktopStorageReadResultSchema,
  handler: Effect.fn("desktop.ipc.savedPrompts.get")(function* () {
    const savedPrompts = yield* DesktopSavedPrompts.DesktopSavedPrompts;
    return yield* savedPrompts.read;
  }),
});

export const setSavedPromptStorage = makeSyncIpcMethodWithPayload({
  channel: IpcChannels.SET_SAVED_PROMPT_STORAGE_CHANNEL,
  payload: Schema.String,
  result: DesktopStorageMutationResultSchema,
  handler: Effect.fn("desktop.ipc.savedPrompts.set")(function* (value) {
    const savedPrompts = yield* DesktopSavedPrompts.DesktopSavedPrompts;
    return yield* savedPrompts.write(value);
  }),
});

export const removeSavedPromptStorage = makeSyncIpcMethod({
  channel: IpcChannels.REMOVE_SAVED_PROMPT_STORAGE_CHANNEL,
  result: DesktopStorageMutationResultSchema,
  handler: Effect.fn("desktop.ipc.savedPrompts.remove")(function* () {
    const savedPrompts = yield* DesktopSavedPrompts.DesktopSavedPrompts;
    return yield* savedPrompts.remove;
  }),
});
