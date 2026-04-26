import type { ProjectIntelligenceHealth } from "@t3tools/contracts";

import { HEALTH_DOT_CLASS, HEALTH_LABELS } from "../../projectIntelligencePresentation";
import { cn } from "~/lib/utils";

export function ProjectIntelligenceHealthDot(props: {
  health: ProjectIntelligenceHealth;
  className?: string;
  size?: "xs" | "sm" | "md";
}) {
  const sizeClass = props.size === "md" ? "size-2.5" : props.size === "xs" ? "size-1.5" : "size-2";
  return (
    <span
      aria-hidden="true"
      title={HEALTH_LABELS[props.health]}
      className={cn(
        "inline-block shrink-0 rounded-full",
        sizeClass,
        HEALTH_DOT_CLASS[props.health],
        props.className,
      )}
    />
  );
}
