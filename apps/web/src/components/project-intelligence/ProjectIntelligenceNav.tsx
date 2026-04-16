import type { ProjectIntelligenceSectionId } from "@t3tools/contracts";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export interface ProjectIntelligenceNavItem {
  readonly id: ProjectIntelligenceSectionId;
  readonly label: string;
  readonly count: number;
}

interface ProjectIntelligenceNavProps {
  readonly items: ReadonlyArray<ProjectIntelligenceNavItem>;
  readonly activeSection: ProjectIntelligenceSectionId;
  readonly onSectionChange: (section: ProjectIntelligenceSectionId) => void;
}

export function ProjectIntelligenceNav(props: ProjectIntelligenceNavProps) {
  return (
    <SidebarMenu>
      {props.items.map((item) => (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton
            size="sm"
            isActive={item.id === props.activeSection}
            aria-current={item.id === props.activeSection ? "true" : undefined}
            className="gap-2 rounded-lg px-3 py-2 text-left text-[13px]"
            onClick={() => props.onSectionChange(item.id)}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.count > 0 ? (
              <span className="min-w-[1.25rem] rounded-full bg-muted/60 px-1.5 py-0.5 text-center text-[10px] tabular-nums text-muted-foreground">
                {item.count}
              </span>
            ) : null}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
