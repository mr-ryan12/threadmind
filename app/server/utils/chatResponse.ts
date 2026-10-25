import type { Response, ResponseInput } from "openai/resources/responses/responses";
import { CHAT_MODEL, getOpenAIClient } from "~/server/openai.server";
import { systemMessage } from "~/server/utils/systemMessage";
import { runTool, tools } from "~/server/utils/tools";

const MAX_TOOL_ROUNDS = 5;

// Persist only final-answer content; intermediate commentary stays in the
// in-flight tool history. Missing/null phases remain supported for older models.
// Store citations as links so they survive reloads without a metadata column.
export function formatResponseText(response: Pick<Response, "output">): string {
  const parts: string[] = [];
  for (const item of response.output) {
    if (item.type !== "message" || item.phase === "commentary") continue;
    for (const part of item.content) {
      if (part.type === "refusal") {
        parts.push(part.refusal);
        continue;
      }
      if (part.type !== "output_text") continue;
      let text = "";
      let cursor = 0;
      const citations = part.annotations
        .filter((annotation) => annotation.type === "url_citation")
        .sort((a, b) => a.start_index - b.start_index);
      for (const citation of citations) {
        if (
          citation.start_index < cursor ||
          citation.end_index <= citation.start_index ||
          citation.end_index > part.text.length
        ) continue;
        let url: URL;
        try {
          url = new URL(citation.url);
        } catch {
          continue;
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") continue;
        const label = citation.title.replace(/[[\]\r\n]/g, " ").trim() || url.hostname;
        const href = url.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
        text += part.text.slice(cursor, citation.start_index);
        text += `[${label}](${href})`;
        cursor = citation.end_index;
      }
      parts.push(text + part.text.slice(cursor));
    }
  }
  return parts.join("\n").trim();
}

export async function generateChatResponse(
  input: ResponseInput,
  allowWebSearch = true,
): Promise<string> {
  const client = getOpenAIClient();
  const requestTools = allowWebSearch
    ? tools
    : tools.filter((tool) => tool.type !== "web_search");
  const conversation: ResponseInput = [...input];
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.responses.create({
      model: CHAT_MODEL,
      instructions: systemMessage,
      reasoning: { effort: "medium" },
      input: [...conversation],
      tools: requestTools,
      store: false,
      include: ["reasoning.encrypted_content"],
    });
    if (response.status !== "completed") {
      throw new Error(`AI response did not complete: ${response.status}`);
    }
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) {
      const text = formatResponseText(response);
      if (!text) throw new Error("AI model returned an empty response");
      return text;
    }
    if (round === MAX_TOOL_ROUNDS) break;
    // Preserve reasoning (including encrypted content) and every tool output.
    for (const item of response.output) {
      // These are the item kinds produced by this app's enabled tools. Other
      // hosted tool outputs have different input schemas in the SDK.
      if (
        item.type === "message" || item.type === "reasoning" ||
        item.type === "function_call" || item.type === "web_search_call"
      ) {
        conversation.push(item);
      } else {
        throw new Error(`Unexpected AI output item: ${item.type}`);
      }
    }
    for (const call of calls) {
      let output: string;
      try {
        const args: unknown = JSON.parse(call.arguments);
        output = runTool(call.name, args);
      } catch {
        output = "Error: Unable to run this tool. Check its name and arguments.";
      }
      conversation.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });
    }
  }
  throw new Error("AI model exceeded the tool-call limit");
}
