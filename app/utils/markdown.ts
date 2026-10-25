// Types
import type { Element, ElementContent, Root, RootContent } from "hast";

const LANGUAGE_CLASS_PREFIX = "language-";

const LANGUAGE_LABELS: Record<string, string> = {
  js: "JavaScript", javascript: "JavaScript", node: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  ts: "TypeScript", typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  py: "Python", python: "Python", python3: "Python",
  sh: "Shell", bash: "Shell", shell: "Shell", zsh: "Shell", console: "Shell",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  sql: "SQL",
  yaml: "YAML", yml: "YAML",
  md: "Markdown", markdown: "Markdown",
  go: "Go", golang: "Go",
  rs: "Rust", rust: "Rust",
  java: "Java",
  c: "C",
  cpp: "C++", "c++": "C++", cc: "C++",
  cs: "C#", csharp: "C#", "c#": "C#",
  rb: "Ruby", ruby: "Ruby",
  php: "PHP",
  diff: "Diff", patch: "Diff",
};

// Display name for a fence language tag. Unknown tags are returned as written.
export function getLanguageLabel(tag: string | null): string | null {
  const trimmed = tag?.trim();
  if (!trimmed) return null;
  return Object.hasOwn(LANGUAGE_LABELS, trimmed.toLowerCase())
    ? LANGUAGE_LABELS[trimmed.toLowerCase()]
    : trimmed;
}

function collectText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  return node.type === "element" ? node.children.map(collectText).join("") : "";
}

export interface ICodeBlockInfo {
  language: string | null;
  code: string;
}

// Reads the fence language (`language-*` class on <code>) and the code body from
// the hast <pre> node. The body drops the single trailing newline the parser adds.
export function getCodeBlockInfo(pre: Element | undefined): ICodeBlockInfo {
  const codeElement = pre?.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  );
  if (!codeElement) return { language: null, code: "" };
  const classNames = codeElement.properties?.className;
  const languageClass = Array.isArray(classNames)
    ? classNames.find((name): name is string => typeof name === "string" && name.startsWith(LANGUAGE_CLASS_PREFIX))
    : undefined;
  const code = codeElement.children.map(collectText).join("");
  return {
    language: languageClass ? languageClass.slice(LANGUAGE_CLASS_PREFIX.length) : null,
    code: code.endsWith("\n") ? code.slice(0, -1) : code,
  };
}

const CITATION_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/y;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const LIST_MARKER = /^([-*+]|\d{1,9}[.)])( +|$)/;
const LABEL_SPECIAL_CHARS = /[\\*_`[\]<&]/g;

const BLOCK_ELEMENTS = new Set([
  "p", "ul", "ol", "li", "blockquote", "pre", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);
const VERBATIM_ELEMENTS = new Set(["pre", "code"]);

function escapeLabel(label: string): string {
  return label.replace(LABEL_SPECIAL_CHARS, (char) => `\\${char}`);
}

// Index just past the backtick run starting at `start`, plus a matching closing
// run of the same length, or -1 when the span is never closed.
function findCodeSpanEnd(text: string, start: number, runLength: number): number {
  let cursor = start + runLength;
  while (cursor < text.length) {
    if (text[cursor] !== "`") {
      cursor++;
      continue;
    }
    let end = cursor;
    while (text[end] === "`") end++;
    if (end - cursor === runLength) return end;
    cursor = end;
  }
  return -1;
}

function escapeLabelsOutsideFences(text: string): string {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      output += text.slice(index, index + 2);
      index += 2;
    } else if (char === "[") {
      CITATION_LINK.lastIndex = index;
      const match = CITATION_LINK.exec(text);
      if (match) {
        output += `[${escapeLabel(match[1])}](${match[2]})`;
        index += match[0].length;
      } else {
        output += char;
        index++;
      }
    } else if (char === "`") {
      let runEnd = index;
      while (text[runEnd] === "`") runEnd++;
      const spanEnd = findCodeSpanEnd(text, index, runEnd - index);
      const copyEnd = spanEnd === -1 ? runEnd : spanEnd;
      output += text.slice(index, copyEnd);
      index = copyEnd;
    } else {
      output += char;
      index++;
    }
  }
  return output;
}

interface IFence {
  marker: string;
  length: number;
}

// An open container: a blockquote, or a list item with its content offset
// (columns of indentation its continuation lines need, relative to the parent).
type TContainer = { kind: "quote" } | { kind: "list"; offset: number };

// Leading indentation in columns (tabs advance to the next multiple of 4).
function measureIndent(line: string): { indent: number; rest: string } {
  let indent = 0;
  let position = 0;
  while (position < line.length) {
    if (line[position] === " ") indent++;
    else if (line[position] === "\t") indent += 4 - (indent % 4);
    else break;
    position++;
  }
  return { indent, rest: line.slice(position) };
}

// Removes up to `columns` columns of leading whitespace.
function dropColumns(line: string, columns: number): string {
  let consumed = 0;
  let position = 0;
  while (position < line.length && consumed < columns) {
    if (line[position] === " ") consumed++;
    else if (line[position] === "\t") consumed += 4 - (consumed % 4);
    else break;
    position++;
  }
  return line.slice(position);
}

// Content offset of a list item whose marker starts at `indent`, or null when
// the line is not a list item. Per CommonMark, 5+ spaces after the marker (or
// nothing after it) mean the content offset is marker width + 1.
function listContentOffset(indent: number, rest: string): number | null {
  const match = LIST_MARKER.exec(rest);
  if (!match) return null;
  const markerWidth = match[1].length;
  const gap = match[2].length;
  const isBlankItem = rest.trim().length === markerWidth;
  return indent + markerWidth + (isBlankItem || gap > 4 ? 1 : gap);
}

// Text after a `>` marker (one optional space belongs to the marker).
function afterQuoteMarker(rest: string): string {
  const content = rest.slice(1);
  return content[0] === " " ? content.slice(1) : content;
}

// Consumes the prefixes of the open containers. Returns how many continue on
// this line and the remainder of the line after their prefixes.
function matchContainers(body: string, containers: TContainer[]): { matched: number; remainder: string } {
  let remainder = body;
  let matched = 0;
  for (const container of containers) {
    const { indent, rest } = measureIndent(remainder);
    if (container.kind === "quote") {
      if (indent > 3 || rest[0] !== ">") break;
      remainder = afterQuoteMarker(rest);
    } else if (rest === "") {
      remainder = "";
    } else if (indent >= container.offset) {
      remainder = dropColumns(remainder, container.offset);
    } else {
      break;
    }
    matched++;
  }
  return { matched, remainder };
}

function openFence(rest: string): IFence | null {
  const opening = FENCE_OPEN.exec(rest);
  if (!opening) return null;
  if (opening[1][0] === "`" && rest.slice(opening[1].length).includes("`")) return null;
  return { marker: opening[1][0], length: opening[1].length };
}

function closesFence(fence: IFence, remainder: string): boolean {
  const { indent, rest } = measureIndent(remainder);
  return indent <= 3 && new RegExp(`^${fence.marker}{${fence.length},}\\s*$`).test(rest);
}

// Persisted citations are written as `[label](url)` with the label verbatim, so
// labels such as `C:\` or `a*b*` would be misread as Markdown. Escape every label
// of that legacy shape so it renders literally and the link stays clickable.
// Fenced code blocks and inline code spans are left untouched.
//
// Containers follow CommonMark: list items (content offset) and blockquotes
// (`>` with up to 3 spaces of indent and one optional space after it, nestable).
// Each line first consumes the prefixes of the open containers; a non-blank line
// that cannot continue one ends it and everything nested in it, and an unclosed
// fence ends with its container. The remainder is then judged for a fence
// (0-3 spaces of relative indentation) and for new container markers, whose
// own remainder may open a fence (`- ```js`, `> ~~~js`, `> - ```js`).
// Known limitation: lazy continuation lines (`> text` followed by an unprefixed
// paragraph line) end the blockquote instead of continuing it.
export function escapeCitationLabels(content: string): string {
  const lines = content.split(/(?<=\n)/);
  let containers: TContainer[] = [];
  let output = "";
  let prose = "";
  let fence: IFence | null = null;

  const flushProse = (): void => {
    output += escapeLabelsOutsideFences(prose);
    prose = "";
  };

  for (const line of lines) {
    const body = line.replace(/\r?\n$/, "");
    const { matched, remainder } = matchContainers(body, containers);
    const isContinuing = matched === containers.length;

    if (fence && isContinuing) {
      output += line;
      if (closesFence(fence, remainder)) fence = null;
      continue;
    }
    fence = null;
    containers = containers.slice(0, matched);

    let current = remainder;
    let opened: IFence | null = null;
    for (;;) {
      const { indent, rest } = measureIndent(current);
      if (indent > 3 || rest === "") break;
      if (rest[0] === ">") {
        containers.push({ kind: "quote" });
        current = afterQuoteMarker(rest);
        continue;
      }
      opened = openFence(rest);
      if (opened) break;
      const offset = listContentOffset(indent, rest);
      if (offset === null) break;
      containers.push({ kind: "list", offset });
      const markerWidth = (LIST_MARKER.exec(rest) ?? ["", ""])[1].length;
      current = dropColumns(rest.slice(markerWidth), offset - indent - markerWidth);
    }

    if (opened) {
      flushProse();
      output += line;
      fence = opened;
    } else {
      prose += line;
    }
  }
  flushProse();
  return output;
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
