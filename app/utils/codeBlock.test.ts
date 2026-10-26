// Packages
import { describe, expect, it } from "vitest";

// Utils
import { getCodeBlockInfo, getLanguageLabel } from "./codeBlock";

// Types
import type { Element } from "hast";

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
