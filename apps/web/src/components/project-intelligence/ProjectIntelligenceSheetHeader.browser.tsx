import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProjectIntelligenceSheetHeader } from "./ProjectIntelligenceSheetHeader";
import { Sheet, SheetPopup } from "../ui/sheet";

describe("ProjectIntelligenceSheetHeader", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("calls the explicit close handler when the header close button is clicked", async () => {
    const onClose = vi.fn();
    const screen = await render(
      <Sheet open>
        <SheetPopup showCloseButton={false}>
          <ProjectIntelligenceSheetHeader
            viewMode="project"
            result={undefined}
            projectName="AgentDynamo"
            onClose={onClose}
          />
        </SheetPopup>
      </Sheet>,
    );

    try {
      const closeButton = page.getByRole("button", { name: "Close project intelligence" });
      await expect.element(closeButton).toBeInTheDocument();

      await closeButton.click();

      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      await screen.unmount();
    }
  });
});
