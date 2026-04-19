"use client";

import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * `Section` is a tiny labelled-section primitive used in sheets, dialogs, and
 * settings forms. It pairs an uppercase label with an optional right-aligned
 * action (icon button, link, etc.) above the section body.
 *
 * Why not `Field`? `Field` from `ui/field.tsx` is built around an `<input>` +
 * stacked label + description, with no slot for a control on the right of the
 * label. `Section` is the looser sibling for arbitrary content.
 *
 * Usage:
 *   <Section>
 *     <SectionHeader>
 *       <SectionLabel>Description</SectionLabel>
 *       <SectionAction>...optional control...</SectionAction>
 *     </SectionHeader>
 *     <SectionBody>...content...</SectionBody>
 *   </Section>
 */
function Section({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} data-slot="section" {...props} />;
}

function SectionHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center justify-between gap-2", className)}
      data-slot="section-header"
      {...props}
    />
  );
}

function SectionLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("font-medium text-muted-foreground text-xs uppercase tracking-wide", className)}
      data-slot="section-label"
      {...props}
    />
  );
}

function SectionAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-1", className)}
      data-slot="section-action"
      {...props}
    />
  );
}

function SectionBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn(className)} data-slot="section-body" {...props} />;
}

export { Section, SectionHeader, SectionLabel, SectionAction, SectionBody };
