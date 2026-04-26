const SECRET_KEY_PATTERN =
  /(secret|token|password|api[_-]?key|credential|private[_-]?key|access[_-]?key)/i;
const BOOLEAN_LIKE_PATTERN = /^(true|false|0|1)$/i;

function isSecretLikeKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactSettingsValue(value: unknown, keyPath: ReadonlyArray<string> = []): unknown {
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

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
      if (isSecretLikeKey(key)) {
        return [key, "[redacted]"];
      }
      return [key, redactSettingsValue(entryValue, [...keyPath, key])];
    }),
  );
}

export function redactJsonString(content: string): string {
  try {
    return JSON.stringify(redactSettingsValue(JSON.parse(content)), null, 2);
  } catch {
    return content;
  }
}
