export const RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 980px)";
export const RIGHT_PANEL_SHEET_CLASS_NAME =
  "w-[min(42vw,28rem)] min-w-80 max-w-[28rem] p-0 max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0 wco:mt-[env(titlebar-area-height)] wco:h-[calc(100%-env(titlebar-area-height))] wco:max-h-[calc(100%-env(titlebar-area-height))]";

export const RIGHT_PANEL_PLAN_WIDTH_STORAGE_KEY = "chat_right_panel_plan_width";
export const RIGHT_PANEL_AGENTS_WIDTH_STORAGE_KEY = "chat_right_panel_agents_width";
export const RIGHT_PANEL_PLAN_DEFAULT_WIDTH = 340;
export const RIGHT_PANEL_AGENTS_DEFAULT_WIDTH = 360;
export const RIGHT_PANEL_MIN_WIDTH = 280;
export const RIGHT_PANEL_MAX_WIDTH = 560;
export const RIGHT_PANEL_MIN_CHAT_WIDTH = 520;

export type ChatRightPanelId = "plan" | "agents";

export type ChatRightPanelState = {
  openPanels: ChatRightPanelId[];
  lastRequestedPanel: ChatRightPanelId | null;
};

export type ChatRightPanelContext = {
  compact: boolean;
  canShowAgents: boolean;
  canDockPanels: boolean;
};

export const EMPTY_CHAT_RIGHT_PANEL_STATE: ChatRightPanelState = {
  openPanels: [],
  lastRequestedPanel: null,
};

const RIGHT_PANEL_ORDER: readonly ChatRightPanelId[] = ["plan", "agents"];

function orderRightPanels(panels: Iterable<ChatRightPanelId>): ChatRightPanelId[] {
  const panelSet = new Set(panels);
  return RIGHT_PANEL_ORDER.filter((panel) => panelSet.has(panel));
}

function pickSinglePanel(
  panels: readonly ChatRightPanelId[],
  lastRequestedPanel: ChatRightPanelId | null,
): ChatRightPanelId[] {
  if (panels.length <= 1) return [...panels];
  if (lastRequestedPanel && panels.includes(lastRequestedPanel)) {
    return [lastRequestedPanel];
  }
  const fallbackPanel = panels.at(-1);
  return fallbackPanel ? [fallbackPanel] : [];
}

export function normalizeRightPanels(
  state: ChatRightPanelState,
  context: ChatRightPanelContext,
): ChatRightPanelState {
  const availablePanels = state.openPanels.filter(
    (panel) => panel !== "agents" || context.canShowAgents,
  );
  const orderedPanels = orderRightPanels(availablePanels);
  const openPanels =
    context.compact || !context.canDockPanels
      ? pickSinglePanel(orderedPanels, state.lastRequestedPanel)
      : orderedPanels;

  const lastRequestedPanel =
    state.lastRequestedPanel && openPanels.includes(state.lastRequestedPanel)
      ? state.lastRequestedPanel
      : (openPanels.at(-1) ?? null);

  return { openPanels, lastRequestedPanel };
}

export function openRightPanel(
  state: ChatRightPanelState,
  panel: ChatRightPanelId,
  context: ChatRightPanelContext,
): ChatRightPanelState {
  if (panel === "agents" && !context.canShowAgents) {
    return normalizeRightPanels(state, context);
  }

  return normalizeRightPanels(
    {
      openPanels: orderRightPanels([...state.openPanels, panel]),
      lastRequestedPanel: panel,
    },
    context,
  );
}

export function closeRightPanel(
  state: ChatRightPanelState,
  panel: ChatRightPanelId,
): ChatRightPanelState {
  const openPanels = state.openPanels.filter((openPanel) => openPanel !== panel);
  return {
    openPanels,
    lastRequestedPanel:
      state.lastRequestedPanel === panel ? (openPanels.at(-1) ?? null) : state.lastRequestedPanel,
  };
}

export function toggleRightPanel(
  state: ChatRightPanelState,
  panel: ChatRightPanelId,
  context: ChatRightPanelContext,
): ChatRightPanelState {
  if (state.openPanels.includes(panel)) {
    return closeRightPanel(state, panel);
  }
  return openRightPanel(state, panel, context);
}

export function clampRightPanelWidth(
  width: number,
  options: {
    defaultWidth: number;
    maxWidth?: number;
    minWidth?: number;
  },
): number {
  const minWidth = options.minWidth ?? RIGHT_PANEL_MIN_WIDTH;
  const maxWidth = Math.max(minWidth, options.maxWidth ?? RIGHT_PANEL_MAX_WIDTH);
  const resolvedWidth = Number.isFinite(width) ? width : options.defaultWidth;
  return Math.max(minWidth, Math.min(resolvedWidth, maxWidth));
}
