import type { ComponentPropsWithoutRef } from "react";

import { cn } from "~/lib/utils";

export function Section({ className, ...props }: ComponentPropsWithoutRef<"section">) {
  return <section className={cn("space-y-2", className)} {...props} />;
}

export function SectionHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex items-center justify-between gap-3", className)} {...props} />;
}

export function SectionLabel({ className, ...props }: ComponentPropsWithoutRef<"h3">) {
  return (
    <h3
      className={cn("text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

export function SectionAction({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("shrink-0", className)} {...props} />;
}

export function SectionBody({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("space-y-2", className)} {...props} />;
}
