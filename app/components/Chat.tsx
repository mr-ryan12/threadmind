// Packages
import { useState, useEffect, useRef } from "react";
import {
  Form,
  useActionData,
  useNavigation,
  useNavigate,
  useFetcher,
} from "@remix-run/react";

// Components
import MessageContent from "~/components/MessageContent";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ActionData {
  message?: string;
  response?: string;
  words?: string[];
  error?: string;
  conversationId?: string;
  redirect?: string;
}

interface ChatProps {
  conversationId?: string;
  initialMessages?: Message[];
  onConversationIdChange?: (id: string) => void;
}

interface ApiMessage {
  role: "user" | "assistant";
  content: string;
}

interface MessagesApiResponse {
  messages: ApiMessage[];
}

export default function Chat({
  conversationId: initialConversationId,
  initialMessages,
  onConversationIdChange,
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string>(
    initialConversationId || ""
  );
  const [streamingResponse, setStreamingResponse] = useState("");
  // True while a conversation's history is being fetched — keeps the empty-state
  // welcome from flashing between clearing messages and the history arriving. Starts
  // false when the loader already seeded history (nothing to fetch).
  const [loadingHistory, setLoadingHistory] = useState(
    !!initialConversationId && !initialMessages
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const messagesFetcher = useFetcher<MessagesApiResponse>();
  const uploadFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.has("message") === true;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  // The upload goes through the Remix data layer — derive the in-flight flag from
  // the fetcher instead of tracking a separate boolean.
  const uploading = uploadFetcher.state !== "idle";
  // Apply fetched history only on the FIRST load of a conversation. Remix
  // revalidates fetcher loads after every action, so re-applying that DB snapshot
  // mid-stream would collide with the optimistic assistant append (duplicate reply).
  // Already satisfied when the loader seeded history — there's no fetch to apply.
  const historyLoadedRef = useRef(!!initialMessages);
  // The conversation whose history was seeded from the route loader on this mount,
  // so the load effect can skip the redundant fetch (and its blank flash) for it.
  const seededIdRef = useRef(initialMessages ? initialConversationId : null);
  // Commit each assistant response at most once, even if the effect re-runs.
  const committedActionDataRef = useRef<ActionData | null>(null);
  // `actionData` is route-scoped and outlives a keyed remount of this component, so
  // a reset chat would otherwise replay the previous response. Ignore whatever was
  // already present at mount; only react to responses that arrive afterwards.
  const mountActionDataRef = useRef(actionData);
  // The in-flight streaming interval, so we can cancel it when the conversation
  // changes (otherwise the previous chat's reply lands in the newly-opened one).
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The optimistically-appended message text, so a failed send can be rolled back.
  const pendingSubmitRef = useRef<string | null>(null);

  // Handle redirect if conversation ID changed
  useEffect(() => {
    if (actionData?.redirect) {
      navigate(actionData.redirect);
    }
  }, [actionData?.redirect, navigate]);

  // Report the active conversation id up so the route can track it — e.g. to reset
  // this chat when that conversation is deleted. Fires for the client-generated id
  // of a fresh chat and for any later change.
  useEffect(() => {
    if (conversationId) onConversationIdChange?.(conversationId);
  }, [conversationId, onConversationIdChange]);

  // Load existing messages when the conversation changes (via Remix data layer).
  useEffect(() => {
    // Cancel any streaming animation from the previous conversation so its reply
    // can't get appended into the one we're switching to.
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    // Whatever reply was pending belongs to the previous conversation; mark it
    // handled so the "Thinking..." bridge below can't stay stuck on an abandoned stream.
    committedActionDataRef.current = actionData ?? null;
    if (initialConversationId) {
      setConversationId(initialConversationId);
      setStreamingResponse("");
      if (seededIdRef.current === initialConversationId) {
        // History was seeded from the route loader on this mount — render it
        // directly, no fetch, no blank. Consume the seed so a later switch to a
        // different conversation fetches normally.
        seededIdRef.current = null;
        setLoadingHistory(false);
      } else {
        setMessages([]);
        // New conversation context: allow the next fetched history to apply once,
        // and suppress the empty-state until it arrives.
        historyLoadedRef.current = false;
        setLoadingHistory(true);
        messagesFetcher.load(
          `/api/conversation/${initialConversationId}/messages`
        );
      }
    } else {
      // Fresh chat: generate the conversation id up front so an upload and the
      // first message share it. Nothing is written to the DB until the first
      // real action, so abandoning the page leaves no record behind.
      setMessages([]);
      setConversationId(crypto.randomUUID());
      setStreamingResponse("");
      setLoadingHistory(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);

  // Sync loaded history into local message state — but only for the initial load
  // of a conversation. Post-action revalidations of this fetcher return a DB
  // snapshot that would overwrite (and duplicate against) the optimistic updates.
  useEffect(() => {
    // Nothing has come back yet — keep showing the loading state.
    if (!messagesFetcher.data) return;
    // The fetch has settled (success OR an error-shaped response like 404/500) —
    // reveal the conversation so the empty-state can render instead of a permanent
    // blank when history can't be loaded.
    setLoadingHistory(false);
    if (!messagesFetcher.data.messages) return;
    // Apply history only on the FIRST load; ignore post-action revalidations.
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    setMessages(
      messagesFetcher.data.messages.map((msg: ApiMessage) => ({
        role: msg.role,
        content: msg.content,
      }))
    );
  }, [messagesFetcher.data]);

  useEffect(() => {
    if (actionData === mountActionDataRef.current) return;
    if (actionData?.error && pendingSubmitRef.current) {
      // The send failed: roll back the optimistic user message and restore the text
      // to the input so it can be retried (the old code preserved it on error).
      const failed = pendingSubmitRef.current;
      pendingSubmitRef.current = null;
      setMessages((prev) =>
        prev.length > 0 &&
        prev[prev.length - 1].role === "user" &&
        prev[prev.length - 1].content === failed
          ? prev.slice(0, -1)
          : prev
      );
      setInput((cur) => cur || failed);
      return;
    }
    // Success: the optimistic message is confirmed; sync the server conversation id.
    // (The user message is rendered optimistically on submit in handleSubmit.)
    pendingSubmitRef.current = null;
    if (actionData?.conversationId) {
      setConversationId(actionData.conversationId);
    }
  }, [actionData]);

  useEffect(() => {
    if (actionData === mountActionDataRef.current) return;
    if (actionData?.words && actionData.words.length > 0) {
      // Guard against committing the same response twice if this effect re-runs
      // (e.g. a revalidation re-renders mid-stream). One actionData → one reply.
      if (committedActionDataRef.current === actionData) return;
      setStreamingResponse("");
      let currentIndex = 0;
      const interval = setInterval(() => {
        if (currentIndex < actionData.words!.length) {
          let word = actionData.words![currentIndex];
          if (currentIndex === 0) {
            word = word.charAt(0).toUpperCase() + word.slice(1);
          }
          setStreamingResponse((prev) => prev + word + " ");
          currentIndex++;
        } else {
          clearInterval(interval);
          streamIntervalRef.current = null;
          committedActionDataRef.current = actionData;
          const newMessage: Message = {
            role: "assistant",
            content: actionData.response || "",
          };
          setMessages((prev) => [...prev, newMessage]);
          setStreamingResponse("");
        }
      }, 50); // 50ms delay between words
      streamIntervalRef.current = interval;

      return () => clearInterval(interval);
    }
  }, [actionData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingResponse, isSubmitting]);

  // A reply has arrived but its first word hasn't rendered yet (the stream starts on
  // the first interval tick). Keep "Thinking..." up across that gap so the message
  // list doesn't shrink and then re-grow (a visible vertical jump). Cleared once the
  // stream starts, the reply is committed/abandoned, or for mount-time/error/empty data.
  const isAwaitingStream =
    actionData !== mountActionDataRef.current &&
    committedActionDataRef.current !== actionData &&
    (actionData?.words?.length ?? 0) > 0 &&
    !streamingResponse;
  const showThinking = isSubmitting || isAwaitingStream;

  const handleFileIconClick = () => {
    fileInputRef.current?.click();
  };

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (uploadMessage) {
      timeoutId = setTimeout(() => {
        setUploadMessage("");
      }, 2000);
    }

    return () => clearTimeout(timeoutId);
  }, [uploadMessage]);

  // Surface the upload result once the fetcher settles. The action returns
  // { success: true } or { error }; the transient banner (auto-cleared above)
  // keeps the same copy the manual flow used.
  useEffect(() => {
    if (uploadFetcher.state !== "idle" || !uploadFetcher.data) return;
    setUploadMessage(
      uploadFetcher.data.success
        ? "File uploaded and ingested successfully!"
        : uploadFetcher.data.error ?? "Upload failed"
    );
  }, [uploadFetcher.state, uploadFetcher.data]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadMessage(null);
    const formData = new FormData();
    formData.append("file", file);
    if (conversationId) {
      formData.append("conversationId", conversationId);
    }
    // multipart/form-data is required for the file part — Remix otherwise
    // URL-encodes the body, which would drop the upload.
    uploadFetcher.submit(formData, {
      method: "post",
      action: "/upload-file",
      encType: "multipart/form-data",
    });
    // Safe to reset now: submit() has already captured the FormData we built.
    e.target.value = "";
  };

  // Render the user's message immediately (optimistic) rather than waiting for the
  // action to return — otherwise it only appears once the response is ready. Remix
  // still submits the form; clearing `input` here doesn't affect the in-flight
  // FormData (already captured from the DOM by the time React re-renders).
  const handleSubmit = () => {
    const trimmed = input.trim();
    // Don't append while history is still loading — the in-flight initial load would
    // overwrite the optimistic message (the input is also disabled in this state).
    if (!trimmed || loadingHistory) return;
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    pendingSubmitRef.current = trimmed;
    setInput("");
  };

  return (
    <div className="flex flex-col h-[calc(100vh-150px)] md:h-[calc(100vh-200px)] max-w-4xl mx-auto">
      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto mb-4 md:mb-6 space-y-4 md:space-y-6 px-2 md:px-4">
        {messages.length === 0 && !loadingHistory && !isSubmitting && (
          <div className="text-center py-8 md:py-12">
            <div className="w-12 h-12 md:w-16 md:h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 md:w-8 md:h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Welcome to ThreadMind
            </h3>
            <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 max-w-md mx-auto px-4">
              Start a conversation by typing a message below. I can help you
              with questions, analysis, and more.
            </p>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] md:max-w-[80%] p-3 md:p-4 ${
                message.role === "user" ? "message-user" : "message-assistant"
              } shadow-sm`}
            >
              <div className="flex items-start space-x-2 md:space-x-3">
                {message.role === "assistant" && (
                  <div className="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg
                      className="w-3 h-3 md:w-4 md:h-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                      />
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs md:text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    {message.role === "user" ? "You" : "AI Assistant"}
                  </div>
                  <div
                    className={`text-sm md:text-base leading-relaxed ${
                      message.role === "user" ? "whitespace-pre-wrap" : ""
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <MessageContent content={message.content} />
                    ) : message.content}
                  </div>
                </div>
                {message.role === "user" && (
                  <div className="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-r from-gray-500 to-gray-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg
                      className="w-3 h-3 md:w-4 md:h-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {streamingResponse && (
          <div className="flex justify-start">
            <div className="message-assistant max-w-[85%] md:max-w-[80%] p-3 md:p-4 shadow-sm">
              <div className="flex items-start space-x-2 md:space-x-3">
                <div className="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-3 h-3 md:w-4 md:h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs md:text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    AI Assistant
                  </div>
                  <div className="text-sm md:text-base leading-relaxed">
                    <MessageContent content={streamingResponse} />
                    <span className="inline-block w-2 h-4 bg-blue-500 dark:bg-blue-400 ml-1 animate-pulse" aria-hidden="true"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showThinking && !streamingResponse && (
          <div className="flex justify-start">
            <div className="message-assistant max-w-[85%] md:max-w-[80%] p-3 md:p-4 shadow-sm">
              <div className="flex items-start space-x-2 md:space-x-3">
                <div className="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-3 h-3 md:w-4 md:h-4 text-white animate-spin"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-xs md:text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    AI Assistant
                  </div>
                  <div className="text-sm md:text-base text-gray-600 dark:text-gray-400">
                    Thinking...
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {actionData?.error && (
          <div className="flex justify-start" role="alert" aria-live="assertive">
            <div className="max-w-[85%] md:max-w-[80%] p-3 md:p-4 shadow-sm rounded-2xl rounded-bl-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
              <div className="flex items-start space-x-2 md:space-x-3">
                <div className="w-6 h-6 md:w-8 md:h-8 bg-red-500 dark:bg-red-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-3 h-3 md:w-4 md:h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-xs md:text-sm font-medium text-red-800 dark:text-red-300 mb-1">
                    Error
                  </div>
                  <div className="text-sm md:text-base text-red-700 dark:text-red-200">
                    {actionData.error}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Container */}
      <div className="relative border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 md:p-4 rounded-b-xl">
        <Form
          method="post"
          onSubmit={handleSubmit}
          className="flex gap-2 md:gap-3 items-end"
        >
          <input type="hidden" name="conversationId" value={conversationId} />

          {/* File Upload Button */}
          <button
            type="button"
            className="relative group btn-secondary p-2 md:p-3 rounded-xl hover:scale-105 flex-shrink-0"
            onClick={handleFileIconClick}
            aria-label="Upload file"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-4 h-4 md:w-5 md:h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
              />
            </svg>
            <span className="absolute left-1/2 -translate-x-1/2 -top-10 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded-lg px-2 py-1 opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap z-10 hidden md:block">
              Upload file
            </span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Message Input */}
          <div className="flex-1 relative min-w-0">
            <input
              type="text"
              name="message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              className="input-modern w-full pr-10 md:pr-12 text-sm md:text-base"
              disabled={isSubmitting || loadingHistory}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !isSubmitting && !loadingHistory) {
                    e.currentTarget.form?.requestSubmit();
                  }
                }
              }}
            />
            <button
              type="submit"
              disabled={isSubmitting || loadingHistory || !input.trim()}
              className="absolute right-1 md:right-2 top-1/2 -translate-y-1/2 btn-primary p-1.5 md:p-2 rounded-lg"
            >
              <svg
                className="w-3 h-3 md:w-4 md:h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </Form>

        {/* Upload Status */}
        {uploading && (
          <div className="absolute mt-3 flex items-center space-x-2 text-blue-600 dark:text-blue-400">
            <svg
              className="w-4 h-4 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span className="text-sm">Uploading...</span>
          </div>
        )}

        {uploadMessage && (
          <div
            className={`absolute mt-3 text-sm animate-fade-out ${
              uploadMessage.includes("successfully")
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {uploadMessage}
          </div>
        )}
      </div>
    </div>
  );
}
