// Packages
import { describe, expect, it } from "vitest";

// Utils
import { rehypeStripStructuralWhitespace } from "./markdown";

// Types
import type { Element, ElementContent, Root } from "hast";

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
