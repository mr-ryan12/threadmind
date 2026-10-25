// Packages
import { getOpenAIClient, TITLE_MODEL } from "~/server/openai.server";

// Utils
import { logger } from "~/server/utils/logger";

// Cap the stored title. The sidebar CSS-truncates to one line, so this is just a
// sanity bound on what we persist (an ill-behaved model could return a paragraph).
const TITLE_MAX_LENGTH = 60;
// Deterministic fallback length, matching the prior behavior of this feature.
const FALLBACK_MAX_LENGTH = 50;

const TITLE_SYSTEM_PROMPT =
  "You generate short titles for chat conversations. Reply with a concise " +
  "3-6 word title summarizing the user's message. No quotes, no trailing " +
  "punctuation, and no prefixes like 'Title:'.";

// Deterministic fallback used when the model call fails or returns nothing
// usable: the first message hard-truncated (the original title behavior).
function truncateFallback(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > FALLBACK_MAX_LENGTH
    ? trimmed.substring(0, FALLBACK_MAX_LENGTH) + "..."
    : trimmed;
}

// Normalize a raw model title: drop wrapping quotes, trailing punctuation, and
// collapse whitespace, then bound the length. Returns "" if nothing survives.
function sanitizeTitle(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?,;:\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > TITLE_MAX_LENGTH
    ? cleaned.substring(0, TITLE_MAX_LENGTH).trim() + "..."
    : cleaned;
}

// Generate a short, human-readable conversation title from the first user
// message. Uses Luna without reasoning for low-cost title generation and
// always resolves: any failure or empty/garbled output falls back to a
// deterministic truncation so a conversation is never left untitled.
export async function generateConversationTitle(
  firstMessage: string,
): Promise<string> {
  const fallback = truncateFallback(firstMessage);
  try {
    const response = await getOpenAIClient().responses.create({
      model: TITLE_MODEL,
      reasoning: { effort: "none" },
      instructions: TITLE_SYSTEM_PROMPT,
      input: firstMessage,
      max_output_tokens: 64,
      store: false,
    });
    if (response.status !== "completed") return fallback;
    const title = sanitizeTitle(response.output_text);
    return title || fallback;
  } catch (error) {
    logger.logError(error);
    return fallback;
  }
}
