import { Context } from "effect";
import type { Effect } from "effect";

export interface ProviderSessionRecoveryReconcilerShape {
  readonly reconcileNow: () => Effect.Effect<void>;
}

export class ProviderSessionRecoveryReconciler extends Context.Service<
  ProviderSessionRecoveryReconciler,
  ProviderSessionRecoveryReconcilerShape
>()("t3/provider/Services/ProviderSessionRecoveryReconciler") {}
