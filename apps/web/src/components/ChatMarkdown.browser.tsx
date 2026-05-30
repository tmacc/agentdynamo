import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { openInPreferredEditorMock, readLocalApiMock } = vi.hoisted(() => ({
  openInPreferredEditorMock: vi.fn(async () => "vscode"),
  readLocalApiMock: vi.fn(() => ({
    server: { getConfig: vi.fn(async () => ({ availableEditors: ["vscode"] })) },
    shell: { openInEditor: vi.fn(async () => undefined) },
  })),
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: openInPreferredEditorMock,
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: readLocalApiMock,
}));

import ChatMarkdown, { shouldRenderAsPreformattedText } from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  afterEach(() => {
    openInPreferredEditorMock.mockClear();
    readLocalApiMock.mockClear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("rewrites file uri hrefs into direct paths before rendering", async () => {
    const filePath = "/repo/project/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath})`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", filePath);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), filePath);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("auto-links bare relative file paths in assistant prose", async () => {
    const screen = await render(
      <ChatMarkdown
        text="Updated apps/web/src/components/ChatMarkdown.tsx:42 and kept https://example.com/docs unchanged."
        cwd="/repo/project"
      />,
    );

    try {
      const fileLink = page.getByRole("link", { name: "ChatMarkdown.tsx · L42" });
      await expect.element(fileLink).toBeInTheDocument();
      await expect
        .element(fileLink)
        .toHaveAttribute("href", "/repo/project/apps/web/src/components/ChatMarkdown.tsx:42");

      const webLink = page.getByRole("link", { name: "https://example.com/docs" });
      await expect.element(webLink).toBeInTheDocument();
      await expect.element(webLink).toHaveAttribute("href", "https://example.com/docs");

      await fileLink.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(
          expect.anything(),
          "/repo/project/apps/web/src/components/ChatMarkdown.tsx:42",
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("auto-links inline code when it contains exactly one relative file path", async () => {
    const screen = await render(
      <ChatMarkdown text="See `apps/web/src/markdown-links.ts:12:3`." cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "markdown-links.ts · L12:C3" });
      await expect.element(link).toBeInTheDocument();
      await expect
        .element(link)
        .toHaveAttribute("href", "/repo/project/apps/web/src/markdown-links.ts:12:3");
    } finally {
      await screen.unmount();
    }
  });

  it("does not auto-link directory-looking relative paths in assistant prose", async () => {
    const screen = await render(
      <ChatMarkdown
        text="CI cache lives at `AgentDynamo2/installer/cache`; run `AgentDynamo2/install` to repair it."
        cwd="/repo/project"
      />,
    );

    try {
      expect([...document.querySelectorAll("a")].map((link) => link.textContent)).toEqual([]);
    } finally {
      await screen.unmount();
    }
  });

  it("keeps line anchors working after rewriting file uri hrefs", async () => {
    const filePath = "/repo/project/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts:1](file://${filePath}#L1)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}:1`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), `${filePath}:1`);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("shows column information inline when present", async () => {
    const filePath = "/repo/project/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath}#L1C7)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1:C7" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}:1:7`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(
          expect.anything(),
          `${filePath}:1:7`,
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("disambiguates duplicate file basenames inline", async () => {
    const firstPath = "/repo/project/apps/web/src/components/chat/MessagesTimeline.tsx";
    const secondPath = "/repo/project/apps/web/src/components/MessagesTimeline.tsx";
    const screen = await render(
      <ChatMarkdown
        text={`See [MessagesTimeline.tsx](file://${firstPath}) and [MessagesTimeline.tsx](file://${secondPath}).`}
        cwd="/repo/project"
      />,
    );

    try {
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · components/chat" }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · src/components" }))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps normal web links unchanged", async () => {
    const screen = await render(
      <ChatMarkdown text="[OpenAI](https://openai.com/docs)" cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "OpenAI" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", "https://openai.com/docs");
      await expect.element(link).toHaveAttribute("target", "_blank");
    } finally {
      await screen.unmount();
    }
  });

  it("renders box-drawing command output as preformatted text", async () => {
    const screen = await render(
      <ChatMarkdown
        text={`┌ Usage ─────┐\n│ Input   123 │\n│ Output   45 │\n└─────────────┘`}
        cwd="/repo/project"
      />,
    );

    try {
      const pre = page.getByText(/Usage/).element().closest("pre");
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain("│ Input   123 │");
    } finally {
      await screen.unmount();
    }
  });

  it("keeps aligned assistant prose in markdown by default", async () => {
    const screen = await render(
      <ChatMarkdown
        text={`Model      GPT-5\nInput      123\nOutput      45`}
        cwd="/repo/project"
      />,
    );

    try {
      const pre = page.getByText(/Model/).element().closest("pre");
      expect(pre).toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps markdown prose when a fenced diagram uses box-drawing characters", async () => {
    const screen = await render(
      <ChatMarkdown
        text={`## Tabbed structure\n\nThe pane is organized like this:\n\n\`\`\`\nDesign Mode pane\n├── Header\n└── Inspector\n\`\`\``}
        cwd="/repo/project"
      />,
    );

    try {
      const headingPre = page
        .getByRole("heading", { name: "Tabbed structure" })
        .element()
        .closest("pre");
      const diagramPre = page.getByText("Design Mode pane").element().closest("pre");
      expect(headingPre).toBeNull();
      expect(diagramPre).not.toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("renders explicit preformatted assistant output as preformatted text", async () => {
    const screen = await render(
      <ChatMarkdown
        text={`Model      GPT-5\nInput      123\nOutput      45`}
        cwd="/repo/project"
        renderMode="preformatted"
      />,
    );

    try {
      const pre = page.getByText(/Model/).element().closest("pre");
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain("Output      45");
    } finally {
      await screen.unmount();
    }
  });

  it("detects ANSI preformatted output consistently across repeated calls", () => {
    const ansiText = `\u001b[32mStatus\u001b[0m\nInput      123`;

    expect(shouldRenderAsPreformattedText(ansiText)).toBe(true);
    expect(shouldRenderAsPreformattedText(ansiText)).toBe(true);
  });
});
