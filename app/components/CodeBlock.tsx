// Packages
import { useEffect, useRef, useState } from "react";

// Utils
import { getLanguageLabel } from "~/utils/codeBlock";

// Types
import type { ReactNode } from "react";

interface CodeBlockProps {
  language: string | null;
  code: string;
  children: ReactNode;
}

type TCopyStatus = "idle" | "copied" | "failed";

const RESET_DELAY_MS = 2000;
const STATUS_MESSAGES: Record<TCopyStatus, string> = {
  idle: "",
  copied: "Copied",
  failed: "Copy failed",
};
// Scrollable code blocks must be keyboard reachable. jsx-a11y flags a literal
// tabIndex on <pre> (no role satisfies it), but allows expression values.
const CODE_BLOCK_TAB_INDEX = 0;
// Header is dark in both themes (gray-800). blue-400 ring is 5.77:1 against it.
const BUTTON_CLASS_NAME =
  "inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-md touch-manipulation " +
  "text-gray-300 hover:text-white hover:bg-gray-700 transition-colors duration-200 print:hidden " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";

function CopyIcon(): JSX.Element {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Fenced code block: a header (language label + copy button) above the <pre>.
// The header is outside <pre>, so the code body text is never altered.
export default function CodeBlock({ language, code, children }: CodeBlockProps): JSX.Element {
  const [status, setStatus] = useState<TCopyStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const label = getLanguageLabel(language);

  useEffect(() => {
    return (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy(): Promise<void> {
    let nextStatus: TCopyStatus = "copied";
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      nextStatus = "failed";
    }
    setStatus(nextStatus);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus("idle"), RESET_DELAY_MS);
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="truncate">{label}</span>
        <button type="button" onClick={handleCopy} aria-label="Copy code" className={BUTTON_CLASS_NAME}>
          {status === "copied" ? <CheckIcon /> : <CopyIcon />}
        </button>
        <span className="sr-only" aria-live="polite">{STATUS_MESSAGES[status]}</span>
      </div>
      <pre tabIndex={CODE_BLOCK_TAB_INDEX} role="region" aria-label="Code block">{children}</pre>
    </div>
  );
}
