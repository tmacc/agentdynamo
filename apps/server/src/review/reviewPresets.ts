import type {
  ReviewPreset,
  ReviewPromptFlavor,
  ReviewStepKind,
  ReviewTier,
  ServerProvider,
} from "@t3tools/contracts";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";

import { enabledWorkerProviders } from "../team/teamModelSelection.ts";

function providerModels(
  providers: ReadonlyArray<ServerProvider>,
  providerKind: "claudeAgent" | "codex",
): ServerProvider["models"] {
  return (
    enabledWorkerProviders(providers).find(
      (provider) => provider.driver === providerKind && provider.auth.status === "authenticated",
    )?.models ?? []
  );
}

function reviewProvider(
  providers: ReadonlyArray<ServerProvider>,
  providerKind: "claudeAgent" | "codex",
): ServerProvider | undefined {
  return enabledWorkerProviders(providers).find(
    (provider) => provider.driver === providerKind && provider.auth.status === "authenticated",
  );
}

function resolvePreferredModel(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly provider: "claudeAgent" | "codex";
  readonly preferred: ReadonlyArray<string>;
}): string {
  const models = providerModels(input.providers, input.provider);
  for (const preferred of input.preferred) {
    const resolved = resolveSelectableModel(
      ProviderDriverKind.make(input.provider),
      preferred,
      models,
    );
    if (resolved) return resolved;
  }
  const firstNonCustom = models.find((model) => !model.isCustom);
  return firstNonCustom?.slug ?? models[0]?.slug ?? input.preferred[0] ?? "default";
}

function selection(
  providers: ReadonlyArray<ServerProvider>,
  provider: "claudeAgent" | "codex",
  preferred: ReadonlyArray<string>,
): ReviewPreset["verifier"] {
  const model = resolvePreferredModel({ providers, provider, preferred });
  const providerSnapshot = reviewProvider(providers, provider);
  const instanceId = providerSnapshot?.instanceId ?? ProviderInstanceId.make(provider);
  if (provider === "claudeAgent") {
    return {
      provider,
      instanceId,
      model,
      options: [
        { id: "thinking", value: true },
        { id: "effort", value: "high" },
      ],
    } satisfies ReviewPreset["verifier"];
  }
  return {
    provider,
    instanceId,
    model,
    options: [{ id: "reasoningEffort", value: "high" }],
  } satisfies ReviewPreset["verifier"];
}

function step(input: {
  readonly kind: ReviewStepKind;
  readonly provider: "claudeAgent" | "codex";
  readonly primary: ReviewPreset["verifier"];
  readonly title: string;
  readonly roleLabel: string;
}) {
  const promptFlavor: ReviewPromptFlavor =
    input.provider === "claudeAgent" ? "anthropic" : "openai";
  return {
    kind: input.kind,
    title: input.title,
    roleLabel: input.roleLabel,
    promptFlavor,
    primary: input.primary,
  };
}

export function pickReviewPreset(
  tier: ReviewTier,
  providers: ReadonlyArray<ServerProvider>,
): ReviewPreset | null {
  if (tier === "none") return null;

  const claudeBugHunter = selection(providers, "claudeAgent", [
    "opus-4.7",
    "opus",
    "opus-4.6",
    "sonnet-4.6",
  ]);
  const claudeVerifier = selection(providers, "claudeAgent", ["sonnet-4.6", "sonnet", "opus"]);
  const codexBugHunter = selection(providers, "codex", ["gpt-5.4", "gpt-5-codex"]);
  const codexVerifier = selection(providers, "codex", [
    "gpt-5.4-mini",
    "gpt-5.3-codex-spark",
    "gpt-5.4",
  ]);

  if (tier === "multi") {
    return {
      tier,
      label: `Multi-provider review - ${claudeBugHunter.model} + ${codexVerifier.model}`,
      verifier: codexVerifier,
      steps: [
        step({
          kind: "map",
          provider: "codex",
          primary: codexBugHunter,
          title: "Review map",
          roleLabel: "Review map",
        }),
        step({
          kind: "bug-hunt",
          provider: "claudeAgent",
          primary: claudeBugHunter,
          title: "Bug hunt",
          roleLabel: "Bug hunt",
        }),
        step({
          kind: "style",
          provider: "claudeAgent",
          primary: claudeVerifier,
          title: "Repo conventions",
          roleLabel: "CLAUDE.md check",
        }),
      ],
    };
  }

  if (tier === "single-claude") {
    return {
      tier,
      label: `Single-provider review - ${claudeBugHunter.model} to ${claudeVerifier.model}`,
      verifier: claudeVerifier,
      steps: [
        step({
          kind: "map",
          provider: "claudeAgent",
          primary: claudeVerifier,
          title: "Review map",
          roleLabel: "Review map",
        }),
        step({
          kind: "bug-hunt",
          provider: "claudeAgent",
          primary: claudeBugHunter,
          title: "Bug hunt",
          roleLabel: "Bug hunt",
        }),
        step({
          kind: "style",
          provider: "claudeAgent",
          primary: claudeVerifier,
          title: "Repo conventions",
          roleLabel: "CLAUDE.md check",
        }),
      ],
    };
  }

  return {
    tier,
    label: `Single-provider review - ${codexBugHunter.model} to ${codexVerifier.model}`,
    verifier: codexVerifier,
    steps: [
      step({
        kind: "map",
        provider: "codex",
        primary: codexVerifier,
        title: "Review map",
        roleLabel: "Review map",
      }),
      step({
        kind: "bug-hunt",
        provider: "codex",
        primary: codexBugHunter,
        title: "Bug hunt",
        roleLabel: "Bug hunt",
      }),
      step({
        kind: "style",
        provider: "codex",
        primary: codexVerifier,
        title: "Repo conventions",
        roleLabel: "CLAUDE.md check",
      }),
    ],
  };
}
