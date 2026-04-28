import { Schema } from "effect";
import * as React from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";

export type ResizablePanelSide = "left" | "right";

export type ResizablePanelElements = {
  panel: HTMLElement;
  transitionTargets: HTMLElement[];
};

type ResizeState<TElements extends ResizablePanelElements> = {
  elements: TElements;
  moved: boolean;
  pendingWidth: number;
  pointerId: number;
  rail: HTMLButtonElement;
  rafId: number | null;
  side: ResizablePanelSide;
  startWidth: number;
  startX: number;
  width: number;
};

export function clampResizablePanelWidth(
  width: number,
  options: {
    maxWidth: number;
    minWidth: number;
  },
): number {
  return Math.max(options.minWidth, Math.min(width, options.maxWidth));
}

export function useResizablePanelDrag<TElements extends ResizablePanelElements>(options: {
  applyWidth: (elements: TElements, width: number) => void;
  enabled: boolean;
  getElements: (rail: HTMLButtonElement) => TElements | null;
  getInitialWidth?: ((elements: TElements) => number) | undefined;
  maxWidth: number;
  minWidth: number;
  onResize?: ((width: number) => void) | undefined;
  shouldAcceptWidth?:
    | ((context: {
        currentWidth: number;
        elements: TElements;
        nextWidth: number;
        rail: HTMLButtonElement;
        side: ResizablePanelSide;
      }) => boolean)
    | undefined;
  side: ResizablePanelSide;
  storageKey?: string | null;
}) {
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  const railRef = React.useRef<HTMLButtonElement | null>(null);
  const suppressClickRef = React.useRef(false);
  const resizeStateRef = React.useRef<ResizeState<TElements> | null>(null);

  const stopResize = React.useCallback((pointerId: number) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) {
      return;
    }
    const currentOptions = optionsRef.current;
    if (resizeState.rafId !== null) {
      window.cancelAnimationFrame(resizeState.rafId);
    }
    resizeState.elements.transitionTargets.forEach((element) => {
      element.style.removeProperty("transition-duration");
    });
    if (currentOptions.storageKey && typeof window !== "undefined") {
      setLocalStorageItem(currentOptions.storageKey, resizeState.width, Schema.Finite);
    }
    currentOptions.onResize?.(resizeState.width);
    resizeStateRef.current = null;
    if (resizeState.rail.hasPointerCapture(pointerId)) {
      resizeState.rail.releasePointerCapture(pointerId);
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const currentOptions = optionsRef.current;
    if (!currentOptions.enabled || event.button !== 0) return;

    const elements = currentOptions.getElements(event.currentTarget);
    if (!elements) {
      return;
    }

    const measuredWidth =
      currentOptions.getInitialWidth?.(elements) ?? elements.panel.getBoundingClientRect().width;
    const startWidth = clampResizablePanelWidth(measuredWidth, currentOptions);
    elements.transitionTargets.forEach((element) => {
      element.style.setProperty("transition-duration", "0ms");
    });

    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      elements,
      moved: false,
      pendingWidth: startWidth,
      pointerId: event.pointerId,
      rail: event.currentTarget,
      rafId: null,
      side: currentOptions.side,
      startWidth,
      startX: event.clientX,
      width: startWidth,
    };
    currentOptions.applyWidth(elements, startWidth);
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onPointerMove = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const currentOptions = optionsRef.current;
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId || !currentOptions.enabled) {
      return;
    }

    event.preventDefault();
    const delta =
      resizeState.side === "right"
        ? resizeState.startX - event.clientX
        : event.clientX - resizeState.startX;
    if (Math.abs(delta) > 2) {
      resizeState.moved = true;
    }
    resizeState.pendingWidth = clampResizablePanelWidth(
      resizeState.startWidth + delta,
      currentOptions,
    );
    if (resizeState.rafId !== null) {
      return;
    }

    resizeState.rafId = window.requestAnimationFrame(() => {
      const activeResizeState = resizeStateRef.current;
      const latestOptions = optionsRef.current;
      if (!activeResizeState || !latestOptions.enabled) return;

      activeResizeState.rafId = null;
      const nextWidth = activeResizeState.pendingWidth;
      const accepted =
        latestOptions.shouldAcceptWidth?.({
          currentWidth: activeResizeState.width,
          elements: activeResizeState.elements,
          nextWidth,
          rail: activeResizeState.rail,
          side: activeResizeState.side,
        }) ?? true;
      if (!accepted) {
        return;
      }

      latestOptions.applyWidth(activeResizeState.elements, nextWidth);
      activeResizeState.width = nextWidth;
    });
  }, []);

  const endResizeInteraction = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;

      event.preventDefault();
      suppressClickRef.current = resizeState.moved;
      stopResize(event.pointerId);
    },
    [stopResize],
  );

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      endResizeInteraction(event);
    },
    [endResizeInteraction],
  );

  const onPointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      endResizeInteraction(event);
    },
    [endResizeInteraction],
  );

  const consumeClickSuppression = React.useCallback(() => {
    if (!suppressClickRef.current) {
      return false;
    }
    suppressClickRef.current = false;
    return true;
  }, []);

  React.useEffect(() => {
    const currentOptions = optionsRef.current;
    if (!currentOptions.storageKey || !currentOptions.enabled || typeof window === "undefined") {
      return;
    }
    const rail = railRef.current;
    if (!rail) return;
    const elements = currentOptions.getElements(rail);
    if (!elements) return;

    const storedWidth = getLocalStorageItem(currentOptions.storageKey, Schema.Finite);
    if (storedWidth === null) return;
    const clampedWidth = clampResizablePanelWidth(storedWidth, currentOptions);
    currentOptions.applyWidth(elements, clampedWidth);
    currentOptions.onResize?.(clampedWidth);
  }, [options.enabled, options.storageKey]);

  React.useEffect(() => {
    return () => {
      const resizeState = resizeStateRef.current;
      if (resizeState?.rafId != null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      resizeState?.elements.transitionTargets.forEach((element) => {
        element.style.removeProperty("transition-duration");
      });
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  return {
    consumeClickSuppression,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    railRef,
  };
}
