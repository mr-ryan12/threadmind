import type { ReactNode } from "react";

interface MessageContentProps {
  content: string;
}

// Render the persisted citation links without interpreting arbitrary HTML.
export default function MessageContent({ content }: MessageContentProps) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index;
    let href: string;
    try {
      const url = new URL(match[2]);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      href = url.href;
    } catch {
      continue;
    }
    parts.push(content.slice(cursor, index));
    parts.push(
      <a
        key={index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 dark:text-blue-400 underline break-words rounded focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors duration-200"
      >
        {match[1]}
      </a>,
    );
    cursor = index + match[0].length;
  }
  parts.push(content.slice(cursor));
  return <>{parts}</>;
}
