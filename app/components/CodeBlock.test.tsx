// @vitest-environment jsdom

// Packages
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import "@testing-library/jest-dom/vitest";

// Components
import CodeBlock from "./CodeBlock";

const CODE = "const a = 1;\n  return a;";

function renderBlock(language: string | null = "js", code: string = CODE): HTMLElement {
  return render(
    <CodeBlock language={language} code={code}>
      <code>{`${code}\n`}</code>
    </CodeBlock>,
  ).container;
}

function mockClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

async function clickCopy(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("CodeBlock header", () => {
  it("shows the language display name outside the pre", () => {
    const container = renderBlock("js");
    const label = screen.getByText("JavaScript");
    expect(label.closest("pre")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toBe(`${CODE}\n`);
  });

  it("omits the label but keeps the button when there is no language", () => {
    const container = renderBlock(null);
    expect(container.querySelector(".code-block-header span.truncate")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  });

  it("renders a tag with markup characters as text only", () => {
    const container = renderBlock("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("keeps the pre focusable", () => {
    const container = renderBlock();
    expect(container.querySelector("pre")).toHaveAttribute("tabindex", "0");
  });
});

describe("CodeBlock copy button", () => {
  it("is a focusable button of type button", () => {
    renderBlock();
    const button = screen.getByRole("button", { name: "Copy code" });
    expect(button).toHaveAttribute("type", "button");
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("copies exactly the code body, never the label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    renderBlock("js");
    await clickCopy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(CODE);
  });

  it("announces Copied, swaps the icon, then resets after the timeout", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    const container = renderBlock();
    const iconBefore = container.querySelector("button svg")?.innerHTML;
    await clickCopy();
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent("Copied");
    expect(container.querySelector("button svg")?.innerHTML).not.toBe(iconBefore);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.querySelector("[aria-live='polite']")).toBeEmptyDOMElement();
    expect(container.querySelector("button svg")?.innerHTML).toBe(iconBefore);
  });

  it("announces Copy failed when writeText rejects", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const container = renderBlock();
    await clickCopy();
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent("Copy failed");
  });

  it("announces Copy failed when the clipboard API is missing", async () => {
    const container = renderBlock();
    await clickCopy();
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent("Copy failed");
  });

  it("clears the reset timer on unmount", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    const { unmount } = render(
      <CodeBlock language="js" code={CODE}>
        <code>{CODE}</code>
      </CodeBlock>,
    );
    await clickCopy();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("CodeBlock server rendering", () => {
  it("renders to a string without touching window or navigator", () => {
    const html = renderToString(
      <CodeBlock language="py" code="print(1)">
        <code>{"print(1)\n"}</code>
      </CodeBlock>,
    );
    expect(html).toContain("Python");
    expect(html).toContain('aria-label="Copy code"');
  });
});
