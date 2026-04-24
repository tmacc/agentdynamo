export const APP_BASE_NAME = "Dynamo";
export const APP_AUTHOR = "Dynamo";
export const APP_SLUG = "dynamo";
export const APP_PROTOCOL = "dynamo";
export const APP_BUNDLE_ID = "com.agentdynamo.dynamo";
export const APP_HOME_DIR_NAME = ".dynamo";
export const APP_HOME_ENV_VAR = "DYNAMO_HOME";
export const LEGACY_APP_HOME_ENV_VAR = "T3CODE_HOME";
export const APP_COMMIT_HASH_FIELD = "dynamoCommitHash";

export function resolveDesktopBundleId(isDevelopment: boolean): string {
  return isDevelopment ? `${APP_BUNDLE_ID}.dev` : APP_BUNDLE_ID;
}

export function resolveDesktopLinuxDesktopEntryName(isDevelopment: boolean): string {
  return isDevelopment ? `${APP_SLUG}-dev.desktop` : `${APP_SLUG}.desktop`;
}

export function resolveDesktopLinuxWmClass(isDevelopment: boolean): string {
  return isDevelopment ? `${APP_SLUG}-dev` : APP_SLUG;
}

export function resolveDesktopUserDataDirName(isDevelopment: boolean): string {
  return isDevelopment ? `${APP_SLUG}-dev` : APP_SLUG;
}
