import "../../index.css";

import { EnvironmentId, MessageId, ProjectId } from "@t3tools/contracts";
import { createRef } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { resetSavedPromptStoreForTests, useSavedPromptStore } from "~/savedPromptStore";

const scrollToEndSpy = vi.fn();
const getStateSpy = vi.fn(() => ({ isAtEnd: true }));

vi.mock("@legendapp/list/react", async () => {
  const React = await import("react");

  const LegendList = React.forwardRef(function MockLegendList(
    props: {
      data: Array<{ id: string }>;
      keyExtractor: (item: { id: string }) => string;
      renderItem: (args: { item: { id: string } }) => React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
    },
    ref: React.ForwardedRef<LegendListRef>,
  ) {
    React.useImperativeHandle(
      ref,
      () =>
        ({
          scrollToEnd: scrollToEndSpy,
          getState: getStateSpy,
        }) as unknown as LegendListRef,
    );

    return (
      <div data-testid="legend-list">
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  });

  return { LegendList };
});

import { MessagesTimeline } from "./MessagesTimeline";

function buildProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnId: null,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    completionDividerBeforeEntryId: null,
    completionSummary: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    userMessageSwitchInfoByMessageId: new Map(),
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: vi.fn(),
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: vi.fn(),
    isRevertingCheckpoint: false,
    onImageExpand: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
    activeThreadProjectId: undefined,
    markdownCwd: undefined,
    resolvedTheme: "dark" as const,
    timestampFormat: "24-hour" as const,
    workspaceRoot: undefined,
    onIsAtEndChange: vi.fn(),
  };
}

describe("MessagesTimeline", () => {
  afterEach(() => {
    scrollToEndSpy.mockReset();
    getStateSpy.mockClear();
    resetSavedPromptStoreForTests();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders activity rows instead of the empty placeholder when a thread has non-message timeline data", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "work-1",
            kind: "work",
            createdAt: "2026-04-13T12:00:00.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-04-13T12:00:00.000Z",
              label: "thinking",
              detail: "Inspecting repository state",
              tone: "thinking",
            },
          },
        ]}
      />,
    );

    try {
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .not.toBeInTheDocument();
      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("opens the source thread when the fork separator is clicked", async () => {
    const props = {
      ...buildProps(),
      onOpenForkSourceThread: vi.fn(),
    };
    const screen = await render(
      <MessagesTimeline
        {...props}
        timelineEntries={[
          {
            id: "imported-user-entry",
            kind: "message",
            createdAt: "2026-01-01T00:00:01.000Z",
            message: {
              id: MessageId.make("imported-user"),
              role: "user",
              text: "Imported question",
              turnId: null,
              createdAt: "2026-01-01T00:00:01.000Z",
              streaming: false,
            },
          },
        ]}
        forkOrigin={{
          sourceThreadId: "thread-source" as never,
          sourceThreadTitle: "Parent thread",
          sourceUserMessageId: "message-source" as never,
          importedUntilAt: "2026-01-01T00:00:02.000Z",
          forkedAt: "2026-01-01T00:00:00.000Z",
        }}
      />,
    );

    try {
      const separatorButton = page.getByRole("button", { name: "Forked from Parent thread" });
      await expect.element(separatorButton).toBeVisible();
      await separatorButton.click();
      expect(props.onOpenForkSourceThread).toHaveBeenCalledWith("thread-source");
    } finally {
      await screen.unmount();
    }
  });

  it("snaps to the bottom when timeline rows appear after an initially empty render", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const props = buildProps();
    const screen = await render(<MessagesTimeline {...props} timelineEntries={[]} />);

    try {
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .toBeVisible();

      await screen.rerender(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            {
              id: "work-1",
              kind: "work",
              createdAt: "2026-04-13T12:00:00.000Z",
              entry: {
                id: "work-1",
                createdAt: "2026-04-13T12:00:00.000Z",
                label: "thinking",
                detail: "Inspecting repository state",
                tone: "thinking",
              },
            },
          ]}
        />,
      );

      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
      expect(props.onIsAtEndChange).toHaveBeenCalledWith(true);
      expect(scrollToEndSpy).toHaveBeenCalledWith({ animated: false });
      expect(requestAnimationFrameSpy).toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("renders a provider switch badge on the user bubble for the switching turn", async () => {
    const props = buildProps();
    const screen = await render(
      <MessagesTimeline
        {...props}
        userMessageSwitchInfoByMessageId={
          new Map([
            [
              MessageId.make("user-1"),
              {
                fromProvider: "codex",
                toProvider: "claudeAgent",
                toModel: "claude-opus-4-6",
              },
            ],
          ])
        }
        timelineEntries={[
          {
            id: "user-entry",
            kind: "message",
            createdAt: "2026-04-13T12:00:00.000Z",
            message: {
              id: MessageId.make("user-1"),
              role: "user",
              text: "Switch providers",
              turnId: null,
              createdAt: "2026-04-13T12:00:00.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    try {
      await expect.element(page.getByText("Switch providers")).toBeVisible();
      await expect
        .element(page.getByTestId("user-message-switch-badge"))
        .toHaveTextContent("Switched to Claude · claude-opus-4-6");
    } finally {
      await screen.unmount();
    }
  });

  it("saves a previous user message as a project-scoped prompt", async () => {
    const projectId = ProjectId.make("project-browser");
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        activeThreadProjectId={projectId}
        timelineEntries={[
          {
            id: "user-entry",
            kind: "message",
            createdAt: "2026-04-13T12:00:00.000Z",
            message: {
              id: MessageId.make("user-save"),
              role: "user",
              text: "Review this diff for regressions",
              turnId: null,
              createdAt: "2026-04-13T12:00:00.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    try {
      await page.getByText("Review this diff for regressions").hover();
      const saveButton = page.getByTestId("save-prompt-button");
      await expect.element(saveButton).toBeVisible();
      await saveButton.click();

      await expect.element(page.getByText("Save prompt")).toBeVisible();
      const titleInput = page.getByTestId("saved-prompt-title-input");
      await expect.element(titleInput).toHaveValue("Review this diff for regressions");
      await expect.element(page.getByText("This project")).toBeVisible();

      await page.getByRole("button", { name: "Save" }).click();

      const snippets = Object.values(useSavedPromptStore.getState().snippetsById);
      expect(snippets).toEqual([
        expect.objectContaining({
          title: "Review this diff for regressions",
          body: "Review this diff for regressions",
          scope: "project",
        }),
      ]);
    } finally {
      await screen.unmount();
    }
  });
});
