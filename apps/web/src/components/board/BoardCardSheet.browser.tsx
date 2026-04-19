import type { EnvironmentApi, FeatureCard } from "@t3tools/contracts";
import { ProjectId } from "@t3tools/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { __resetBoardStoreForTests, boardKey, useBoardStore } from "../../boardStore";
import { useStore } from "../../store";
import { BoardCardSheet } from "./BoardCardSheet";

const TEST_ENVIRONMENT_ID = "environment-board-sheet" as never;
const TEST_PROJECT_ID = ProjectId.make("project-board-sheet");
const TEST_CARD_ID = "card-board-sheet" as FeatureCard["id"];

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

const apiHarness = vi.hoisted(() => ({
  archiveDeferredRef: { current: createDeferredPromise<{ sequence: number }>() },
  deleteDeferredRef: { current: createDeferredPromise<{ sequence: number }>() },
  dispatchCommandSpy: vi.fn(async (_command: { type: string }) => ({ sequence: 1 })),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");

  return {
    ...actual,
    useNavigate: () => vi.fn(async () => undefined),
  };
});

function makeCard(overrides: Partial<FeatureCard> = {}): FeatureCard {
  return {
    id: TEST_CARD_ID,
    projectId: TEST_PROJECT_ID,
    title: "Initial card" as FeatureCard["title"],
    description: "Persisted description",
    seededPrompt: null,
    column: "planned",
    sortOrder: 0,
    linkedThreadId: null,
    linkedProposedPlanId: null,
    createdAt: "2026-04-18T00:00:00.000Z" as FeatureCard["createdAt"],
    updatedAt: "2026-04-18T00:00:00.000Z" as FeatureCard["updatedAt"],
    archivedAt: null,
    ...overrides,
  };
}

function createEnvironmentApiStub(): EnvironmentApi {
  return {
    terminal: {} as never,
    projects: {} as never,
    filesystem: {} as never,
    git: {} as never,
    orchestration: {} as never,
    board: {
      listCards: vi.fn(async () => ({ cards: [] })),
      listDismissedGhosts: vi.fn(async () => ({ dismissed: [] })),
      subscribeProject: vi.fn(() => () => undefined),
      dispatchCommand: apiHarness.dispatchCommandSpy,
    },
  };
}

function setBoardCards(cards: FeatureCard[]): void {
  useBoardStore.setState((state) => ({
    ...state,
    cardsByKey: {
      ...state.cardsByKey,
      [boardKey(TEST_ENVIRONMENT_ID, TEST_PROJECT_ID)]: cards,
    },
  }));
}

function getTitleInput(): HTMLInputElement | null {
  return document.querySelector('input[aria-label="Card title"]');
}

function getDescriptionTextarea(): HTMLTextAreaElement | null {
  return document.querySelector(
    'textarea[placeholder="Add more detail about this card…"]',
  ) as HTMLTextAreaElement | null;
}

function findButtonByText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  ) ?? null) as HTMLButtonElement | null;
}

async function waitForElement<T>(getter: () => T | null, message: string): Promise<T> {
  await vi.waitFor(() => {
    expect(getter(), message).toBeTruthy();
  });
  const element = getter();
  if (element === null) {
    throw new Error(message);
  }
  return element;
}

function Harness(props: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);

  return open ? (
    <BoardCardSheet
      environmentId={TEST_ENVIRONMENT_ID}
      projectId={TEST_PROJECT_ID}
      cardId={TEST_CARD_ID}
      onClose={() => {
        props.onClose?.();
        setOpen(false);
      }}
      onStartAgent={() => undefined}
    />
  ) : (
    <div data-testid="sheet-closed">Sheet closed</div>
  );
}

describe("BoardCardSheet", () => {
  afterEach(() => {
    apiHarness.archiveDeferredRef.current = createDeferredPromise<{ sequence: number }>();
    apiHarness.deleteDeferredRef.current = createDeferredPromise<{ sequence: number }>();
    apiHarness.dispatchCommandSpy.mockReset();
    __resetEnvironmentApiOverridesForTests();
    __resetBoardStoreForTests();
    useStore.setState({
      activeEnvironmentId: null,
      environmentStateById: {},
    });
    document.body.innerHTML = "";
  });

  it("preserves dirty fields across same-card updates while syncing untouched fields", async () => {
    __setEnvironmentApiOverrideForTests(TEST_ENVIRONMENT_ID, createEnvironmentApiStub());
    setBoardCards([makeCard()]);

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      await waitForElement(getDescriptionTextarea, "Unable to find description textarea");
      await page
        .getByPlaceholder("Add more detail about this card…")
        .fill("Local unsaved description");

      setBoardCards([
        makeCard({
          title: "Server retitled card" as FeatureCard["title"],
          description: "Server updated description",
        }),
      ]);

      await vi.waitFor(() => {
        expect(getTitleInput()?.value).toBe("Server retitled card");
        expect(getDescriptionTextarea()?.value).toBe("Local unsaved description");
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("keeps destructive controls disabled while archive is still pending after an optimistic update", async () => {
    apiHarness.dispatchCommandSpy.mockImplementation(async (command: { type: string }) => {
      if (command.type === "board.card.archive") {
        return await apiHarness.archiveDeferredRef.current.promise;
      }
      return { sequence: 1 };
    });
    __setEnvironmentApiOverrideForTests(TEST_ENVIRONMENT_ID, createEnvironmentApiStub());
    setBoardCards([makeCard()]);

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      const archiveButton = await waitForElement(
        () => findButtonByText("Archive"),
        'Unable to find "Archive" button',
      );
      archiveButton.click();

      await vi.waitFor(() => {
        expect(getTitleInput()?.disabled).toBe(true);
        expect(findButtonByText("Close")?.disabled).toBe(true);
        expect(document.body.textContent).toContain("Archived");
      });

      apiHarness.archiveDeferredRef.current.resolve({ sequence: 1 });

      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="sheet-closed"]')).toBeTruthy();
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("stays open and shows an error when delete rolls back after optimistic removal", async () => {
    apiHarness.dispatchCommandSpy.mockImplementation(async (command: { type: string }) => {
      if (command.type === "board.card.delete") {
        return await apiHarness.deleteDeferredRef.current.promise;
      }
      return { sequence: 1 };
    });
    __setEnvironmentApiOverrideForTests(TEST_ENVIRONMENT_ID, createEnvironmentApiStub());
    setBoardCards([makeCard()]);

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      const deleteButton = await waitForElement(
        () => findButtonByText("Delete"),
        'Unable to find "Delete" button',
      );
      deleteButton.click();

      await vi.waitFor(() => {
        expect(getTitleInput()).toBeTruthy();
      });

      apiHarness.deleteDeferredRef.current.reject(new Error("delete failed"));

      await vi.waitFor(() => {
        expect(getTitleInput()).toBeTruthy();
        expect(document.body.textContent).toContain("delete failed");
      });
    } finally {
      await Promise.resolve();
      await screen.unmount();
      host.remove();
    }
  });

  it("closes after a successful delete", async () => {
    apiHarness.dispatchCommandSpy.mockImplementation(async (command: { type: string }) => {
      if (command.type === "board.card.delete") {
        return await apiHarness.deleteDeferredRef.current.promise;
      }
      return { sequence: 1 };
    });
    __setEnvironmentApiOverrideForTests(TEST_ENVIRONMENT_ID, createEnvironmentApiStub());
    setBoardCards([makeCard()]);

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      const deleteButton = await waitForElement(
        () => findButtonByText("Delete"),
        'Unable to find "Delete" button',
      );
      deleteButton.click();

      await vi.waitFor(() => {
        expect(getTitleInput()).toBeTruthy();
      });

      apiHarness.deleteDeferredRef.current.resolve({ sequence: 1 });

      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="sheet-closed"]')).toBeTruthy();
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("closes when the card disappears without a local delete in flight", async () => {
    __setEnvironmentApiOverrideForTests(TEST_ENVIRONMENT_ID, createEnvironmentApiStub());
    setBoardCards([makeCard()]);

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      await waitForElement(getTitleInput, "Unable to find card title input");

      setBoardCards([]);

      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="sheet-closed"]')).toBeTruthy();
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
