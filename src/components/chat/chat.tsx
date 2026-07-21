"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatHeader, type AuthState } from "./chat-header";
import { LoginCard } from "./login-card";
import { MessageBubble, TypingIndicator } from "./message-bubble";

const MAX_MESSAGE_CHARS = 2000;

const SUGGESTIONS = [
  "מה זה השתתפות עצמית?",
  "מה ההבדל בין ביטוח צד ג' לביטוח מקיף?",
  "מה כדאי לבדוק לפני שקונים ביטוח דירה?",
];

function hasVisibleText(message: UIMessage): boolean {
  return message.parts.some((p) => p.type === "text" && p.text.trim().length > 0);
}

function hasLoginRequest(message: UIMessage): boolean {
  return message.parts.some((p) => p.type === "tool-request_login");
}

export function Chat() {
  const [auth, setAuth] = useState<AuthState>({ authenticated: false });
  const [headerCardOpen, setHeaderCardOpen] = useState(false);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, error, addToolResult } = useChat({
    // כלי צד-לקוח (FR-3): המודל מבקש להציג את כרטיס ההתחברות; ה-UI מצייר אותו
    async onToolCall({ toolCall }) {
      if (toolCall.toolName === "request_login") {
        addToolResult({
          tool: "request_login",
          toolCallId: toolCall.toolCallId,
          output: "כרטיס ההתחברות הוצג ללקוח בצ'אט.",
        });
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // מצב ההזדהות נטען מהשרת (cookie httpOnly — לדפדפן אין גישה ישירה)
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setAuth({ authenticated: !!d.authenticated, firstName: d.firstName }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status, headerCardOpen]);

  // כרטיס ההתחברות מוצג רק אחרי ההודעה האחרונה שביקשה אותו
  const lastLoginRequestId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (hasLoginRequest(messages[i])) return messages[i].id;
    }
    return null;
  }, [messages]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
    inputRef.current?.focus();
  }

  function handleLoginSuccess(firstName: string, fromTool: boolean) {
    setAuth({ authenticated: true, firstName });
    // המשך שיחה טבעי (אפיון 12): אחרי הזדהות שנפתחה משאלה אישית —
    // הודעה קצרה שמחזירה את המודל לשאלה שנשארה פתוחה
    if (fromTool) sendMessage({ text: "התחברתי ✅" });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAuth({ authenticated: false });
    setHeaderCardOpen(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader
        auth={auth}
        onLoginClick={() => setHeaderCardOpen(true)}
        onLogout={handleLogout}
      />

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
            <div key={message.id} className="flex flex-col gap-3">
              {(message.role === "user" || hasVisibleText(message) || busy) && (
                <MessageBubble message={message} />
              )}
              {/* הכרטיס נשאר גם אחרי הצלחה — הוא מציג בעצמו אישור "התחברתם בהצלחה" */}
              {message.id === lastLoginRequestId && (
                <LoginCard onSuccess={(name) => handleLoginSuccess(name, true)} />
              )}
            </div>
          ))}

          {/* כרטיס מכפתור הכותרת — רק כשאין כבר כרטיס שנפתח מתוך השיחה */}
          {headerCardOpen && lastLoginRequestId === null && (
            <LoginCard onSuccess={(name) => handleLoginSuccess(name, false)} />
          )}

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
