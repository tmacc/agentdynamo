import type { ProjectIntelligenceWarning } from "@t3tools/contracts";
import { AlertTriangleIcon, InfoIcon } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Card, CardContent } from "../ui/card";

export function ProjectIntelligenceWarningsSection(props: {
  readonly warnings: ReadonlyArray<ProjectIntelligenceWarning>;
}) {
  if (props.warnings.length === 0) {
    return (
      <Empty className="min-h-52 rounded-2xl border border-dashed border-border/70 bg-muted/18">
        <EmptyHeader>
          <EmptyTitle>No warnings</EmptyTitle>
          <EmptyDescription>
            Discovery completed without any partial or missing-context warnings.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-2">
      {props.warnings.map((warning) => {
        const Icon = warning.severity === "warning" ? AlertTriangleIcon : InfoIcon;
        return (
          <Card key={warning.id}>
            <CardContent className="flex items-start gap-3 p-4">
              <div
                className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
                  warning.severity === "warning" ? "bg-warning/10" : "bg-muted/40"
                }`}
              >
                <Icon
                  className={
                    warning.severity === "warning"
                      ? "size-3.5 text-warning-foreground"
                      : "size-3.5 text-muted-foreground"
                  }
                />
              </div>
              <div className="min-w-0 space-y-0.5 pt-0.5">
                <div className="text-[13px] font-medium text-foreground">{warning.message}</div>
                {warning.path ? (
                  <div className="break-all font-mono text-[11px] text-muted-foreground/70">
                    {warning.path}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
