// Types
import type { Element, ElementContent, Root, RootContent } from "hast";
import type { Link, Root as MdastRoot, Content as MdastContent, Text } from "mdast";
import type { VFile } from "vfile";

const BLOCK_ELEMENTS = new Set([
  "p", "ul", "ol", "li", "blockquote", "pre", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);
const VERBATIM_ELEMENTS = new Set(["pre", "code"]);

// Legacy citation shape written by formatResponseText: `[label](http(s)-url)`.
const LEGACY_CITATION_SOURCE = "\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)";
const LEGACY_CITATION_EXACT = new RegExp(`^${LEGACY_CITATION_SOURCE}$`);
const HTTP_URL = /^https?:\/\//;

type TMdastParent = Extract<MdastContent | MdastRoot, { children: MdastContent[] }>;

function sliceSource(node: MdastContent, source: string): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || end < start) return null;
  return source.slice(start, end);
}

function createLiteralLink(url: string, label: string): Link {
  return { type: "link", url, children: [{ type: "text", value: label }] };
}

function isEscapedAt(raw: string, index: number): boolean {
  let backslashes = 0;
  while (raw[index - 1 - backslashes] === "\\") backslashes++;
  return backslashes % 2 === 1;
}

function findLegacyMatches(text: string, skipEscaped: boolean): RegExpMatchArray[] {
  const matches = Array.from(text.matchAll(new RegExp(LEGACY_CITATION_SOURCE, "g")));
  return skipEscaped ? matches.filter((match) => !isEscapedAt(text, match.index ?? 0)) : matches;
}

// Rebuilds a text node that holds legacy citations the parser did not link (for
// example a label ending in a backslash, where `\]` escapes the bracket). Returns
// null when the node has no citation, so it stays untouched.
//
// The surrounding prose comes from the node's decoded `value` (entities, escapes
// and container prefixes already resolved by the parser); the raw source slice
// only supplies the literal label and url. Matches are found in both and paired
// by order. If the counts or any url differ, the node is left untouched.
//
// Known limitation: a label that is split across sibling nodes, such as
// `[a*b* C:\](https://example.com)` (text `[a`, emphasis, text ` C:](...)`), is
// not repaired because only a single text node is rewritten. It renders as the
// plain text `[ab C:](https://example.com)`: no link, and the asterisks and
// backslash are consumed. This needs a label that ends in a backslash AND has
// formatting characters, so it is accepted as rare. Likewise, a citation whose
// url contains formatting (for example `*x*`) spans several nodes and is skipped.
function rebuildTextNode(node: Text, source: string): MdastContent[] | null {
  const raw = sliceSource(node, source);
  if (raw === null) return null;
  const rawMatches = findLegacyMatches(raw, true);
  if (rawMatches.length === 0) return null;
  const valueMatches = findLegacyMatches(node.value, false);
  if (valueMatches.length !== rawMatches.length) return null;
  if (valueMatches.some((match, i) => match[2] !== rawMatches[i][2])) return null;
  const parts: MdastContent[] = [];
  let cursor = 0;
  const pushText = (segment: string): void => {
    if (segment !== "") parts.push({ type: "text", value: segment });
  };
  valueMatches.forEach((match, i) => {
    const index = match.index ?? 0;
    pushText(node.value.slice(cursor, index));
    parts.push(createLiteralLink(rawMatches[i][2], rawMatches[i][1]));
    cursor = index + match[0].length;
  });
  pushText(node.value.slice(cursor));
  return parts;
}

function rewriteCitations(parent: TMdastParent, source: string): void {
  const rewritten: MdastContent[] = [];
  for (const child of parent.children) {
    if (child.type === "link") {
      const raw = sliceSource(child, source);
      const match = raw === null ? null : LEGACY_CITATION_EXACT.exec(raw);
      if (match && HTTP_URL.test(child.url)) child.children = [{ type: "text", value: match[1] }];
      rewritten.push(child);
    } else if (child.type === "text") {
      rewritten.push(...(rebuildTextNode(child, source) ?? [child]));
    } else {
      if ("children" in child) rewriteCitations(child as TMdastParent, source);
      rewritten.push(child);
    }
  }
  parent.children = rewritten;
}

// Persisted citations are written as `[label](url)` with the label verbatim, so
// labels such as `C:\` or `a*b*` would be misread as Markdown. After parsing, show
// the raw source label literally and keep the link clickable. Only link and text
// nodes are touched, so code (fenced, indented, inline) and HTML stay exactly as
// written. Links with titles, angle-bracket or non-http(s) destinations and
// reference links are not legacy-shaped and are left alone.
export function remarkLiteralCitationLabels(): (tree: MdastRoot, file: VFile) => void {
  return (tree: MdastRoot, file: VFile): void => {
    try {
      rewriteCitations(tree, String(file.value));
    } catch {
      // Never fail rendering over a cosmetic normalization.
    }
  };
}

function isBlockElement(node: ElementContent | RootContent | undefined): boolean {
  return node?.type === "element" && BLOCK_ELEMENTS.has(node.tagName);
}

function stripFromChildren(parent: Root | Element): void {
  if (parent.type === "element" && VERBATIM_ELEMENTS.has(parent.tagName)) return;
  const children = parent.children as Array<ElementContent | RootContent>;
  const kept = children.filter((child, position) => {
    if (child.type !== "text" || child.value.trim() !== "") return true;
    return !(isBlockElement(children[position - 1]) || isBlockElement(children[position + 1]));
  });
  parent.children = kept as typeof parent.children;
  for (const child of kept) {
    if (child.type === "element") stripFromChildren(child);
  }
}

// The parser emits "\n" text nodes between block children (for example inside a
// list item). With `white-space: pre-wrap` on p/li they would render as blank
// gaps, so drop whitespace-only text that sits next to a block element. Inline
// whitespace and anything inside pre/code is preserved.
export function rehypeStripStructuralWhitespace(): (tree: Root) => void {
  return (tree: Root): void => stripFromChildren(tree);
}
