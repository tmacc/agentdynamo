import type { ServerProvider } from "@t3tools/contracts";

export function formatProviderAuthDetails(provider: ServerProvider | undefined): string | null {
  if (!provider || provider.auth.status !== "authenticated") {
    return null;
  }

  const parts = [provider.auth.label ?? provider.auth.type, provider.auth.accountLabel].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}
