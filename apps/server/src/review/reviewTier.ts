import type { ReviewTier, ServerProvider } from "@t3tools/contracts";

import { enabledWorkerProviders } from "../team/teamModelSelection.ts";

function isAuthenticatedReviewProvider(provider: ServerProvider): boolean {
  return (
    (provider.driver === "claudeAgent" || provider.driver === "codex") &&
    provider.auth.status === "authenticated"
  );
}

export function detectReviewTier(providers: ReadonlyArray<ServerProvider>): ReviewTier {
  const enabled = enabledWorkerProviders(providers).filter(isAuthenticatedReviewProvider);
  const hasClaude = enabled.some((provider) => provider.driver === "claudeAgent");
  const hasCodex = enabled.some((provider) => provider.driver === "codex");

  if (hasClaude && hasCodex) return "multi";
  if (hasClaude) return "single-claude";
  if (hasCodex) return "single-codex";
  return "none";
}
