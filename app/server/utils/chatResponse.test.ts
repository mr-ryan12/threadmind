import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response, ResponseOutputMessage } from "openai/resources/responses/responses";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("~/server/openai.server", () => ({
  CHAT_MODEL: "gpt-6.1-sol",
  getOpenAIClient: () => ({ responses: { create } }),
}));

import { formatResponseText, generateChatResponse } from "./chatResponse";

type Annotation = Extract<ResponseOutputMessage["content"][number], { type: "output_text" }>["annotations"][number];
function message(text: string, annotations: Annotation[] = []): ResponseOutputMessage {
  return {
    type: "message", id: "msg-1", role: "assistant", status: "completed",
    content: [{ type: "output_text", text, annotations, logprobs: [] }],
  };
}
function reply(text = "Hello") {
  return { status: "completed", output: [message(text)] };
}
function call(id: string, args = '{"timezone":"UTC"}', name = "get_time_in_timezone") {
  return { type: "function_call", id, call_id: `call-${id}`, name, arguments: args };
}

beforeEach(() => { create.mockReset(); });

describe("Responses tool orchestration", () => {
  it("uses Sol, web search and stateless history without sampling parameters", async () => {
    create.mockResolvedValueOnce(reply());
    const input = [{ role: "user" as const, content: "Hi" }];
    expect(await generateChatResponse(input)).toBe("Hello");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-6.1-sol", input,
      store: false, reasoning: { effort: "medium" },
      include: ["reasoning.encrypted_content"],
      tools: expect.arrayContaining([{ type: "web_search" }]),
    }));
    expect(create.mock.calls[0][0]).not.toHaveProperty("temperature");
    expect(input).toHaveLength(1);
  });

  it("preserves reasoning and matches every tool result across multiple rounds", async () => {
    const reasoning = { type: "reasoning", id: "r1", summary: [], encrypted_content: "opaque" };
    const commentary: ResponseOutputMessage = { ...message("Checking the local times."), phase: "commentary" };
    const first = [reasoning, commentary, call("a"), call("b", '{"timezone":"America/Denver"}')];
    create.mockResolvedValueOnce({ status: "completed", output: first })
      .mockResolvedValueOnce({ status: "completed", output: [call("c")] })
      .mockResolvedValueOnce(reply("The time is available."));
    await expect(generateChatResponse([{ role: "user", content: "Compare times" }]))
      .resolves.toBe("The time is available.");
    const secondInput = create.mock.calls[1][0].input;
    expect(secondInput).toEqual([
      { role: "user", content: "Compare times" }, ...first,
      { type: "function_call_output", call_id: "call-a", output: expect.any(String) },
      { type: "function_call_output", call_id: "call-b", output: expect.any(String) },
    ]);
    expect(create.mock.calls[2][0].input).toContainEqual(expect.objectContaining({
      type: "function_call_output", call_id: "call-c",
    }));
    expect(create.mock.calls[2][0].tools).toEqual(create.mock.calls[0][0].tools);
  });

  it("lets the model recover from malformed or unknown function calls", async () => {
    create.mockResolvedValueOnce({ status: "completed", output: [call("bad", "{"), call("unknown", "{}", "unknown")] })
      .mockResolvedValueOnce(reply("Please specify a timezone."));
    await generateChatResponse([{ role: "user", content: "Time?" }]);
    expect(create.mock.calls[1][0].input.slice(-2)).toEqual([
      { type: "function_call_output", call_id: "call-bad", output: expect.stringMatching(/^Error:/) },
      { type: "function_call_output", call_id: "call-unknown", output: expect.stringMatching(/^Error:/) },
    ]);
  });

  it("does not offer web search for document-only requests", async () => {
    create.mockResolvedValueOnce(reply());
    await generateChatResponse([{ role: "user", content: "Use only my uploads" }], false);
    expect(create.mock.calls[0][0].tools).not.toContainEqual({ type: "web_search" });
  });

  it("bounds repeated function calls", async () => {
    create.mockResolvedValue({ status: "completed", output: [call("again")] });
    await expect(generateChatResponse([])).rejects.toThrow("tool-call limit");
    expect(create).toHaveBeenCalledTimes(6);
  });

  it.each([
    { status: "incomplete", output: [message("Partial")] },
    { status: "failed", output: [] },
    { status: "completed", output: [] },
  ])("rejects incomplete, failed and empty responses: $status", async (response) => {
    create.mockResolvedValueOnce(response);
    await expect(generateChatResponse([])).rejects.toThrow();
  });

  it("propagates API failures", async () => {
    create.mockRejectedValueOnce(new Error("Model unavailable"));
    await expect(generateChatResponse([])).rejects.toThrow("Model unavailable");
  });
});

describe("persisted web citations", () => {
  it("excludes commentary while preserving final-answer citations", () => {
    const commentary: ResponseOutputMessage = {
      ...message("I will search for the answer."), phase: "commentary",
    };
    const finalAnswer: ResponseOutputMessage = {
      ...message("The answer is 42. [cite]", [{
        type: "url_citation", start_index: 18, end_index: 24,
        title: "Official source", url: "https://example.com/",
      }]),
      phase: "final_answer",
    };
    expect(formatResponseText({ output: [commentary, finalAnswer] }))
      .toBe("The answer is 42. [Official source](https://example.com/)");
  });

  it.each([undefined, null])("accepts a final answer with phase %s", (phase) => {
    expect(formatResponseText({ output: [{ ...message("Legacy answer"), phase }] }))
      .toBe("Legacy answer");
  });

  it("rejects a commentary-only response instead of saving a preamble", async () => {
    create.mockResolvedValueOnce({
      status: "completed",
      output: [{ ...message("I will look into that."), phase: "commentary" }],
    });
    await expect(generateChatResponse([])).rejects.toThrow("empty response");
  });

  it("replaces annotated spans with source links, preserving surrounding text", () => {
    const response: Pick<Response, "output"> = { output: [message("Answer. [cite] Done.", [{
      type: "url_citation", start_index: 8, end_index: 14,
      title: "Official [source]", url: "https://example.com/page_(one)",
    }])] };
    expect(formatResponseText(response))
      .toBe("Answer. [Official  source](https://example.com/page_%28one%29) Done.");
  });

  it("handles multiple text items and ignores unsafe URLs and invalid spans", () => {
    expect(formatResponseText({ output: [message("One", [{
      type: "url_citation", start_index: 0, end_index: 3, title: "bad", url: "javascript:alert(1)",
    }, {
      type: "url_citation", start_index: 3, end_index: 99, title: "bad", url: "https://example.com",
    }]), message("Two")] })).toBe("One\nTwo");
  });

  it("returns user-facing refusals rather than reasoning or raw tool output", () => {
    const msg: ResponseOutputMessage = {
      type: "message", id: "msg", role: "assistant", status: "completed",
      content: [{ type: "refusal", refusal: "I cannot help with that." }],
    };
    expect(formatResponseText({ output: [msg] })).toBe("I cannot help with that.");
  });
});
