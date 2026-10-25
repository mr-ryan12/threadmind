// Packages
import { describe, expect, it } from "vitest";

// Utils
import { escapeCitationLabels, getCodeBlockInfo, getLanguageLabel, rehypeStripStructuralWhitespace } from "./markdown";

// Types
import type { Element, ElementContent, Root } from "hast";

describe("escapeCitationLabels", () => {
  it("leaves ordinary citations unchanged", () => {
    const content = "See [Official source](https://example.com/a%28b%29) now.";
    expect(escapeCitationLabels(content)).toBe(content);
  });

  it("escapes backslashes before other special characters", () => {
    expect(escapeCitationLabels("[Windows C:\\](https://e.com)")).toBe(
      "[Windows C:\\\\](https://e.com)",
    );
    expect(escapeCitationLabels("[\\*](https://e.com)")).toBe("[\\\\\\*](https://e.com)");
  });

  it("escapes emphasis, backtick, bracket and angle characters in labels", () => {
    expect(escapeCitationLabels("[a*b*](https://e.com)")).toBe("[a\\*b\\*](https://e.com)");
    expect(escapeCitationLabels("[snake_case_](https://e.com)")).toBe(
      "[snake\\_case\\_](https://e.com)",
    );
    expect(escapeCitationLabels("[a`b](https://e.com)")).toBe("[a\\`b](https://e.com)");
    expect(escapeCitationLabels("[a [b<c](https://e.com)")).toBe("[a \\[b\\<c](https://e.com)");
  });

  it("escapes every citation in the text", () => {
    expect(escapeCitationLabels("[a*](https://x.com) and [b_](http://y.com)")).toBe(
      "[a\\*](https://x.com) and [b\\_](http://y.com)",
    );
  });

  it("ignores non-http(s) and unfinished links", () => {
    for (const content of ["[a*](javascript:alert(1))", "[a*](/relative)", "[a*](https://", "[a*]"]) {
      expect(escapeCitationLabels(content)).toBe(content);
    }
  });

  it("does not alter link-like text in fenced code blocks", () => {
    const content = "Before\n```md\n[a*](https://e.com)\n```\nAfter [b*](https://e.com)";
    expect(escapeCitationLabels(content)).toBe(
      "Before\n```md\n[a*](https://e.com)\n```\nAfter [b\\*](https://e.com)",
    );
  });

  it("treats an unclosed fence as code until the end", () => {
    const content = "```\n[a*](https://e.com)";
    expect(escapeCitationLabels(content)).toBe(content);
  });

  it("supports tilde fences and longer closing fences", () => {
    const content = "~~~\n[a*](https://e.com)\n~~~~\n[b*](https://e.com)";
    expect(escapeCitationLabels(content)).toBe("~~~\n[a*](https://e.com)\n~~~~\n[b\\*](https://e.com)");
  });

  it("does not alter link-like text in inline code spans", () => {
    const content = "Use `[a*](https://e.com)` and ``[b*](https://e.com)`` here";
    expect(escapeCitationLabels(content)).toBe(content);
  });

  it("does not treat an escaped bracket as a citation", () => {
    const content = "\\[a*](https://e.com)";
    expect(escapeCitationLabels(content)).toBe(content);
  });

  it("escapes ampersands so HTML entities in labels stay literal", () => {
    expect(escapeCitationLabels("[Research &copy; 2024](https://e.com)")).toBe(
      "[Research \\&copy; 2024](https://e.com)",
    );
    expect(escapeCitationLabels("[R &#169;](https://e.com)")).toBe("[R \\&#169;](https://e.com)");
  });

  it("does not treat a top-level 4-space-indented fence as a fence", () => {
    expect(escapeCitationLabels("    ```\n[Windows C:\\](https://example.com)")).toBe(
      "    ```\n[Windows C:\\\\](https://example.com)",
    );
  });

  it("keeps a fence indented within a list item and normalizes after the item ends", () => {
    const content = "- item\n\n    ```js\n    [a*](https://e.com)\n    ```\n\n[Windows C:\\](https://example.com)";
    expect(escapeCitationLabels(content)).toBe(
      "- item\n\n    ```js\n    [a*](https://e.com)\n    ```\n\n[Windows C:\\\\](https://example.com)",
    );
  });

  it("handles a fence inside an ordered list item with a 3-space content offset", () => {
    const content = "1. item\n\n    ```\n    [a*](https://e.com)\n    ```\n\n[b*](https://e.com)";
    expect(escapeCitationLabels(content)).toBe(
      "1. item\n\n    ```\n    [a*](https://e.com)\n    ```\n\n[b\\*](https://e.com)",
    );
  });

  it("ends a fence when its list item ends", () => {
    const content = "- item\n  ```\n  [a*](https://e.com)\nafter [b*](https://e.com)";
    expect(escapeCitationLabels(content)).toBe(
      "- item\n  ```\n  [a*](https://e.com)\nafter [b\\*](https://e.com)",
    );
  });

  it("treats an indented fence after the list ended as indented code", () => {
    const content = "- item\n\ntext\n\n    ```\n[b*](https://e.com)";
    expect(escapeCitationLabels(content)).toBe("- item\n\ntext\n\n    ```\n[b\\*](https://e.com)");
  });

  const LATER = "[Windows C:\\](https://example.com)";
  const LATER_NORMALIZED = "[Windows C:\\\\](https://example.com)";

  it.each([
    ["- ```js\n  [a*](https://e.com)\n  ```"],
    ["1. ~~~\n   [a*](https://e.com)\n   ~~~"],
    ["> ~~~js\n> [a*](https://e.com)\n> ~~~"],
    ["> - ```js\n>   [a*](https://e.com)\n>   ```"],
    ["- > ```js\n  > [a*](https://e.com)\n  > ```"],
    ["> > ```\n> > [a*](https://e.com)\n> > ```"],
  ])("keeps a fence opened on a container marker line verbatim: %j", (block) => {
    expect(escapeCitationLabels(`${block}\n\n${LATER}`)).toBe(`${block}\n\n${LATER_NORMALIZED}`);
  });

  it("ends an unclosed fence in a blockquote at the first unprefixed line", () => {
    expect(escapeCitationLabels(`> ~~~js\n> [a*](https://e.com)\n${LATER}`)).toBe(
      `> ~~~js\n> [a*](https://e.com)\n${LATER_NORMALIZED}`,
    );
  });

  it("ends an unclosed fence in a blockquote at a blank line", () => {
    expect(escapeCitationLabels(`> \`\`\`\n> [a*](https://e.com)\n\n${LATER}`)).toBe(
      `> \`\`\`\n> [a*](https://e.com)\n\n${LATER_NORMALIZED}`,
    );
  });

  it("ends an unclosed fence on a list marker line at a dedented line", () => {
    expect(escapeCitationLabels(`- \`\`\`js\n  [a*](https://e.com)\n${LATER}`)).toBe(
      `- \`\`\`js\n  [a*](https://e.com)\n${LATER_NORMALIZED}`,
    );
  });

  it("keeps blank lines inside a fence in a list item", () => {
    const content = "- ```\n  [a*](https://e.com)\n\n  [b*](https://e.com)\n  ```\n[c*](https://e.com)";
    expect(escapeCitationLabels(content)).toBe(
      "- ```\n  [a*](https://e.com)\n\n  [b*](https://e.com)\n  ```\n[c\\*](https://e.com)",
    );
  });

  it("normalizes citations in blockquote and list prose", () => {
    expect(escapeCitationLabels(`> ${LATER}`)).toBe(`> ${LATER_NORMALIZED}`);
    expect(escapeCitationLabels(`> - ${LATER}`)).toBe(`> - ${LATER_NORMALIZED}`);
    expect(escapeCitationLabels(`- ${LATER}`)).toBe(`- ${LATER_NORMALIZED}`);
  });

  it("does not open a fence after a blockquote ended and the line is indented code", () => {
    expect(escapeCitationLabels("> q\n\n    ```\n[b*](https://e.com)")).toBe(
      "> q\n\n    ```\n[b\\*](https://e.com)",
    );
  });

  it("does not treat a blockquote marker indented 4+ spaces as a quote", () => {
    expect(escapeCitationLabels("    > ```\n[b*](https://e.com)")).toBe(
      "    > ```\n[b\\*](https://e.com)",
    );
  });

  it("returns an empty string unchanged", () => {
    expect(escapeCitationLabels("")).toBe("");
  });
});

function text(value: string): ElementContent {
  return { type: "text", value };
}

function element(tagName: string, children: ElementContent[] = []): Element {
  return { type: "element", tagName, properties: {}, children };
}

function run(children: Root["children"]): Root {
  const tree: Root = { type: "root", children };
  rehypeStripStructuralWhitespace()(tree);
  return tree;
}

describe("rehypeStripStructuralWhitespace", () => {
  it("removes whitespace-only text between block siblings", () => {
    const tree = run([text("\n"), element("p"), text("\n"), element("ul"), text("\n")] as Root["children"]);
    expect(tree.children.map((child) => child.type)).toEqual(["element", "element"]);
  });

  it("cleans list item children recursively", () => {
    const nested = element("li", [text("\n"), element("p", [text("a")]), text("\n"), element("ul", [text("\n"), element("li", [text("b")]), text("\n")]), text("\n")]);
    const tree = run([element("ul", [text("\n"), nested, text("\n")])]);
    const list = tree.children[0] as Element;
    expect(list.children).toHaveLength(1);
    const item = list.children[0] as Element;
    expect(item.children.map((child) => (child.type === "element" ? child.tagName : "text"))).toEqual(["p", "ul"]);
    const inner = item.children[1] as Element;
    expect(inner.children).toHaveLength(1);
  });

  it("preserves whitespace between inline siblings", () => {
    const paragraph = element("p", [element("strong", [text("a")]), text(" "), element("strong", [text("b")])]);
    run([paragraph]);
    expect(paragraph.children).toHaveLength(3);
    expect((paragraph.children[1] as { value: string }).value).toBe(" ");
  });

  it("preserves a soft break between inline elements", () => {
    const paragraph = element("p", [element("strong", [text("a")]), text("\n"), element("strong", [text("b")])]);
    run([paragraph]);
    expect(paragraph.children).toHaveLength(3);
  });

  it("preserves soft breaks inside text", () => {
    const item = element("li", [text("a\nb")]);
    run([item]);
    expect((item.children[0] as { value: string }).value).toBe("a\nb");
  });

  it("does not remove a whitespace-only first or last child just for its position", () => {
    const paragraph = element("p", [text(" "), element("em", [text("x")]), text(" ")]);
    run([paragraph]);
    expect(paragraph.children).toHaveLength(3);
  });

  it("leaves pre and code subtrees untouched", () => {
    const inline = element("code", [text(" ")]);
    const block = element("pre", [element("code", [text("  \n\n  ")])]);
    const paragraph = element("p", [inline]);
    run([paragraph, text("\n"), block]);
    expect(inline.children).toHaveLength(1);
    const blockCode = block.children[0] as Element;
    expect((blockCode.children[0] as { value: string }).value).toBe("  \n\n  ");
  });

  it("keeps a whitespace-only code body even when code sits beside a block", () => {
    const code = element("code", [text(" "), element("pre", [text(" ")])]);
    run([code]);
    expect(code.children).toHaveLength(2);
  });
});

describe("getLanguageLabel", () => {
  it("maps aliases case-insensitively", () => {
    expect(getLanguageLabel("js")).toBe("JavaScript");
    expect(getLanguageLabel("TS")).toBe("TypeScript");
    expect(getLanguageLabel("py")).toBe("Python");
    expect(getLanguageLabel("Bash")).toBe("Shell");
    expect(getLanguageLabel("c++")).toBe("C++");
  });

  it("returns an unknown tag as written", () => {
    expect(getLanguageLabel("weirdlang")).toBe("weirdlang");
    expect(getLanguageLabel("constructor")).toBe("constructor");
  });

  it("returns null for empty or missing tags", () => {
    expect(getLanguageLabel("")).toBeNull();
    expect(getLanguageLabel("  ")).toBeNull();
    expect(getLanguageLabel(null)).toBeNull();
  });
});

describe("getCodeBlockInfo", () => {
  function preNode(className: string[] | undefined, text: string): Element {
    return {
      type: "element",
      tagName: "pre",
      properties: {},
      children: [{
        type: "element",
        tagName: "code",
        properties: className ? { className } : {},
        children: [{ type: "text", value: text }],
      }],
    };
  }

  it("reads the language and strips one trailing newline", () => {
    expect(getCodeBlockInfo(preNode(["language-js"], "a\n\n"))).toEqual({ language: "js", code: "a\n" });
  });

  it("returns a null language without a language class", () => {
    expect(getCodeBlockInfo(preNode(undefined, "x\n"))).toEqual({ language: null, code: "x" });
  });

  it("handles a missing node", () => {
    expect(getCodeBlockInfo(undefined)).toEqual({ language: null, code: "" });
  });
});
