import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { UIMessage } from "ai";
import { cn, sourceHref } from "@/lib/utils";
import {
  citesKnowledgeDocument,
  mentionsLoginTool,
  messageText,
  stripLoginToolText,
  stripUnverifiedPageRefs,
  stripUnverifiedSourceLine,
  type KnownPages,
} from "./message-text";
import { extractSources, SourceChips } from "./sources";

/** מה הצ'אט עושה כרגע, לפי הכלי שנמצא בריצה */
function pendingLabel(message: UIMessage): string | null {
  const running = (type: string) =>
    message.parts.some(
      (p) =>
        p.type === type &&
        "state" in p &&
        (p.state === "input-streaming" || p.state === "input-available"),
    );
  if (running("tool-search_knowledge")) return "מחפש במאגר הידע…";
  if (running("tool-search_public_sources")) return "מחפש באתרים הרשמיים…";
  if (running("tool-open_public_document")) return "קורא את המסמך הרשמי…";
  return null;
}

/** בקשת התחברות — כלי או אזכור בטקסט. להודעה כזו יש כרטיס, ולא חסרה תשובה. */
function requestsLogin(message: UIMessage): boolean {
  return (
    message.parts.some((p) => p.type === "tool-request_login") ||
    mentionsLoginTool(messageText(message))
  );
}

/**
 * תשובה שהסתיימה בלי שום טקסט.
 *
 * קורה כששרשרת הכלים מיצתה את תקרת השלבים — נצפה 08.11.2026 בשאלה על שינוי
 * 2013, אחרי חיפוש חי שנכשל ב-HTTP 418. `prepareStep` שמנטרל כלים בשלב
 * האחרון מקטין את הסיכוי אבל אינו מבטל אותו, ובלי המשפט הזה הלקוחה רואה את
 * השאלה שלה ו**שום דבר אחריה** — בלי בועה ובלי שגיאה.
 */
const EMPTY_ANSWER_FALLBACK =
  "לא הצלחתי להפיק תשובה לשאלה הזו. אפשר לנסח אותה מחדש, או לשאול אותי משהו אחר.";

/**
 * קישורים בתשובה (מסמכים רשמיים מהחיפוש החי) נפתחים בלשונית חדשה,
 * וקובצי PDF עוברים דרך /api/source כדי שייפתחו לצפייה ולא יירדו למחשב.
 */
const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href ? sourceHref(href) : href}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      {children}
    </a>
  ),
};

const NO_PAGES: KnownPages = new Map();

export function MessageBubble({
  message,
  knownDocuments = [],
  knownPages = NO_PAGES,
  streaming = false,
}: {
  message: UIMessage;
  /** מסמכי השיחה לאימות שורת ה"מקור:" (ר' knowledgeDocuments ב-sources.tsx) */
  knownDocuments?: string[];
  /** עמודי המסמכים שחזרו בשיחה — להסרת "עמ' N" שאין לו כיסוי (ר' knowledgePages) */
  knownPages?: KnownPages;
  /** ההודעה עדיין נכתבת — אימות שורת המקור מחכה לסיום, אחרת השורה מהבהבת */
  streaming?: boolean;
}) {
  const isUser = message.role === "user";
  // האזכור בטקסט מוסר מההצגה; הכרטיס עצמו נפתח ב-chat.tsx (ר' message-text.ts)
  const assistantText = stripLoginToolText(messageText(message));
  const text = isUser
    ? messageText(message)
    : streaming
      ? assistantText
      : stripUnverifiedPageRefs(
          stripUnverifiedSourceLine(assistantText, knownDocuments),
          knownPages,
        );
  // תגיות מסמכי המאגר רק כשהתשובה באמת מצטטת מסמך. בזמן ההזרמה שורת ה"מקור:"
  // עוד לא נכתבה, ולכן התגיות מופיעות עם סיום התשובה — יחד עם הציטוט עצמו.
  const sources = isUser
    ? []
    : extractSources(message, {
        knowledgeCited: !streaming && citesKnowledgeDocument(assistantText, knownDocuments),
      });

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser
            ? "brand-fill rounded-tl-md bg-primary text-primary-foreground"
            : "rounded-tr-md border bg-card text-card-foreground",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{text}</p>
        ) : (
          <>
            {!text && pendingLabel(message) && (
              <p className="text-muted-foreground">{pendingLabel(message)}</p>
            )}
            {!text && !streaming && !pendingLabel(message) && !requestsLogin(message) && (
              <p>{EMPTY_ANSWER_FALLBACK}</p>
            )}
            <div className="chat-markdown">
              <ReactMarkdown components={markdownComponents}>{text}</ReactMarkdown>
            </div>
            <SourceChips sources={sources} />
          </>
        )}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex w-full justify-start" aria-label="העוזר מקליד">
      <div className="rounded-2xl rounded-tr-md border bg-card px-4 py-3 shadow-sm">
        <span className="flex gap-1">
          <span className="typing-dot h-2 w-2 rounded-full bg-muted-foreground" />
          <span className="typing-dot h-2 w-2 rounded-full bg-muted-foreground" />
          <span className="typing-dot h-2 w-2 rounded-full bg-muted-foreground" />
        </span>
      </div>
    </div>
  );
}
