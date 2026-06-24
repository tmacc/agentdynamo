import {
  EnvironmentId,
  PersistedSavedEnvironmentRecordSchema,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopSavedEnvironments from "../../settings/DesktopSavedEnvironments.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getSavedEnvironmentRegistry = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(PersistedSavedEnvironmentRecordSchema),
  handler: Effect.fn("desktop.ipc.savedEnvironments.getRegistry")(function* () {
    const savedEnvironments = yield* DesktopSavedEnvironments.DesktopSavedEnvironments;
    return yield* savedEnvironments.getRegistry;
  }),
});

export const setSavedEnvironmentRegistry = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL,
  payload: Schema.Array(PersistedSavedEnvironmentRecordSchema),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.savedEnvironments.setRegistry")(function* (
    records: readonly PersistedSavedEnvironmentRecord[],
  ) {
    const savedEnvironments = yield* DesktopSavedEnvironments.DesktopSavedEnvironments;
    yield* savedEnvironments.setRegistry(records);
  }),
});

export const getSavedEnvironmentSecret = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_SAVED_ENVIRONMENT_SECRET_CHANNEL,
  payload: EnvironmentId,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.savedEnvironments.getSecret")(function* (environmentId) {
    const savedEnvironments = yield* DesktopSavedEnvironments.DesktopSavedEnvironments;
    return Option.getOrNull(yield* savedEnvironments.getSecret(environmentId));
  }),
});

export const setSavedEnvironmentSecret = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_SAVED_ENVIRONMENT_SECRET_CHANNEL,
  payload: Schema.Struct({
    environmentId: EnvironmentId,
    secret: Schema.String,
  }),
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.savedEnvironments.setSecret")(function* (input) {
    const savedEnvironments = yield* DesktopSavedEnvironments.DesktopSavedEnvironments;
    yield* savedEnvironments.setSecret({
      environmentId: input.environmentId,
      secret: input.secret,
    });
    return true;
  }),
});

export const removeSavedEnvironmentSecret = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL,
  payload: EnvironmentId,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.savedEnvironments.removeSecret")(function* (environmentId) {
    const savedEnvironments = yield* DesktopSavedEnvironments.DesktopSavedEnvironments;
    yield* savedEnvironments.removeSecret(environmentId);
  }),
});
