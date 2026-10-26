// Types
import type { Element, ElementContent } from "hast";

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
