import type { Tool } from "openai/resources/responses/responses";

export const tools: Tool[] = [
  { type: "web_search" },
  {
    type: "function",
    name: "get_time_in_timezone",
    description: "Get the current date and time in an IANA timezone",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "For example, America/Denver" },
      },
      required: ["timezone"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export function runTool(name: string, args: unknown): string {
  if (name !== "get_time_in_timezone") {
    throw new Error(`Unknown tool: ${name}`);
  }
  if (
    !args ||
    typeof args !== "object" ||
    !("timezone" in args) ||
    typeof args.timezone !== "string" ||
    !args.timezone.trim()
  ) {
    return "Error: timezone must be a non-empty IANA timezone string.";
  }
  try {
    return new Date().toLocaleString("en-US", { timeZone: args.timezone });
  } catch {
    return "Error: Invalid timezone. Supply a valid IANA timezone.";
  }
}
