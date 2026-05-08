import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import ChatView from "../ChatView";
import { selectEnvironmentState, useStore } from "../../store";
import {
  selectFocusedThreadRef,
  selectIsTileMode,
  type TileEntry,
  useTileViewStore,
} from "../../tileViewStore";
import {
  parseTileThreadList,
  serializeTileRouteSearch,
  type TileRouteSearch,
} from "../../tileRouteSearch";
import { buildThreadRouteParams } from "../../threadRoutes";
import { SidebarInset } from "../ui/sidebar";
import { TileGrid } from "./TileGrid";
import { TilePane } from "./TilePane";

function tileRouteSignature(input: { threads: string; focus: number }): string {
  return `${input.threads}|${input.focus}`;
}

function tileRefsRouteSignature(refs: readonly ScopedThreadRef[], focusedIndex: number): string {
  return tileRouteSignature(
    serializeTileRouteSearch({
      tiles: refs,
      focusedIndex,
    }),
  );
}

function storeTileRouteSignature(tiles: readonly TileEntry[], focusedIndex: number): string {
  return tileRefsRouteSignature(
    tiles.map((entry) => entry.target.threadRef),
    focusedIndex,
  );
}

export function TileShell({ search }: { search: TileRouteSearch }) {
  const navigate = useNavigate();
  const hydrationGuardSignatureRef = useRef<string | null>(null);
  const tiles = useTileViewStore((state) => state.tiles);
  const focusedIndex = useTileViewStore((state) => state.focusedIndex);
  const setFromUrl = useTileViewStore((state) => state.setFromUrl);
  const closeTile = useTileViewStore((state) => state.closeTile);
  const focusByIndex = useTileViewStore((state) => state.focusByIndex);
  const isTileMode = useTileViewStore(selectIsTileMode);
  const focusedThreadRef = useTileViewStore(selectFocusedThreadRef);
  const focusedBootstrapComplete = useStore((state) =>
    focusedThreadRef
      ? selectEnvironmentState(state, focusedThreadRef.environmentId).bootstrapComplete
      : true,
  );

  const incomingRefs = useMemo(() => parseTileThreadList(search.threads), [search.threads]);
  const incomingFocus = search.focus ?? 0;
  const incomingSignature = useMemo(
    () => tileRefsRouteSignature(incomingRefs, incomingFocus),
    [incomingRefs, incomingFocus],
  );

  // URL → store sync
  useEffect(() => {
    const stateBeforeHydration = useTileViewStore.getState();
    const beforeSignature = storeTileRouteSignature(
      stateBeforeHydration.tiles,
      stateBeforeHydration.focusedIndex,
    );
    if (beforeSignature !== incomingSignature) {
      hydrationGuardSignatureRef.current = incomingSignature;
    }
    setFromUrl(incomingRefs, incomingFocus);
  }, [incomingRefs, incomingFocus, incomingSignature, setFromUrl]);

  // Store → URL sync (whenever tiles or focus change)
  useEffect(() => {
    if (!isTileMode) return;
    const serialized = serializeTileRouteSearch({
      tiles: tiles.map((entry) => entry.target.threadRef),
      focusedIndex,
    });
    const serializedSignature = tileRouteSignature(serialized);
    const hydrationGuardSignature = hydrationGuardSignatureRef.current;
    if (hydrationGuardSignature !== null && serializedSignature !== hydrationGuardSignature) {
      hydrationGuardSignatureRef.current = null;
      return;
    }
    hydrationGuardSignatureRef.current = null;
    if (serialized.threads === (search.threads ?? "") && serialized.focus === (search.focus ?? 0)) {
      return;
    }
    void navigate({
      to: "/tiled",
      search: serialized,
      replace: true,
    }).catch(() => undefined);
  }, [tiles, focusedIndex, isTileMode, navigate, search.threads, search.focus]);

  // Exit tile mode when no tiles remain
  const handleClose = useCallback(
    (index: number) => {
      const removed = closeTile(index);
      if (!removed) return;
      const stateAfter = useTileViewStore.getState();
      if (stateAfter.tiles.length === 0) {
        const ref = removed.target.threadRef;
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(ref),
          replace: true,
        }).catch(() => undefined);
      }
    },
    [closeTile, navigate],
  );

  if (tiles.length === 0) {
    if (!focusedBootstrapComplete) {
      return (
        <SidebarInset className="flex h-svh min-h-0 items-center justify-center overflow-hidden bg-background text-foreground md:h-dvh">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </SidebarInset>
      );
    }
    return (
      <SidebarInset className="flex h-svh min-h-0 flex-col items-center justify-center gap-2 overflow-hidden bg-background text-foreground md:h-dvh">
        <div className="text-sm text-muted-foreground">No tiles open.</div>
        <div className="text-xs text-muted-foreground/70">
          Press <kbd className="rounded border border-border px-1 font-mono text-[10px]">⌘\</kbd> to
          split with a thread.
        </div>
      </SidebarInset>
    );
  }

  if (!focusedThreadRef) {
    return (
      <SidebarInset className="h-svh min-h-0 overflow-hidden bg-background text-foreground md:h-dvh" />
    );
  }

  const tileGrid = (
    <TileGrid count={tiles.length}>
      {tiles.map((entry, index) => (
        <TilePane
          key={entry.id}
          tile={entry}
          index={index}
          isFocused={index === focusedIndex}
          onFocus={focusByIndex}
          onClose={handleClose}
        >
          <ChatView
            environmentId={entry.target.threadRef.environmentId}
            threadId={entry.target.threadRef.threadId}
            routeKind="server"
            renderMode="tile"
          />
        </TilePane>
      ))}
    </TileGrid>
  );

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden bg-background text-foreground md:h-dvh">
      <ChatView
        key={`shell-${focusedThreadRef.environmentId}:${focusedThreadRef.threadId}`}
        environmentId={focusedThreadRef.environmentId}
        threadId={focusedThreadRef.threadId}
        routeKind="server"
        renderMode="shell"
        messagesSlot={tileGrid}
      />
    </SidebarInset>
  );
}
