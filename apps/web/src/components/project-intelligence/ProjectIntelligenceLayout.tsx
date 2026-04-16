import type { ProjectIntelligenceSectionId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import type { ProjectIntelligenceNavItem } from "./ProjectIntelligenceNav";
import { ProjectIntelligenceNav } from "./ProjectIntelligenceNav";

interface ProjectIntelligenceLayoutProps {
  readonly navItems: ReadonlyArray<ProjectIntelligenceNavItem>;
  readonly activeSection: ProjectIntelligenceSectionId;
  readonly onSectionChange: (section: ProjectIntelligenceSectionId) => void;
  readonly children: ReactNode;
}

const MOBILE_MEDIA_QUERY = "(max-width: 900px)";

export function ProjectIntelligenceLayout(props: ProjectIntelligenceLayoutProps) {
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);

  if (isMobile) {
    return (
      <div className="flex flex-col gap-4">
        <Select
          value={props.activeSection}
          onValueChange={(value) => props.onSectionChange(value as ProjectIntelligenceSectionId)}
        >
          <SelectTrigger className="w-full" aria-label="Project intelligence section">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {props.navItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
                {item.count > 0 ? ` (${item.count})` : ""}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <div>{props.children}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-0 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="border-r border-border/50 pt-1">
        <div className="sticky top-0">
          <ProjectIntelligenceNav
            items={props.navItems}
            activeSection={props.activeSection}
            onSectionChange={props.onSectionChange}
          />
        </div>
      </aside>
      <div className="pl-6 pr-1 pb-2">{props.children}</div>
    </div>
  );
}
