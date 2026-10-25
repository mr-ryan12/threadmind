import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateChatResponse: vi.fn(), queryDocuments: vi.fn(),
  getConversation: vi.fn(), ensureConversation: vi.fn(), createNewConversation: vi.fn(),
  createMany: vi.fn(), updateConversationTitle: vi.fn(),
}));
vi.mock("~/server/utils/chatResponse", () => ({ generateChatResponse: mocks.generateChatResponse }));
vi.mock("~/server/utils/documentService", () => ({ queryDocuments: mocks.queryDocuments }));
vi.mock("~/server/utils/apiCalls/getConversation", () => ({
  getConversation: mocks.getConversation,
  ensureConversation: mocks.ensureConversation,
  createNewConversation: mocks.createNewConversation,
}));
vi.mock("~/server/utils/apiCalls/updateConversationTitle", () => ({ updateConversationTitle: mocks.updateConversationTitle }));
vi.mock("~/server/db.server", () => ({ prisma: { message: { createMany: mocks.createMany } } }));
vi.mock("~/server/utils/logger", () => ({ logger: { logError: vi.fn() } }));
import { createChatCompletion } from "./chat";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.generateChatResponse.mockResolvedValue("Answer [source](https://example.com/)");
  mocks.queryDocuments.mockResolvedValue("Retrieved passage");
  mocks.getConversation.mockResolvedValue(null);
  mocks.ensureConversation.mockResolvedValue({ id: "draft", messages: [] });
  mocks.createNewConversation.mockResolvedValue({ id: "new", messages: [] });
});

describe("chat persistence and retrieval", () => {
  it("includes saved history and scoped RAG passages as user reference data", async () => {
    mocks.getConversation.mockResolvedValue({ id: "existing", messages: [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
    ] });
    const result = await createChatCompletion("Summarize my document", "existing", "user-1");
    expect(mocks.queryDocuments).toHaveBeenCalledWith("Summarize my document", "user-1", "existing");
    expect(mocks.getConversation).toHaveBeenCalledWith("existing", "user-1");
    expect(mocks.generateChatResponse).toHaveBeenCalledWith([
      { role: "user", content: "Earlier question" },
      { role: "assistant", phase: "final_answer", content: "Earlier answer" },
      { role: "user", content: "Retrieved document passages (reference material):\nRetrieved passage" },
      { role: "user", content: "Summarize my document" },
    ], true);
    expect(mocks.createMany).toHaveBeenCalledWith({ data: [
      { role: "user", content: "Summarize my document", conversationId: "existing" },
      { role: "assistant", content: result.response, conversationId: "existing" },
    ] });
    expect(result.conversationId).toBe("existing");
    expect(result.words.join(" ")).toBe(result.response);
    expect(mocks.updateConversationTitle).not.toHaveBeenCalled();
  });

  it("reuses draft IDs for uploads and titles the first turn after success", async () => {
    const result = await createChatCompletion("Hello", "draft", "user-1");
    expect(result.conversationId).toBe("draft");
    expect(mocks.queryDocuments).not.toHaveBeenCalled();
    expect(mocks.ensureConversation).toHaveBeenCalledWith("draft", "user-1");
    expect(mocks.updateConversationTitle).toHaveBeenCalledWith("draft", "user-1");
  });

  it.each([
    "Only use my documents", "Use only my documents", "Use my uploads only",
    "Document-only answer please", "Don't search the web",
  ])("disables web search for explicit restrictions: %s", async (message) => {
    await createChatCompletion(message, "draft", "user-1");
    expect(mocks.generateChatResponse).toHaveBeenCalledWith(expect.any(Array), false);
  });

  it.each([
    "Use my uploads and search the web to compare them with current guidance.",
    "Use not only my documents but also current web sources.",
    "Use my uploads",
  ])("keeps retrieval and web search available without an exclusive restriction: %s", async (message) => {
    await createChatCompletion(message, "draft", "user-1");
    expect(mocks.queryDocuments).toHaveBeenCalledWith(message, "user-1", "draft");
    expect(mocks.generateChatResponse).toHaveBeenCalledWith([
      { role: "user", content: "Retrieved document passages (reference material):\nRetrieved passage" },
      { role: "user", content: message },
    ], true);
  });

  it("does not create a conversation or persist turns when the API fails", async () => {
    mocks.generateChatResponse.mockRejectedValue(new Error("Model unavailable"));
    await expect(createChatCompletion("Hello", "draft", "user-1")).rejects.toThrow("Model unavailable");
    expect(mocks.ensureConversation).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.updateConversationTitle).not.toHaveBeenCalled();
  });

  it("still answers when optional retrieval fails", async () => {
    mocks.queryDocuments.mockRejectedValue(new Error("Retrieval unavailable"));
    await createChatCompletion("Summarize my document", undefined, "user-1");
    expect(mocks.generateChatResponse).toHaveBeenCalledWith([
      { role: "user", content: "Summarize my document" },
    ], true);
    expect(mocks.createNewConversation).toHaveBeenCalledWith("user-1");
  });
});
