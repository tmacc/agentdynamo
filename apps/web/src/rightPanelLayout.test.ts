import { describe, expect, it } from "vitest";

import {
  clampRightPanelWidth,
  closeRightPanel,
  EMPTY_CHAT_RIGHT_PANEL_STATE,
  normalizeRightPanels,
  openRightPanel,
  toggleRightPanel,
  type ChatRightPanelContext,
} from "./rightPanelLayout";

const wideContext: ChatRightPanelContext = {
  compact: false,
  canDockPanels: true,
  canShowAgents: true,
  canShowContext: true,
};

const narrowContext: ChatRightPanelContext = {
  compact: false,
  canDockPanels: false,
  canShowAgents: true,
  canShowContext: true,
};

describe("right panel state helpers", () => {
  it("opens plan from an empty state", () => {
    expect(openRightPanel(EMPTY_CHAT_RIGHT_PANEL_STATE, "plan", wideContext)).toEqual({
      openPanels: ["plan"],
      lastRequestedPanel: "plan",
    });
  });

  it("opens agents from an empty state", () => {
    expect(openRightPanel(EMPTY_CHAT_RIGHT_PANEL_STATE, "agents", wideContext)).toEqual({
      openPanels: ["agents"],
      lastRequestedPanel: "agents",
    });
  });

  it("keeps plan and agents open when docking is available", () => {
    const planOpen = openRightPanel(EMPTY_CHAT_RIGHT_PANEL_STATE, "plan", wideContext);

    expect(openRightPanel(planOpen, "agents", wideContext)).toEqual({
      openPanels: ["plan", "agents"],
      lastRequestedPanel: "agents",
    });
  });

  it("replaces plan with agents when docking is unavailable", () => {
    const planOpen = openRightPanel(EMPTY_CHAT_RIGHT_PANEL_STATE, "plan", wideContext);

    expect(openRightPanel(planOpen, "agents", narrowContext)).toEqual({
      openPanels: ["agents"],
      lastRequestedPanel: "agents",
    });
  });

  it("keeps agents and plan open in stable visual order", () => {
    const agentsOpen = openRightPanel(EMPTY_CHAT_RIGHT_PANEL_STATE, "agents", wideContext);

    expect(openRightPanel(agentsOpen, "plan", wideContext)).toEqual({
      openPanels: ["plan", "agents"],
      lastRequestedPanel: "plan",
    });
  });

  it("compact mode keeps only the requested panel", () => {
    const agentsOpen = openRightPanel(EMPTY_CHAT_RIGHT_PANEL_STATE, "agents", wideContext);

    expect(
      openRightPanel(agentsOpen, "plan", {
        ...wideContext,
        compact: true,
      }),
    ).toEqual({
      openPanels: ["plan"],
      lastRequestedPanel: "plan",
    });
  });

  it("removes agents when agents are unavailable", () => {
    expect(
      normalizeRightPanels(
        {
          openPanels: ["plan", "agents"],
          lastRequestedPanel: "agents",
        },
        {
          ...wideContext,
          canShowAgents: false,
        },
      ),
    ).toEqual({
      openPanels: ["plan"],
      lastRequestedPanel: "plan",
    });
  });

  it("viewport shrink keeps the most recently requested panel", () => {
    expect(
      normalizeRightPanels(
        {
          openPanels: ["plan", "agents"],
          lastRequestedPanel: "plan",
        },
        narrowContext,
      ),
    ).toEqual({
      openPanels: ["plan"],
      lastRequestedPanel: "plan",
    });
  });

  it("toggles an open panel closed and leaves the other panel open", () => {
    expect(
      toggleRightPanel(
        {
          openPanels: ["plan", "agents"],
          lastRequestedPanel: "agents",
        },
        "agents",
        wideContext,
      ),
    ).toEqual({
      openPanels: ["plan"],
      lastRequestedPanel: "plan",
    });
  });

  it("closes a panel without changing unrelated open panels", () => {
    expect(
      closeRightPanel(
        {
          openPanels: ["plan", "agents"],
          lastRequestedPanel: "plan",
        },
        "agents",
      ),
    ).toEqual({
      openPanels: ["plan"],
      lastRequestedPanel: "plan",
    });
  });
});

describe("clampRightPanelWidth", () => {
  it("uses the default width for invalid values", () => {
    expect(clampRightPanelWidth(Number.NaN, { defaultWidth: 340 })).toBe(340);
  });

  it("clamps below the minimum width", () => {
    expect(clampRightPanelWidth(120, { defaultWidth: 340 })).toBe(280);
  });

  it("clamps above the maximum width", () => {
    expect(clampRightPanelWidth(900, { defaultWidth: 340 })).toBe(560);
  });

  it("clamps against a supplied available maximum", () => {
    expect(clampRightPanelWidth(500, { defaultWidth: 340, maxWidth: 420 })).toBe(420);
  });
});
