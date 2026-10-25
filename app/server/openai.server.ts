import OpenAI from "openai";

export const CHAT_MODEL = "gpt-6.1-sol";
export const TITLE_MODEL = "gpt-6-luna";

// Create lazily so importing a route doesn't require credentials at build time.
let client: OpenAI | undefined;

export function getOpenAIClient(): OpenAI {
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}
