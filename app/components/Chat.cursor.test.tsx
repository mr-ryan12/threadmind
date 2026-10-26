// @vitest-environment jsdom
//
// Selector-matching tests for the inline streaming cursor in app/tailwind.css.
// jsdom cannot render ::after, but it can evaluate selectors, so we read the real
// cursor selector list out of the stylesheet and check which element it picks for
// each Markdown shape. Visual appearance (position, pulse, colors) is NOT covered
// here and needs a manual browser check.

// Packages
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";

// Components
import MessageContent from "./MessageContent";

// Strips CSS comments, then splits on commas that are not inside parentheses.
function splitSelectorList(raw: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of raw.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      selectors.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

// The cursor rule is the selector list directly before `{ @apply animate-pulse`.
function readCursorSelector(): string {
  const css = readFileSync(resolve(__dirname, "../tailwind.css"), "utf8");
  const bodyStart = css.indexOf("@apply animate-pulse");
  const ruleStart = css.lastIndexOf("}", bodyStart) + 1;
  const list = css.slice(ruleStart, css.indexOf("{", ruleStart));
  return splitSelectorList(list)
    .map((selector) => {
      expect(selector.endsWith("::after")).toBe(true);
      return selector.slice(0, -"::after".length);
    })
    .join(", ");
}

function renderStreaming(markdown: string): HTMLElement {
  const { container } = render(
    <div className="streaming-cursor">
      <MessageContent content={markdown} />
    </div>
  );
  return container;
}

function matches(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll(readCursorSelector()));
}

function expectSingleMatch(container: HTMLElement, tag: string, text: string): void {
  const found = matches(container);
  expect(found).toHaveLength(1);
  expect(found[0].tagName).toBe(tag);
  expect(found[0].textContent).toBe(text);
}

describe("streaming cursor selector", () => {
  afterEach(cleanup);

  it("is supported by jsdom (:has() evaluates without throwing)", () => {
    const container = renderStreaming("- a");
    expect(() => container.querySelectorAll("li:not(:has(> p))")).not.toThrow();
    expect(container.querySelectorAll("li:not(:has(> p))")).toHaveLength(1);
  });

  it("targets a plain trailing paragraph", () => {
    expectSingleMatch(renderStreaming("first\n\nlast words"), "P", "last words");
  });

  it("targets the last tight list item itself", () => {
    expectSingleMatch(renderStreaming("- alpha\n- beta"), "LI", "beta");
  });

  it("targets the paragraph, not the li, in a loose list", () => {
    const container = renderStreaming("- alpha\n\n- beta");
    expect(container.querySelector("li:last-child > p")).not.toBeNull();
    expectSingleMatch(container, "P", "beta");
  });

  it("targets the last paragraph of a loose item with two paragraphs", () => {
    expectSingleMatch(renderStreaming("- alpha\n\n- beta one\n\n  beta two"), "P", "beta two");
  });

  it("targets the deepest last item of a nested tight list", () => {
    expectSingleMatch(renderStreaming("- a\n- b\n  - c\n  - d"), "LI", "d");
  });

  it("targets the deepest last paragraph of a loose nested list", () => {
    expectSingleMatch(renderStreaming("- a\n\n- b\n\n  - c\n\n  - d"), "P", "d");
  });

  it("targets the last paragraph of a trailing blockquote", () => {
    expectSingleMatch(
      renderStreaming("intro\n\n> quoted one\n>\n> quoted two"),
      "P",
      "quoted two"
    );
  });

  it("targets a blockquote's last paragraph at the end of a list item", () => {
    expectSingleMatch(renderStreaming("- a\n\n- b\n\n  > quoted"), "P", "quoted");
  });

  it("does not match a trailing code block", () => {
    expect(matches(renderStreaming("intro\n\n```ts\nconst x = 1;\n```"))).toHaveLength(0);
  });

  it("does not match a list item ending in a code block", () => {
    expect(matches(renderStreaming("- a\n\n- b\n\n  ```ts\n  x\n  ```"))).toHaveLength(0);
  });

  it("matches nothing outside a .streaming-cursor wrapper", () => {
    const { container } = render(<MessageContent content="plain" />);
    expect(matches(container)).toHaveLength(0);
  });
});
