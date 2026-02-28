"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getTokens } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED = [
  "Which position has the worst ROI this week?",
  "Any positions I should roll or close soon?",
  "How is my cost basis reduction going?",
  "Am I over-concentrated in any stock?",
  "Summarize this week's P&L",
];

export default function AiChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = useCallback(async (text: string) => {
    const userMsg = text.trim();
    if (!userMsg || streaming) return;

    setError(null);
    const newMessages: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    // Append empty assistant message to stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const { access } = getTokens();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          messages: newMessages,
          accessToken: access,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `⚠️ ${err.error ?? "Something went wrong"}`,
          };
          return updated;
        });
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: updated[updated.length - 1].content + chunk,
          };
          return updated;
        });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError("Connection failed. Is the backend running?");
      setMessages((prev) => prev.slice(0, -1)); // remove empty assistant msg
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [messages, streaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
    setError(null);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="AI Assistant"
        className={[
          "fixed bottom-20 right-4 z-50 lg:bottom-6 lg:right-6",
          "w-12 h-12 rounded-full shadow-lg flex items-center justify-center",
          "transition-all duration-200",
          open
            ? "bg-[var(--foreground)] text-[var(--background)]"
            : "bg-blue-600 text-white hover:bg-blue-500",
        ].join(" ")}
      >
        {open ? (
          // X icon
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          // Sparkle / AI icon
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      <div
        className={[
          "fixed z-40 inset-x-0 bottom-0 lg:inset-x-auto lg:right-6 lg:bottom-20",
          "lg:w-[420px] lg:rounded-2xl",
          "bg-[var(--surface)] border border-[var(--border)] shadow-2xl",
          "flex flex-col transition-all duration-300 ease-out",
          open ? "h-[70dvh] lg:h-[600px] opacity-100 pointer-events-auto" : "h-0 opacity-0 pointer-events-none overflow-hidden",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
              </svg>
            </div>
            <span className="font-semibold text-sm text-foreground">OptionFlow AI</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-semibold">GPT-4o mini</span>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button onClick={handleClear} className="text-[11px] text-foreground/40 hover:text-foreground/70 transition">Clear</button>
            )}
            <button onClick={() => setOpen(false)} className="text-foreground/40 hover:text-foreground/70 transition">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col gap-2 pt-2">
              <p className="text-xs text-foreground/50 mb-1">Ask me anything about your portfolio:</p>
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-xs px-3 py-2 rounded-xl bg-[var(--surface-2)] hover:bg-blue-50 dark:hover:bg-blue-900/20 text-foreground/70 hover:text-blue-600 dark:hover:text-blue-400 transition border border-[var(--border)] hover:border-blue-300 dark:hover:border-blue-700"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={[
                  "max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-[var(--surface-2)] text-foreground rounded-bl-sm border border-[var(--border)]",
                ].join(" ")}
              >
                {msg.content === "" && msg.role === "assistant" ? (
                  <span className="inline-flex gap-1 items-center text-foreground/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}
              </div>
            </div>
          ))}

          {error && (
            <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-xl border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-3 pb-3 pt-2 border-t border-[var(--border)]">
          <div className="flex items-end gap-2 bg-[var(--surface-2)] rounded-2xl border border-[var(--border)] px-3 py-2 focus-within:border-blue-400 transition">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your positions…"
              rows={1}
              disabled={streaming}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 resize-none outline-none max-h-32 disabled:opacity-50"
              style={{ lineHeight: "1.5" }}
            />
            {streaming ? (
              <button
                onClick={handleStop}
                className="shrink-0 w-8 h-8 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center transition"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="white">
                  <rect x="1" y="1" width="8" height="8" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                onClick={() => send(input)}
                disabled={!input.trim()}
                className="shrink-0 w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
          <p className="text-[10px] text-foreground/30 mt-1.5 text-center">Enter to send · Shift+Enter for newline · Not financial advice</p>
        </div>
      </div>

      {/* Backdrop on mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
