// @vitest-environment jsdom
//
// Regression tests for chat message-state bugs surfaced on the fix/doc-context
// branch. All three came from React/Remix effect lifecycle interactions, so they
// need a rendered component with a stub router (not pure functions):
//   1. Duplication — the history fetcher's post-action revalidation re-applied the
//      DB snapshot on top of the optimistic streaming append.
//   2. Stale replay — a keyed remount (chat reset) replayed the response still held
//      in route-scoped `actionData`.
//   3. Single-append — one response must stream into exactly one assistant message.

// Packages
import { useState } from "react";
import { randomUUID } from "node:crypto";
import { createRemixStub } from "@remix-run/testing";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";

// Components
import Chat from "./Chat";

const RESPONSE = "Hello world";
const WORDS = ["hello", "world"];

// A message reply that the stub action returns; kept short so streaming (50ms/word)
// settles quickly under real timers. No `conversationId` here on purpose: a draft
// Chat navigates to /conversation/:id once it receives one, and these tests aren't
// exercising that navigation (it has its own test below), so omitting it keeps them
// focused and free of an incidental route change.
function actionReply(message: string) {
  return {
    message,
    response: RESPONSE,
    words: WORDS,
  };
}

beforeAll(() => {
  // jsdom lacks these APIs that Chat touches.
  if (!globalThis.crypto?.randomUUID) {
    globalThis.crypto = {
      ...globalThis.crypto,
      randomUUID: randomUUID as Crypto["randomUUID"],
    } as Crypto;
  }
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

function typeAndSend(text: string) {
  const input = screen.getByPlaceholderText("Type your message...");
  fireEvent.change(input, { target: { value: text } });
  const form = input.closest("form");
  if (!form) throw new Error("message form not found");
  fireEvent.submit(form);
}

describe("Chat streaming + reset", () => {
  it("streams a response into exactly one assistant message", async () => {
    const Stub = createRemixStub([
      {
        path: "/",
        Component: () => <Chat />,
        action: async ({ request }) => {
          const form = await request.formData();
          return actionReply(String(form.get("message") ?? ""));
        },
      },
    ]);
    render(<Stub initialEntries={["/"]} />);

    typeAndSend("first question");

    // Settles to the committed assistant message; if the response were committed
    // twice this would resolve to length 2 and fail.
    await waitFor(() =>
      expect(screen.getAllByText(RESPONSE)).toHaveLength(1)
    );
    expect(screen.getByText("first question")).toBeInTheDocument();
  });

  it("shows the user's message immediately, before the response arrives", async () => {
    // Hold the action so the response can't arrive; the user message must still show.
    let releaseAction!: () => void;
    const actionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    const Stub = createRemixStub([
      {
        path: "/",
        Component: () => <Chat />,
        action: async ({ request }) => {
          const form = await request.formData();
          await actionGate;
          return actionReply(String(form.get("message") ?? ""));
        },
      },
    ]);
    render(<Stub initialEntries={["/"]} />);

    typeAndSend("instant question");

    // Rendered optimistically while the action is still pending.
    expect(screen.getByText("instant question")).toBeInTheDocument();
    expect(screen.queryByText(RESPONSE)).not.toBeInTheDocument();

    releaseAction();
    await waitFor(() =>
      expect(screen.getByText(RESPONSE)).toBeInTheDocument()
    );
  });

  it("rolls back the optimistic message and restores the input when the send fails", async () => {
    const Stub = createRemixStub([
      {
        path: "/",
        Component: () => <Chat />,
        action: () => ({ error: "Failed to process message" }),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);

    typeAndSend("will fail");

    // Once the error comes back, the optimistic bubble is removed and the text is
    // restored to the input so it can be retried.
    await waitFor(() =>
      expect(screen.getByText("Failed to process message")).toBeInTheDocument()
    );
    expect(screen.queryByText("will fail")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Type your message...")).toHaveValue(
      "will fail"
    );
  });

  it("does not replay the persisted response after a keyed remount (chat reset)", async () => {
    // Mirrors the index route: bumping the key remounts Chat while the previous
    // response still lives in route-scoped actionData.
    function Harness() {
      const [resetKey, setResetKey] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setResetKey((k) => k + 1)}>
            reset-chat
          </button>
          <Chat key={resetKey} />
        </>
      );
    }

    const Stub = createRemixStub([
      {
        path: "/",
        Component: Harness,
        action: async ({ request }) => {
          const form = await request.formData();
          return actionReply(String(form.get("message") ?? ""));
        },
      },
    ]);
    render(<Stub initialEntries={["/"]} />);

    typeAndSend("weather in denver");
    await waitFor(() =>
      expect(screen.getByText(RESPONSE)).toBeInTheDocument()
    );

    // Reset the chat (remount). actionData still holds the old response.
    fireEvent.click(screen.getByText("reset-chat"));

    // The fresh chat must be empty and stay empty — no replayed stream.
    await waitFor(() =>
      expect(screen.queryByText(RESPONSE)).not.toBeInTheDocument()
    );
    await new Promise((r) => setTimeout(r, WORDS.length * 50 + 100));
    expect(screen.queryByText(RESPONSE)).not.toBeInTheDocument();
    expect(screen.queryByText("weather in denver")).not.toBeInTheDocument();
  });

  it("renders loader-seeded history on first paint without fetching (no blank flash)", async () => {
    const Stub = createRemixStub([
      {
        // No /api/conversation/:id/messages route on purpose: if Chat tried to fetch
        // history instead of using the seed, the messages wouldn't appear.
        path: "/conversation/:id",
        Component: () => (
          <Chat
            conversationId="conv-1"
            initialMessages={[
              { role: "user", content: "seeded question" },
              { role: "assistant", content: "seeded answer" },
            ]}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/conversation/conv-1"]} />);

    // Present synchronously on first paint — no loading blank, no fetch round-trip.
    expect(screen.getByText("seeded question")).toBeInTheDocument();
    expect(screen.getByText("seeded answer")).toBeInTheDocument();
  });
});

describe("Chat history revalidation", () => {
  // The DB the stub simulates; the action writes to it, the messages loader reads it.
  let history: { role: string; content: string }[] = [];

  beforeEach(() => {
    // An existing conversation with prior turns, as when you open it from the
    // sidebar. Content is distinct from RESPONSE so we only count the new reply.
    history = [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ];
  });

  it("does not duplicate the reply when the history fetcher revalidates after send", async () => {
    const Stub = createRemixStub([
      {
        path: "/conversation/:id",
        Component: () => <Chat conversationId="conv-1" />,
        action: async ({ request }) => {
          const form = await request.formData();
          const message = String(form.get("message") ?? "");
          // Persist both turns, as createChatCompletion does server-side.
          history = [
            ...history,
            { role: "user", content: message },
            { role: "assistant", content: RESPONSE },
          ];
          return actionReply(message);
        },
      },
      {
        path: "/api/conversation/:id/messages",
        loader: () => ({ messages: history }),
      },
    ]);
    render(<Stub initialEntries={["/conversation/conv-1"]} />);

    // Wait for the initial history load to settle (marks history as loaded) before
    // sending — mirrors opening a conversation and then typing.
    await waitFor(() =>
      expect(screen.getByText("earlier question")).toBeInTheDocument()
    );

    typeAndSend("hello there");

    // The post-action revalidation refetches [user, assistant] from the "DB" while
    // the stream also appends the assistant. Without the initial-load guard this
    // resolves to two copies of RESPONSE.
    await waitFor(() =>
      expect(screen.getAllByText(RESPONSE)).toHaveLength(1)
    );
    // Give any pending revalidation a chance to (incorrectly) re-apply.
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.getAllByText(RESPONSE)).toHaveLength(1);
  });

  it("falls back to the empty state (not a permanent blank) when history fails to load", async () => {
    const Stub = createRemixStub([
      {
        path: "/conversation/:id",
        Component: () => <Chat conversationId="conv-1" />,
        action: async ({ request }) => {
          const form = await request.formData();
          return actionReply(String(form.get("message") ?? ""));
        },
      },
      {
        // Simulates a 404/500 — the route returns an error shape, no `messages`.
        path: "/api/conversation/:id/messages",
        loader: () => ({ error: "Conversation not found" }),
      },
    ]);
    render(<Stub initialEntries={["/conversation/conv-1"]} />);

    // Without the loadingHistory-on-settle fix this would hang forever (blank chat).
    await waitFor(() =>
      expect(screen.getByText("Welcome to ThreadMind")).toBeInTheDocument()
    );
  });
});

describe("Chat markdown rendering", () => {
  const RESPONSE_MD = "Based on the résumé, **strong candidate**.\n\n- one\n- two";
  // The bold phrase closes within the first two words, so a <strong> exists long
  // before the stream finishes.
  const STREAM_MD = "**strong candidate** for the role.\n\n- one\n- two";
  const CITATION = "[Source](https://example.com/a)";
  const SEEDED_MD = `${RESPONSE_MD}\n\nSee ${CITATION}`;

  // Mirrors app/utils/chat.ts, which splits the response on spaces only.
  function markdownReply(message: string, response: string) {
    return { message, response, words: response.split(" ") };
  }

  // The streaming wrapper carries the `streaming-cursor` class (the cursor itself is
  // a CSS ::after). Present means streaming is in progress; absent means finished.
  function queryStreaming(): Element | null {
    return document.querySelector(".streaming-cursor");
  }

  function getAssistantBubble(): HTMLElement {
    const bubble = document.querySelector<HTMLElement>(".message-assistant");
    if (!bubble) throw new Error("assistant bubble not found");
    return bubble;
  }

  function renderChatWithReply(response: string) {
    const Stub = createRemixStub([
      {
        path: "/",
        Component: () => <Chat />,
        action: async ({ request }) => {
          const form = await request.formData();
          return markdownReply(String(form.get("message") ?? ""), response);
        },
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
  }

  function expectRenderedHistory(): void {
    const bubble = getAssistantBubble();
    expect(bubble.querySelector("strong")).toHaveTextContent("strong candidate");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(bubble.textContent).not.toContain("**");
    const link = screen.getByRole("link", { name: "Source" });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }

  it("renders Markdown once the streamed response completes", async () => {
    renderChatWithReply(RESPONSE_MD);

    typeAndSend("how is the candidate?");

    // The streaming bubble is also an assistant bubble, so completion means the
    // full text is present AND the cursor has gone.
    await waitFor(() => {
      expect(queryStreaming()).toBeNull();
      expect(getAssistantBubble()).toHaveTextContent("two");
    });

    const bubble = getAssistantBubble();
    expect(bubble.querySelector("strong")).toHaveTextContent("strong candidate");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(bubble.textContent).not.toContain("**");
  });

  it("renders bold while the response is still streaming", async () => {
    renderChatWithReply(STREAM_MD);

    typeAndSend("how is the candidate?");

    // Streaming wrapper present and the tail of the response not yet shown, but the bold
    // phrase is already a real <strong>.
    await waitFor(() => {
      expect(queryStreaming()).not.toBeNull();
      expect(getAssistantBubble().querySelector("strong")).toHaveTextContent(
        "strong candidate"
      );
    });
    expect(getAssistantBubble()).not.toHaveTextContent("two");

    // Streaming to completion ends in the same rendered result as the completed path.
    await waitFor(() => {
      expect(queryStreaming()).toBeNull();
      expect(getAssistantBubble()).toHaveTextContent("two");
    });
    const bubble = getAssistantBubble();
    expect(bubble.querySelector("strong")).toHaveTextContent("strong candidate");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(bubble.textContent).not.toContain("**");
  });

  it("draws the cursor via CSS, not as a separate element or text", async () => {
    renderChatWithReply(STREAM_MD);

    typeAndSend("how is the candidate?");

    // jsdom cannot compute pseudo-element layout, so the inline ::after cursor
    // itself is not verifiable here; assert only the DOM contract it relies on.
    await waitFor(() => expect(queryStreaming()).not.toBeNull());
    const wrapper = queryStreaming() as HTMLElement;
    const markdown = wrapper.querySelector(".message-markdown");
    expect(markdown).not.toBeNull();
    expect(markdown?.nextElementSibling).toBeNull();
    expect(wrapper.querySelector('[aria-hidden="true"], .animate-pulse')).toBeNull();
    expect(wrapper.textContent).toBe(markdown?.textContent);
    expect(wrapper.textContent).not.toMatch(/[|\u2588\u258C\u258D\u2502_]/);

    await waitFor(() => expect(queryStreaming()).toBeNull());
  });

  it("renders Markdown and citation links in loader-seeded history", () => {
    const Stub = createRemixStub([
      {
        path: "/conversation/:id",
        Component: () => (
          <Chat
            conversationId="conv-1"
            initialMessages={[
              { role: "user", content: "question" },
              { role: "assistant", content: SEEDED_MD },
            ]}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/conversation/conv-1"]} />);

    expectRenderedHistory();
  });

  it("renders Markdown and citation links in fetcher-loaded history", async () => {
    const Stub = createRemixStub([
      {
        path: "/conversation/:id",
        Component: () => <Chat conversationId="conv-1" />,
      },
      {
        path: "/api/conversation/:id/messages",
        loader: () => ({
          messages: [
            { role: "user", content: "question" },
            { role: "assistant", content: SEEDED_MD },
          ],
        }),
      },
    ]);
    render(<Stub initialEntries={["/conversation/conv-1"]} />);

    await screen.findByRole("link", { name: "Source" });
    expectRenderedHistory();
  });

  it("keeps a submitted user message as plain text", async () => {
    const text = "**not bold** and <b>x</b> - item";
    renderChatWithReply(RESPONSE_MD);

    typeAndSend(text);

    const content = screen.getByText(text);
    expect(content.closest(".message-user")).not.toBeNull();
    expect(content.textContent).toBe(text);
    expect(content.querySelector("strong, b, ul, li")).toBeNull();

    // Let the reply finish so nothing is left streaming after the assertions.
    await waitFor(() => {
      expect(queryStreaming()).toBeNull();
      expect(getAssistantBubble()).toHaveTextContent("two");
    });
    expect(screen.getByText(text).querySelector("strong, b, ul, li")).toBeNull();
  });

  it("keeps a seeded multiline user message as plain text", () => {
    const Stub = createRemixStub([
      {
        path: "/conversation/:id",
        Component: () => (
          <Chat
            conversationId="conv-1"
            initialMessages={[
              { role: "user", content: "**not bold**\n- item" },
              { role: "assistant", content: "ok" },
            ]}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/conversation/conv-1"]} />);

    // getByText normalizes whitespace; the raw textContent keeps the newline.
    const content = screen.getByText("**not bold** - item");
    expect(content.closest(".message-user")).not.toBeNull();
    expect(content.textContent).toBe("**not bold**\n- item");
    expect(content.querySelector("strong, b, ul, li")).toBeNull();
  });

  it("renders a fenced code block header and copy button once through Chat", () => {
    const Stub = createRemixStub([
      {
        path: "/conversation/:id",
        Component: () => (
          <Chat
            conversationId="conv-1"
            initialMessages={[
              {
                role: "assistant",
                content: "Try this:\n\n```ts\nconst a = 1;\n```",
              },
            ]}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/conversation/conv-1"]} />);

    expect(screen.getAllByText("TypeScript")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Copy code" })).toHaveLength(1);
    expect(getAssistantBubble().querySelector("pre code")).toHaveTextContent(
      "const a = 1;"
    );
  });
});

describe("Chat thinking bubble", () => {
  const THINKING = "Thinking...";

  function replyStub(action: () => unknown) {
    return createRemixStub([
      { path: "/", Component: () => <Chat />, action: action as () => never },
    ]);
  }

  it("keeps the thinking bubble until the first streamed word renders (no empty gap)", async () => {
    const Stub = replyStub(() => actionReply("q"));
    render(<Stub initialEntries={["/"]} />);

    // Approach: real timers + a MutationObserver. The observer callback runs after
    // every DOM mutation batch (a microtask after each React commit), so it samples
    // every committed state across the submitting -> reply -> first-word transition.
    // A "gap" is any committed state with neither the thinking bubble nor streamed text.
    let sawThinking = false;
    let gaps = 0;
    const sample = (): void => {
      const thinking = screen.queryByText(THINKING) !== null;
      const streaming = screen.queryByText(/^Hello/) !== null;
      if (thinking) sawThinking = true;
      if (sawThinking && !thinking && !streaming) gaps++;
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    typeAndSend("q");
    await waitFor(() => expect(screen.getByText(RESPONSE)).toBeInTheDocument());
    observer.disconnect();

    expect(sawThinking).toBe(true);
    expect(gaps).toBe(0);
  });

  it("removes the thinking bubble once streaming completes", async () => {
    const Stub = replyStub(() => actionReply("q"));
    render(<Stub initialEntries={["/"]} />);
    typeAndSend("q");
    await waitFor(() => expect(screen.getByText(RESPONSE)).toBeInTheDocument());
    expect(screen.queryByText(THINKING)).not.toBeInTheDocument();
  });

  it("does not show a stuck thinking bubble on an error response", async () => {
    const Stub = replyStub(() => ({ error: "Failed to process message" }));
    render(<Stub initialEntries={["/"]} />);
    typeAndSend("q");
    await waitFor(() =>
      expect(screen.getByText("Failed to process message")).toBeInTheDocument()
    );
    expect(screen.queryByText(THINKING)).not.toBeInTheDocument();
  });

  it("does not show a stuck thinking bubble after a keyed remount (chat reset)", async () => {
    function Harness() {
      const [resetKey, setResetKey] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setResetKey((k) => k + 1)}>
            reset-chat
          </button>
          <Chat key={resetKey} />
        </>
      );
    }
    const Stub = createRemixStub([
      { path: "/", Component: Harness, action: () => actionReply("q") },
    ]);
    render(<Stub initialEntries={["/"]} />);
    typeAndSend("q");
    await waitFor(() => expect(screen.getByText(RESPONSE)).toBeInTheDocument());

    fireEvent.click(screen.getByText("reset-chat"));
    await waitFor(() =>
      expect(screen.queryByText(RESPONSE)).not.toBeInTheDocument()
    );
    expect(screen.queryByText(THINKING)).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByText(THINKING)).not.toBeInTheDocument();
  });
});
