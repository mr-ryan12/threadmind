// @vitest-environment jsdom

// Packages
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Components
import MessageContent from "./MessageContent";

afterEach(cleanup);

function renderContent(content: string): HTMLElement {
  return render(<MessageContent content={content} />).container;
}

// Text nodes that are whitespace-only and sit beside a block element.
function findStructuralWhitespace(root: HTMLElement): Node[] {
  const blocks = new Set(["P", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "HR", "H3", "H4", "H5", "H6"]);
  const isBlock = (node: Node | null): boolean => node instanceof HTMLElement && blocks.has(node.tagName);
  const found: Node[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("pre, code")) continue;
    if ((node.textContent ?? "").trim() !== "") continue;
    if (isBlock(node.previousSibling) || isBlock(node.nextSibling)) found.push(node);
  }
  return found;
}

describe("message citation links", () => {
  it("renders persisted inline citations as safe clickable links", () => {
    render(<MessageContent content="Answer. [Official source](https://example.com/page) Done." />);
    const link = screen.getByRole("link", { name: "Official source" });
    expect(link).toHaveAttribute("href", "https://example.com/page");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.parentElement?.tagName).toBe("P");
    expect(link.parentElement).toHaveTextContent("Answer. Official source Done.");
  });

  it("renders a citation with a percent-encoded href and is keyboard focusable", () => {
    render(<MessageContent content="[Doc](https://example.com/a%28b%29)" />);
    const link = screen.getByRole("link", { name: "Doc" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://example.com/a%28b%29");
    link.focus();
    expect(link).toHaveFocus();
  });

  it.each([
    ["Windows C:\\", "[Windows C:\\](https://example.com/w)"],
    ["a*b*", "[a*b*](https://example.com/w)"],
    ["snake_case_", "[snake_case_](https://example.com/w)"],
    ["a`b", "[a`b](https://example.com/w)"],
    ["\\*", "[\\*](https://example.com/w)"],
  ])("renders the citation label %s literally as a link", (label, content) => {
    const container = renderContent(content);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent(label);
    expect(link.textContent).toBe(label);
    expect(link).toHaveAttribute("href", "https://example.com/w");
    expect(container.querySelector("em, strong, code")).toBeNull();
  });

  it.each([
    ["Research &copy; 2024", "[Research &copy; 2024](https://example.com)"],
    ["Research &#169; 2024", "[Research &#169; 2024](https://example.com)"],
  ])("renders HTML entities in the label %s literally", (label, content) => {
    renderContent(content);
    const link = screen.getByRole("link");
    expect(link.textContent).toBe(label);
    expect(link).toHaveAttribute("href", "https://example.com/");
  });

  it("links a citation that follows a top-level 4-space-indented fence line", () => {
    renderContent("    ```\n[Windows C:\\](https://example.com)");
    const link = screen.getByRole("link");
    expect(link.textContent).toBe("Windows C:\\");
    expect(link).toHaveAttribute("href", "https://example.com/");
  });

  it("leaves a fence inside a list item untouched and links the citation after it", () => {
    const container = renderContent(
      "- item\n\n    ```js\n    [a*](https://e.com)\n    ```\n\n[Windows C:\\](https://example.com)",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link").textContent).toBe("Windows C:\\");
    expect(container.querySelector("pre")?.textContent).toContain("[a*](https://e.com)");
  });

  it("leaves link-like text in code untouched", () => {
    const container = renderContent("`[a*](https://e.com)`\n\n```\n[b*](https://e.com)\n```");
    expect(screen.queryByRole("link")).toBeNull();
    const codes = container.querySelectorAll("code");
    expect(codes[0].textContent).toBe("[a*](https://e.com)");
    expect(codes[1].textContent).toBe("[b*](https://e.com)\n");
  });

  it("keeps HTML and unsafe or unfinished links as text", () => {
    const content = "<script>alert(1)</script> [bad](javascript:alert(1)) [unfinished](https://";
    const container = renderContent(content);
    expect(container).toHaveTextContent(content);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("markdown elements", () => {
  it("renders the resume sample with semantic bold and no delimiters", () => {
    const container = renderContent("Based on the resume, **strong candidate** for the role.");
    expect(container.querySelector("strong")).toHaveTextContent("strong candidate");
    expect(container.textContent).not.toContain("**");
  });

  it("renders emphasis", () => {
    const container = renderContent("*one* and _two_");
    const items = container.querySelectorAll("em");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("one");
    expect(items[1]).toHaveTextContent("two");
  });

  it("shifts heading levels down two", () => {
    renderContent("# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6");
    const levels = screen.getAllByRole("heading").map((heading) => heading.tagName);
    expect(levels).toEqual(["H3", "H4", "H5", "H6", "H6", "H6"]);
    expect(screen.getByRole("heading", { name: "H1", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "H2", level: 4 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "H3", level: 5 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "H6", level: 6 })).toBeInTheDocument();
  });

  it("renders unordered and ordered lists", () => {
    const container = renderContent("- a\n- b\n\n1. c\n2. d");
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("renders blockquotes", () => {
    const container = renderContent("> quoted");
    expect(container.querySelector("blockquote")).toHaveTextContent("quoted");
  });

  it("renders inline code outside of pre", () => {
    const container = renderContent("use `x` here");
    const code = container.querySelector("code");
    expect(code).toHaveTextContent("x");
    expect(code?.closest("pre")).toBeNull();
  });

  it("renders fenced code with exact whitespace and a focusable pre", () => {
    const body = "function f() {\n    return 1;\n\n  }\n";
    const container = renderContent("```ts\n" + body + "```");
    const code = container.querySelector("pre > code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe(body);
    expect(container.querySelector("pre")).toHaveAttribute("tabindex", "0");
    expect(container.textContent).not.toContain("ts\n");
  });
});

describe("unsafe content", () => {
  it("never creates script, img or anchor elements or on* attributes from HTML", () => {
    const content =
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<a href="javascript:alert(1)">x</a>';
    const container = renderContent(content);
    expect(container.querySelector("script, img, a")).toBeNull();
    for (const el of Array.from(container.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) expect(attr.name.startsWith("on")).toBe(false);
    }
  });

  it.each([
    "[x](javascript:alert(1))",
    "[x](data:text/html,<b>hi</b>)",
    "[x](/api/logout)",
  ])("renders %s as plain text without a link", (content) => {
    const container = renderContent(content);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container).toHaveTextContent("x");
  });

  it("allows mailto links without target", () => {
    renderContent("[mail](mailto:a@b.c)");
    const link = screen.getByRole("link", { name: "mail" });
    expect(link).toHaveAttribute("href", "mailto:a@b.c");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).not.toHaveAttribute("target");
  });

  it("replaces images with their alt text", () => {
    const container = renderContent("![alt text](https://tracker.example/p.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("alt text");
  });

  it("renders nothing for an image without alt text", () => {
    const container = renderContent("![](https://tracker.example/p.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("");
  });
});

describe("whitespace handling", () => {
  it.each([
    ["tight list", "- a\n- b\n- c"],
    ["nested list", "- a\n  - b\n    - c\n- d"],
    ["loose list", "- a\n\n- b\n\n- c"],
    ["multi-paragraph list item", "- a\n\n  more\n\n- b"],
    ["ordered nested", "1. a\n   - b\n2. c"],
    ["blockquote", "> a\n>\n> b\n\n> c"],
    ["mixed blocks", "# T\n\ntext\n\n- a\n\n> q\n\n```\ncode\n```"],
  ])("leaves no structural whitespace nodes in a %s", (_name, content) => {
    const container = renderContent(content);
    expect(findStructuralWhitespace(container)).toEqual([]);
  });

  it("keeps the space between adjacent bold phrases in a paragraph", () => {
    const container = renderContent("**hello** **world**");
    expect(container.querySelector("p")?.textContent).toBe("hello world");
  });

  it("keeps the space between adjacent bold phrases in a list item", () => {
    const container = renderContent("- **hello** **world**");
    expect(container.querySelector("li")?.textContent).toBe("hello world");
  });

  it("keeps a soft break between formatted elements", () => {
    const container = renderContent("**hello**\n**world**");
    expect(container.querySelector("p")?.textContent).toBe("hello\nworld");
  });

  it("keeps a soft break inside a list item", () => {
    const container = renderContent("- a\n  b");
    expect(container.querySelector("li")?.textContent).toBe("a\nb");
  });

  it("keeps a single space inside an inline code span", () => {
    const container = renderContent("x `` ` `` y\n\na `  ` b");
    const codes = container.querySelectorAll("code");
    expect(codes.length).toBeGreaterThan(0);
    for (const code of Array.from(codes)) expect(code.textContent).not.toBe("");
  });

  it("keeps a fenced block that contains only spaces and blank lines", () => {
    const container = renderContent("```\n   \n\n  \n```");
    expect(container.querySelector("pre > code")?.textContent).toBe("   \n\n  \n");
  });
});

describe("fences opened inside containers", () => {
  it.each([
    ["- ```js\n  [a*](https://e.com)\n  ```", "[a*](https://e.com)"],
    ["> ~~~js\n> [a*](https://e.com)\n> ~~~", "[a*](https://e.com)"],
    ["1. ~~~\n   [a*](https://e.com)\n   ~~~", "[a*](https://e.com)"],
  ])("preserves code text exactly and still links a later citation: %j", (block, code) => {
    const container = renderContent(`${block}\n\n[Windows C:\\](https://example.com)`);
    expect(container.querySelector("pre > code")?.textContent).toBe(`${code}\n`);
    const link = screen.getByRole("link", { name: "Windows C:\\" });
    expect(link).toHaveAttribute("href", "https://example.com/");
  });

  it("links a citation after an unclosed fence in a blockquote has ended", () => {
    const container = renderContent("> ~~~js\n> [a*](https://e.com)\n[Windows C:\\](https://example.com)");
    expect(container.querySelector("pre > code")?.textContent).toBe("[a*](https://e.com)\n");
    expect(screen.getByRole("link", { name: "Windows C:\\" })).toBeInTheDocument();
  });
});

describe("unfinished markdown", () => {
  it.each([
    ["**bold", ["bold"]],
    ["[label](https://", ["label", "https://"]],
    ["- ", []],
    ["#", []],
    ["_ital", ["ital"]],
    ["> ", []],
    ["1.", []],
  ])("renders %j without throwing and keeps its words", (content, words) => {
    const container = renderContent(content);
    for (const word of words) expect(container.textContent).toContain(word);
  });

  it("retains the code body of an unclosed fence and drops the language tag", () => {
    const container = renderContent("```js\nconst a = 1");
    expect(container.querySelector("pre > code")?.textContent).toContain("const a = 1");
    expect(container.textContent).not.toContain("js");
  });

  it("renders every prefix of a mixed Markdown fixture without throwing", () => {
    const fixture = [
      "# Title",
      "Based on **strong** and *soft* `code` text.",
      "- one\n  - nested **b**\n- two",
      "1. first\n2. second",
      "> quote [Source*](https://example.com/a%28b%29)",
      "```ts\nconst a = 1;\n\n  return a;\n```",
      "![alt](https://x.example/p.png) <b>raw</b> [x](javascript:alert(1))",
    ].join("\n\n");
    for (let end = 0; end <= fixture.length; end++) {
      expect(() => {
        const { unmount } = render(<MessageContent content={fixture.slice(0, end)} />);
        unmount();
      }).not.toThrow();
    }
  });
});

describe("code block header", () => {
  it("renders the language label above a code body that is unchanged", () => {
    const container = renderContent("```js\n  const a = 1;\n\nreturn a;\n```");
    expect(screen.getByText("JavaScript")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
    expect(container.querySelector("pre > code")?.textContent).toBe("  const a = 1;\n\nreturn a;\n");
    expect(screen.getByText("JavaScript").closest("pre")).toBeNull();
  });

  it("omits the label for a fence without a tag", () => {
    const container = renderContent("```\nplain\n```");
    expect(screen.queryByText("JavaScript")).toBeNull();
    expect(container.querySelector(".code-block-header span.truncate")).toBeEmptyDOMElement();
    expect(container.querySelector("pre > code")?.textContent).toBe("plain\n");
  });
});
