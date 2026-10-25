import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("~/server/openai.server", () => ({
  TITLE_MODEL: "gpt-6-luna",
  getOpenAIClient: () => ({ responses: { create } }),
}));
vi.mock("~/server/utils/logger", () => ({ logger: { logError: vi.fn() } }));
import { generateConversationTitle } from "./generateConversationTitle";

beforeEach(() => { create.mockReset(); });

describe("conversation titles via Responses", () => {
  it("uses Luna without reasoning and sanitizes its title", async () => {
    create.mockResolvedValue({ status: "completed", output_text: '"A concise title."' });
    expect(await generateConversationTitle("Help with my project")).toBe("A concise title");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-6-luna", reasoning: { effort: "none" },
      input: "Help with my project", max_output_tokens: 64, store: false,
    }));
    expect(create.mock.calls[0][0]).not.toHaveProperty("temperature");
  });

  it.each([
    { status: "completed", output_text: "" },
    { status: "incomplete", output_text: "Partial" },
  ])("falls back on unusable output: $status", async (response) => {
    create.mockResolvedValue(response);
    expect(await generateConversationTitle("  My question  ")).toBe("My question");
  });

  it("keeps a conversation titled when the API fails", async () => {
    create.mockRejectedValue(new Error("API unavailable"));
    expect(await generateConversationTitle("x".repeat(80))).toBe("x".repeat(50) + "...");
  });
});
