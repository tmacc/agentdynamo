import type {
  ProviderToolchainCheckInput,
  ProviderToolchainError,
  ProviderToolchainSnapshot,
  ProviderToolchainStatus,
  ProviderToolchainUpdateInput,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

export interface ProviderToolchainShape {
  readonly getStatuses: Effect.Effect<ReadonlyArray<ProviderToolchainStatus>>;
  readonly check: (input: ProviderToolchainCheckInput) => Effect.Effect<ProviderToolchainSnapshot>;
  readonly update: (
    input: ProviderToolchainUpdateInput,
  ) => Effect.Effect<ProviderToolchainStatus, ProviderToolchainError>;
  readonly streamChanges: Stream.Stream<ReadonlyArray<ProviderToolchainStatus>>;
}

export class ProviderToolchain extends Context.Service<ProviderToolchain, ProviderToolchainShape>()(
  "t3/provider/Services/ProviderToolchain",
) {}
