import type { EnvironmentId, GitStatusResult } from "@t3tools/contracts";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  __getGitStatusSnapshotListenerCountForTests,
  __setGitStatusSnapshotForTests,
  resetGitStatusStateForTests,
  useGitStatusSnapshots,
} from "../lib/gitStatusState";

const TARGET_A = { environmentId: "env-git-a" as never, cwd: "/repo-a" };
const TARGET_B = { environmentId: "env-git-b" as never, cwd: "/repo-b" };

function Harness(props: {
  readonly targets: ReadonlyArray<{
    readonly environmentId: EnvironmentId | null;
    readonly cwd: string | null;
  }>;
}) {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const snapshots = useGitStatusSnapshots(props.targets);

  return (
    <div>
      <div data-testid="render-count">{renderCountRef.current}</div>
      <div data-testid="snapshot-json">{JSON.stringify([...snapshots.entries()])}</div>
    </div>
  );
}

describe("useGitStatusSnapshots", () => {
  afterEach(() => {
    resetGitStatusStateForTests();
    document.body.innerHTML = "";
  });

  it("resubscribes when the target set changes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness targets={[TARGET_A]} />, { container: host });

    try {
      await vi.waitFor(() => {
        expect(__getGitStatusSnapshotListenerCountForTests(TARGET_A)).toBe(1);
        expect(__getGitStatusSnapshotListenerCountForTests(TARGET_B)).toBe(0);
      });

      __setGitStatusSnapshotForTests(TARGET_A, {
        data: { branch: "feature/a" } as GitStatusResult,
        error: null,
        cause: null,
        isPending: false,
      });

      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="snapshot-json"]')?.textContent).toContain(
          "feature/a",
        );
      });

      await screen.rerender(<Harness targets={[TARGET_A, TARGET_B]} />);

      await vi.waitFor(() => {
        expect(__getGitStatusSnapshotListenerCountForTests(TARGET_A)).toBe(1);
        expect(__getGitStatusSnapshotListenerCountForTests(TARGET_B)).toBe(1);
      });

      __setGitStatusSnapshotForTests(TARGET_B, {
        data: { branch: "feature/b" } as GitStatusResult,
        error: null,
        cause: null,
        isPending: false,
      });

      await vi.waitFor(() => {
        const snapshotText = document.querySelector('[data-testid="snapshot-json"]')?.textContent;
        expect(snapshotText).toContain("feature/a");
        expect(snapshotText).toContain("feature/b");
      });

      await screen.rerender(<Harness targets={[TARGET_B]} />);

      await vi.waitFor(() => {
        expect(__getGitStatusSnapshotListenerCountForTests(TARGET_A)).toBe(0);
        expect(__getGitStatusSnapshotListenerCountForTests(TARGET_B)).toBe(1);
      });

      const renderCountBefore = Number.parseInt(
        document.querySelector('[data-testid="render-count"]')?.textContent ?? "0",
        10,
      );

      __setGitStatusSnapshotForTests(TARGET_A, {
        data: { branch: "feature/a-updated" } as GitStatusResult,
        error: null,
        cause: null,
        isPending: false,
      });

      await Promise.resolve();

      expect(document.querySelector('[data-testid="snapshot-json"]')?.textContent).not.toContain(
        "feature/a-updated",
      );
      expect(
        Number.parseInt(
          document.querySelector('[data-testid="render-count"]')?.textContent ?? "0",
          10,
        ),
      ).toBe(renderCountBefore);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
