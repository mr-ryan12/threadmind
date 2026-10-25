import { beforeEach, expect, it, vi } from "vitest";
import type { ResponseOutputMessage } from "openai/resources/responses/responses";

// Exercise the real response formatter, persistence and next-turn history.
// Only external boundaries (OpenAI, retrieval, database and logging) are mocked.
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getConversation: vi.fn(),
  createMany: vi.fn(),
}));
vi.mock("~/server/openai.server", () => ({
  CHAT_MODEL: "gpt-6.1-sol",
  getOpenAIClient: () => ({ responses: { create: mocks.create } }),
}));
vi.mock("~/server/utils/documentService", () => ({
  queryDocuments: vi.fn().mockResolvedValue("Retrieved passage"),
}));
vi.mock("~/server/utils/apiCalls/getConversation", () => ({
  getConversation: mocks.getConversation,
  ensureConversation: vi.fn(),
  createNewConversation: vi.fn(),
}));
vi.mock("~/server/utils/apiCalls/updateConversationTitle", () => ({
  updateConversationTitle: vi.fn(),
}));
vi.mock("~/server/db.server", () => ({
  prisma: { message: { createMany: mocks.createMany } },
}));
vi.mock("~/server/utils/logger", () => ({ logger: { logError: vi.fn() } }));

import { createChatCompletion } from "./chat";

function assistant(
  phase: ResponseOutputMessage["phase"],
  text: string,
): ResponseOutputMessage {
  return {
    type: "message", id: `msg-${phase}`, role: "assistant", status: "completed", phase,
    content: [{ type: "output_text", text, annotations: [], logprobs: [] }],
  };
}

beforeEach(() => { vi.clearAllMocks(); });

it("saves only the final answer and replays it with its phase on the next turn", async () => {
  const savedMessages: { role: string; content: string; conversationId: string }[] = [];
  mocks.getConversation.mockImplementation(async () => ({
    id: "conv-1", messages: [...savedMessages],
  }));
  mocks.createMany.mockImplementation(async ({ data }: { data: typeof savedMessages }) => {
    savedMessages.push(...data);
    return { count: data.length };
  });
  mocks.create
    .mockResolvedValueOnce({
      status: "completed",
      output: [
        assistant("commentary", "I will search for the answer."),
        assistant("final_answer", "The answer is 42."),
      ],
    })
    .mockResolvedValueOnce({
      status: "completed", output: [assistant("final_answer", "Here is the explanation.")],
    });

  const question = "Use my uploads and search the web to compare them with current guidance.";
  const firstTurn = await createChatCompletion(question, "conv-1", "user-1");
  expect(firstTurn.response).toBe("The answer is 42.");
  expect(firstTurn.words.join(" ")).toBe("The answer is 42.");
  expect(savedMessages).toEqual([
    { role: "user", content: question, conversationId: "conv-1" },
    { role: "assistant", content: "The answer is 42.", conversationId: "conv-1" },
  ]);
  expect(mocks.create.mock.calls[0][0].tools).toContainEqual({ type: "web_search" });

  await createChatCompletion("Explain that answer.", "conv-1", "user-1");
  expect(mocks.create.mock.calls[1][0].input).toEqual([
    { role: "user", content: question },
    { role: "assistant", phase: "final_answer", content: "The answer is 42." },
    { role: "user", content: "Explain that answer." },
  ]);
});
