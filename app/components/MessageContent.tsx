// Packages
import ReactMarkdown from "react-markdown";

// Utils
import { escapeCitationLabels, getCodeBlockInfo, rehypeStripStructuralWhitespace } from "~/utils/markdown";

// Components
import CodeBlock from "./CodeBlock";

// Types
import type { PropsWithChildren } from "react";
import type { Components } from "react-markdown";

interface MessageContentProps {
  content: string;
}

type TShiftedHeading = "h3" | "h4" | "h5" | "h6";

const LINK_CLASS_NAME =
  "text-blue-600 dark:text-blue-300 underline break-words rounded focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors duration-200";
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

// Only absolute http(s) and mailto URLs may become active links.
function toSafeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

// The page already owns the h1/h2 levels, so message headings start at h3.
function shiftHeading(Tag: TShiftedHeading): NonNullable<Components["h1"]> {
  return function ShiftedHeading({ children }: PropsWithChildren): JSX.Element {
    return <Tag>{children}</Tag>;
  };
}

const components: Components = {
  h1: shiftHeading("h3"),
  h2: shiftHeading("h4"),
  h3: shiftHeading("h5"),
  h4: shiftHeading("h6"),
  h5: shiftHeading("h6"),
  h6: shiftHeading("h6"),
  a({ href, children }): JSX.Element {
    if (!href) return <span>{children}</span>;
    const opensTab = href.startsWith("http");
    return (
      <a
        href={href}
        target={opensTab ? "_blank" : undefined}
        rel="noopener noreferrer"
        className={LINK_CLASS_NAME}
      >
        {children}
      </a>
    );
  },
  // Images would make the reader's browser fetch arbitrary third-party URLs.
  img({ alt }): JSX.Element | null {
    return alt ? <span>{alt}</span> : null;
  },
  pre({ node, children }): JSX.Element {
    const { language, code } = getCodeBlockInfo(node);
    return <CodeBlock language={language} code={code}>{children}</CodeBlock>;
  },
};

// Render assistant Markdown as React elements. Raw HTML is never interpreted
// (no rehype-raw) and only http(s)/mailto links are active.
export default function MessageContent({ content }: MessageContentProps): JSX.Element {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        urlTransform={toSafeUrl}
        rehypePlugins={[rehypeStripStructuralWhitespace]}
        components={components}
      >
        {escapeCitationLabels(content)}
      </ReactMarkdown>
    </div>
  );
}
