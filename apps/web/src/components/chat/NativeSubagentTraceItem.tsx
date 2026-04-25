import type { OrchestrationNativeSubagentTraceItem } from "@t3tools/contracts";
import { AlertCircleIcon, BotIcon, CheckCircle2Icon, HammerIcon, UserIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

export const NativeSubagentTraceItemView = memo(function NativeSubagentTraceItemView({
  item,
}: {
  item: OrchestrationNativeSubagentTraceItem;
}) {
  const Icon =
    item.kind === "user_message"
      ? UserIcon
      : item.kind === "assistant_message" || item.kind === "reasoning_summary"
        ? BotIcon
        : item.kind === "error"
          ? AlertCircleIcon
          : item.status === "completed"
            ? CheckCircle2Icon
            : HammerIcon;
  const title =
    item.title ??
    (item.kind === "reasoning_summary"
      ? "Reasoning summary"
      : item.kind === "assistant_message"
        ? "Assistant"
        : item.kind === "user_message"
          ? "Prompt"
          : item.kind.replaceAll("_", " "));
  const body = item.text ?? item.outputSummary ?? item.detail ?? item.inputSummary;

  return (
    <div
      className={cn(
        "rounded-md border border-border/60 bg-background/45 p-2 text-xs",
        item.kind === "error" && "border-destructive/35 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
        <div className="min-w-0 flex-1 truncate font-medium text-foreground/85">{title}</div>
        <div
          className={cn(
            "shrink-0 text-[10px] uppercase",
            item.status === "failed" ? "text-destructive" : "text-muted-foreground/60",
          )}
        >
          {item.status}
        </div>
      </div>
      {item.toolName ? (
        <div className="mt-1 truncate text-[11px] text-muted-foreground/65">{item.toolName}</div>
      ) : null}
      {body ? (
        <div className="mt-1 whitespace-pre-wrap break-words text-muted-foreground/90">{body}</div>
      ) : null}
    </div>
  );
});
