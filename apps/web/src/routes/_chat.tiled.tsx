import { createFileRoute, retainSearchParams } from "@tanstack/react-router";

import { TileShell } from "../components/tile/TileShell";
import { parseTileRouteSearch, type TileRouteSearch } from "../tileRouteSearch";

function TileRouteView() {
  const search = Route.useSearch();
  return <TileShell search={search} />;
}

export const Route = createFileRoute("/_chat/tiled")({
  validateSearch: parseTileRouteSearch,
  search: {
    middlewares: [retainSearchParams<TileRouteSearch>(["threads", "focus"])],
  },
  component: TileRouteView,
});
