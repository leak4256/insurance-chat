"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatHeader } from "./chat-header";
import { MessageBubble, TypingIndicator } from "./message-bubble";

const MAX_MESSAGE_CHARS = 2000;

const SUGGESTIONS = [
  "מה זה השתתפות עצמית?",
  "מה ההבדל בין ביטוח צד ג' לביטוח מקיף?",
  "מה כדאי לבדוק לפני שקונים ביטוח דירה?",
];

export function Chat() {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader />

      <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite" aria-label="הודעות השיחה">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
          {messages.length === 0 && (
            <div className="my-10 flex flex-col items-center gap-4 text-center">
              <h2 className="text-xl font-semibold">שלום! 👋</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                אני העוזר הדיגיטלי של הסוכנות. אפשר לשאול אותי כל שאלה כללית על ביטוח —
                ואני אענה בפשטות, על סמך מסמכי הידע של הסוכנות.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((q) => (
                  <Button key={q} variant="outline" size="sm" onClick={() => submit(q)}>
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {status === "submitted" && <TypingIndicator />}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
              משהו השתבש בשליחת ההודעה. נסו שוב בעוד רגע.
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t bg-card">
        <form
          className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="כתבו שאלה על ביטוח…"
            maxLength={MAX_MESSAGE_CHARS}
            aria-label="הודעה לעוזר הדיגיטלי"
            autoFocus
          />
          <Button type="submit" size="icon" disabled={busy || input.trim().length === 0} aria-label="שליחה">
            <SendHorizontal className="rtl:-scale-x-100" aria-hidden />
          </Button>
        </form>
        <p className="pb-2 text-center text-[11px] text-muted-foreground">
          המידע כללי בלבד ואינו מחייב — הנוסח הקובע הוא במסמכי הפוליסה.
        </p>
      </div>
    </div>
  );
}
