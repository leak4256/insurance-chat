"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brand } from "@/lib/brand";
import { AdminCard } from "./admin-card";
import { ChatHeader, type AuthState } from "./chat-header";
import { LoginCard } from "./login-card";
import { messageText, mentionsLoginTool, stripLoginToolText } from "./message-text";
import { MessageBubble, TypingIndicator } from "./message-bubble";
import { SessionExpiryDialog } from "./session-expiry-dialog";
import { knowledgeDocuments } from "./sources";

const MAX_MESSAGE_CHARS = 2000;

const SUGGESTIONS = [
  "מה זה השתתפות עצמית?",
  "מה ההבדל בין ביטוח צד ג' לביטוח מקיף?",
  "מה כדאי לבדוק לפני שקונים ביטוח דירה?",
];

function hasVisibleText(message: UIMessage): boolean {
  // אחרי ניקוי אזכור הכלי — הודעה שכולה "request_login" לא תצייר בועה ריקה
  return stripLoginToolText(messageText(message)).length > 0;
}

/**
 * בקשת התחברות — קריאה לכלי, או אזכור שלו בטקסט כשהמודל כתב את שמו במקום
 * לקרוא לו. בשני המקרים הלקוחה מקבלת את כרטיס ההתחברות.
 */
function hasLoginRequest(message: UIMessage): boolean {
  if (message.parts.some((p) => p.type === "tool-request_login")) return true;
  return message.role === "assistant" && mentionsLoginTool(messageText(message));
}

export function Chat() {
  const [auth, setAuth] = useState<AuthState>({ authenticated: false });
  // מתי נפתחת הודעת הניתוק ומתי הניתוק בפועל (epoch ms מקומי); null = לא מחוברים
  const [deadlines, setDeadlines] = useState<{ warnAt: number; expiresAt: number } | null>(null);
  const [headerCardOpen, setHeaderCardOpen] = useState(false);
  // מזהה ההודעה שאחריה נפתח כרטיס הכותרת — מעגן אותו במקומו בשיחה,
  // אחרת גם אישור "התחברתם בהצלחה" היה נדחף אחרי כל הודעה חדשה.
  // null = נפתח לפני שהייתה הודעה כלשהי → מוצג בראש השיחה.
  const [headerCardAnchorId, setHeaderCardAnchorId] = useState<string | null>(null);
  const [adminCardOpen, setAdminCardOpen] = useState(false);
  // כפתור כניסת המנהל מוסתר מלקוחות — מופיע רק בכתובת עם ?admin
  const [showAdminEntry, setShowAdminEntry] = useState(false);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, setMessages, status, error, addToolResult } = useChat({
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

  // מצב ההזדהות נטען מהשרת (cookie httpOnly — לדפדפן אין גישה ישירה).
  // כולל הזמנים עד הודעת הניתוק — כך ההתחברות (והספירה) שורדות רענון עמוד.
  function applySession(d: {
    authenticated?: boolean;
    firstName?: string;
    admin?: boolean;
    viaAdmin?: boolean;
    warnInMs?: number;
    expiresInMs?: number;
  }) {
    // admin/viaAdmin חסרים בתשובת ההארכה — אז נשמר המצב הקיים
    if (!d.authenticated) {
      setAuth((a) => ({ authenticated: false, admin: d.admin ?? a.admin }));
      setDeadlines(null);
      return;
    }
    setAuth((a) => ({
      authenticated: true,
      firstName: d.firstName,
      admin: d.admin ?? a.admin,
      viaAdmin: d.viaAdmin ?? a.viaAdmin,
    }));
    const now = Date.now();
    setDeadlines(
      typeof d.warnInMs === "number" && typeof d.expiresInMs === "number"
        ? { warnAt: now + d.warnInMs, expiresAt: now + d.expiresInMs }
        : null,
    );
  }

  useEffect(() => {
    const adminEntry = new URLSearchParams(window.location.search).has("admin");
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        setShowAdminEntry(adminEntry || !!d.admin);
        applySession(d);
      })
      .catch(() => setShowAdminEntry(adminEntry));
  }, []);

  // כל הודעה מאומתת מאריכה את ה-session בשרת (Set-Cookie בתשובת הצ'אט) —
  // בסיום התשובה טוענים את הזמנים מחדש, כדי שהודעת הניתוק תזוז יחד איתו
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    if (!auth.authenticated) return;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then(applySession)
      .catch(() => {});
  }, [busy, auth.authenticated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status, headerCardOpen, adminCardOpen]);

  // כרטיס ההתחברות מוצג רק אחרי ההודעה האחרונה שביקשה אותו
  const lastLoginRequestId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (hasLoginRequest(messages[i])) return messages[i].id;
    }
    return null;
  }, [messages]);

  // כרטיס הכותרת מוצג רק כשאין כבר כרטיס שנפתח מתוך השיחה (מניעת כפילות)
  const showHeaderCard = headerCardOpen && lastLoginRequestId === null;

  // המסמכים שחזרו מכלים בשיחה — לאימות שורת ה"מקור:" בכל בועה
  const knownDocuments = useMemo(() => knowledgeDocuments(messages), [messages]);
  // ההודעה שנכתבת כרגע: האימות עליה מחכה לסיום ההזרמה
  const streamingId = busy && messages.length > 0 ? messages[messages.length - 1].id : null;

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
    inputRef.current?.focus();
  }

  function handleLoginSuccess(firstName: string, fromTool: boolean) {
    setAuth({ authenticated: true, firstName });
    // הזמנים של ההתחברות החדשה מגיעים מהשרת (אותו מקור אמת כמו אחרי רענון)
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then(applySession)
      .catch(() => {});
    // המשך שיחה טבעי (אפיון 12): אחרי הזדהות שנפתחה משאלה אישית —
    // הודעה קצרה שמחזירה את המודל לשאלה שנשארה פתוחה
    if (fromTool) sendMessage({ text: "התחברתי ✅" });
  }

  function openHeaderCard() {
    setHeaderCardAnchorId(messages.length > 0 ? messages[messages.length - 1].id : null);
    setHeaderCardOpen(true);
  }

  function handleAdminSelected(firstName: string) {
    // שיחה חדשה לכל לקוח — אחרת ההיסטוריה (ונתוני הלקוח הקודם שבה) נשלחת למודל
    setMessages([]);
    setAuth({ authenticated: true, firstName, admin: true, viaAdmin: true });
    // הזמנים להודעת הניתוק — מהשרת, כמו אחרי התחברות רגילה
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then(applySession)
      .catch(() => {});
    setAdminCardOpen(false);
    setHeaderCardOpen(false);
    setHeaderCardAnchorId(null);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAuth({ authenticated: false });
    setDeadlines(null);
    setAdminCardOpen(false);
    setHeaderCardOpen(false);
    setHeaderCardAnchorId(null);
  }

  // ביטול הניתוק: השרת מנפיק session חדש לשעתיים
  async function handleExtendSession(): Promise<boolean> {
    try {
      const res = await fetch("/api/auth/extend", { method: "POST" });
      if (res.status === 401) {
        // ה-session כבר פג — אין מה להאריך
        applySession({ authenticated: false });
        return false;
      }
      if (!res.ok) return false;
      applySession(await res.json());
      return true;
    } catch {
      return false;
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader
        auth={auth}
        onLoginClick={openHeaderCard}
        onLogout={handleLogout}
        showAdminEntry={showAdminEntry}
        onAdminClick={() => setAdminCardOpen(true)}
      />

      {auth.authenticated && deadlines && (
        <SessionExpiryDialog
          warnAt={deadlines.warnAt}
          expiresAt={deadlines.expiresAt}
          onExtend={handleExtendSession}
          onExpired={handleLogout}
          onLogout={handleLogout}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite" aria-label="הודעות השיחה">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
          {messages.length === 0 && (
            <div className="my-10 flex flex-col items-center gap-4 text-center">
              <h2 className="text-xl font-semibold">שלום! 👋</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                אני {brand.name}. תוכל לשאול אותי כל שאלה על ביטוח ופיננסים ועל המוצרים שלך
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

          {/* כרטיס כותרת שנפתח לפני ההודעה הראשונה — מעוגן בראש השיחה */}
          {showHeaderCard && headerCardAnchorId === null && (
            <LoginCard onSuccess={(name) => handleLoginSuccess(name, false)} />
          )}

          {messages.map((message) => (
            <div key={message.id} className="flex flex-col gap-3">
              {/* `!hasLoginRequest` מצייר בועה גם לתשובה שהסתיימה ריקה — שם
                  MessageBubble מציג משפט חלופי, כדי שלא יישאר מסך ריק.
                  הודעה שכל תוכנה בקשת התחברות נשארת בלי בועה: יש לה כרטיס. */}
              {(message.role === "user" ||
                hasVisibleText(message) ||
                busy ||
                !hasLoginRequest(message)) && (
                <MessageBubble
                  message={message}
                  knownDocuments={knownDocuments}
                  streaming={message.id === streamingId}
                />
              )}
              {/* הכרטיס נשאר גם אחרי הצלחה — הוא מציג בעצמו אישור "התחברתם בהצלחה" */}
              {message.id === lastLoginRequestId && (
                <LoginCard onSuccess={(name) => handleLoginSuccess(name, true)} />
              )}
              {/* כרטיס הכותרת מעוגן להודעה שאחריה נפתח — ולא נדחף לתחתית */}
              {showHeaderCard && message.id === headerCardAnchorId && (
                <LoginCard onSuccess={(name) => handleLoginSuccess(name, false)} />
              )}
            </div>
          ))}

          {status === "submitted" && <TypingIndicator />}

          {adminCardOpen && (
            <AdminCard
              alreadyAdmin={!!auth.admin}
              onAdminLogin={() => setAuth((a) => ({ ...a, admin: true }))}
              onSelected={handleAdminSelected}
              onCancel={() => setAdminCardOpen(false)}
            />
          )}

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
            placeholder="מה אתם רוצים לדעת?"
            maxLength={MAX_MESSAGE_CHARS}
            aria-label="הודעה לעוזר הדיגיטלי"
            autoFocus
          />
          <Button type="submit" size="icon" disabled={busy || input.trim().length === 0} aria-label="שליחה">
            <SendHorizontal className="rtl:-scale-x-100" aria-hidden />
          </Button>
        </form>
        <p className="pb-2 text-center text-[11px] text-muted-foreground">
          התשובות נוצרות על ידי AI ועלולות לכלול טעויות — מידע חשוב כדאי לוודא מול מסמכי הפוליסה או הסוכן/ת.
        </p>
      </div>
    </div>
  );
}
