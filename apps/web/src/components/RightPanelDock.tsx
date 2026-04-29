import type { ReactNode } from "react";

import {
  clampRightPanelWidth,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_CHAT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  type ChatRightPanelId,
} from "../rightPanelLayout";
import { useResizablePanelDrag } from "../hooks/useResizablePanelDrag";
import { cn } from "~/lib/utils";

type RightPanelDockPanel = {
  children: ReactNode;
  defaultWidth: number;
  id: ChatRightPanelId;
  label: string;
  onWidthChange: (width: number) => void;
  width: number;
};

export function RightPanelDock(props: {
  containerWidth: number;
  panels: ReadonlyArray<RightPanelDockPanel>;
}) {
  if (props.panels.length === 0) {
    return null;
  }

  return (
    <aside className="flex h-full min-h-0 shrink-0" aria-label="Chat right panels">
      {props.panels.map((panel) => {
        const otherPanelsWidth = props.panels.reduce(
          (total, candidate) => (candidate.id === panel.id ? total : total + candidate.width),
          0,
        );
        const availablePanelWidth =
          props.containerWidth > 0
            ? props.containerWidth - RIGHT_PANEL_MIN_CHAT_WIDTH - otherPanelsWidth
            : RIGHT_PANEL_MAX_WIDTH;
        const maxWidth = Math.max(
          RIGHT_PANEL_MIN_WIDTH,
          Math.min(RIGHT_PANEL_MAX_WIDTH, availablePanelWidth),
        );

        return (
          <ResizableRightPanel
            key={panel.id}
            defaultWidth={panel.defaultWidth}
            label={panel.label}
            maxWidth={maxWidth}
            onWidthChange={panel.onWidthChange}
            width={panel.width}
          >
            {panel.children}
          </ResizableRightPanel>
        );
      })}
    </aside>
  );
}

function ResizableRightPanel(props: {
  children: ReactNode;
  defaultWidth: number;
  label: string;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  width: number;
}) {
  const width = clampRightPanelWidth(props.width, {
    defaultWidth: props.defaultWidth,
    maxWidth: props.maxWidth,
  });
  const resizeDrag = useResizablePanelDrag({
    applyWidth: (elements, nextWidth) => {
      elements.panel.style.width = `${nextWidth}px`;
    },
    enabled: true,
    getElements: (rail) => {
      const panel = rail.closest<HTMLElement>("[data-right-panel='true']");
      if (!panel) {
        return null;
      }
      return {
        panel,
        transitionTargets: [panel],
      };
    },
    maxWidth: props.maxWidth,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    onResize: props.onWidthChange,
    side: "right",
  });

  return (
    <div
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border/70 bg-card/50"
      data-right-panel="true"
      style={{ width }}
    >
      <button
        aria-label={`Resize ${props.label} panel`}
        className={cn(
          "absolute inset-y-0 left-0 z-20 hidden w-3 -translate-x-1/2 cursor-e-resize sm:flex",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border",
        )}
        onClick={(event) => {
          if (resizeDrag.consumeClickSuppression()) {
            event.preventDefault();
          }
        }}
        onPointerCancel={resizeDrag.onPointerCancel}
        onPointerDown={resizeDrag.onPointerDown}
        onPointerMove={resizeDrag.onPointerMove}
        onPointerUp={resizeDrag.onPointerUp}
        ref={resizeDrag.railRef}
        tabIndex={-1}
        title={`Drag to resize ${props.label} panel`}
        type="button"
      />
      {props.children}
    </div>
  );
}

export type { RightPanelDockPanel };
