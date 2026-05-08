import { LayoutGridIcon } from "lucide-react";
import { useLocation, useRouter } from "@tanstack/react-router";

import { serializeTileRouteSearch } from "../../tileRouteSearch";
import { useTileViewStore } from "../../tileViewStore";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export function SidebarWorkspacesSection() {
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });
  const tileCount = useTileViewStore((state) => state.tiles.length);
  const isActive = pathname === "/tiled";

  return (
    <SidebarGroup className="px-2 py-2">
      <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Workspaces
        </span>
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            isActive={isActive}
            className="gap-2 px-2 py-1.5 text-muted-foreground/80 hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground"
            onClick={() => {
              const state = useTileViewStore.getState();
              const search =
                state.tiles.length > 0
                  ? serializeTileRouteSearch({
                      tiles: state.tiles.map((entry) => entry.target.threadRef),
                      focusedIndex: state.focusedIndex,
                    })
                  : {};
              void router.navigate({ to: "/tiled", search }).catch(() => undefined);
            }}
          >
            <LayoutGridIcon className="size-3.5 shrink-0" />
            <span className="flex-1 truncate text-left text-xs">Tile View</span>
            {tileCount > 0 ? (
              <span className="min-w-4 rounded-sm bg-muted px-1 text-center text-[10px] font-medium text-muted-foreground">
                {tileCount}
              </span>
            ) : null}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
