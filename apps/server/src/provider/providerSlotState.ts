import type { ProviderSessionSlotState } from "../persistence/Services/ProviderSessionRuntime.ts";
import type { ProviderRuntimeBinding } from "./Services/ProviderSessionDirectory.ts";

export function isResumableProviderSlotState(
  slotState: ProviderSessionSlotState | undefined,
): boolean {
  return (
    slotState === undefined ||
    slotState === "active" ||
    slotState === "parked" ||
    slotState === "expired"
  );
}

export function isResumableProviderBinding(
  binding: Pick<ProviderRuntimeBinding, "slotState"> | null | undefined,
): boolean {
  return (
    binding !== undefined && binding !== null && isResumableProviderSlotState(binding.slotState)
  );
}
