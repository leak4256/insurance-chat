import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText } from "lucide-react";
import type { UIMessage } from "ai";
import { sourceHref } from "@/lib/utils";
import { messageText, type KnownPages } from "./message-text";

interface Source {
  document: string;
  page: number | null;
  /** מקור חי (חיפוש באתר רשמי) — הקישור למסמך שנפתח */
  url?: string;
  /** מקור ממשלתי */
  official?: boolean;
  /** מסמך PDF — נפתח דרך /api/source כדי שלא יירד כקובץ */
  isPdf?: boolean;
}

/**
 * כמה מסמכי מאגר מוצגים לכל היותר. `search_knowledge` מחזיר עד
 * `config.rag.matchCount` קטעים (8 כברירת מחדל) — להציג את כולם יוצר רשימה
 * ארוכה שמרמזת שהתשובה נשענה על שמונה מסמכים, גם כשהיא נשענה על אחד.
 * הקטעים חוזרים מסודרים לפי דמיון, ולכן החיתוך משאיר את הרלוונטיים ביותר.
 */
const MAX_KNOWLEDGE_SOURCES = 3;

/**
 * ציטוטי מקור (FR-6): נגזרים מתוצאות הכלים שבתוך חלקי ההודעה —
 * `search_knowledge` (מסמכי המאגר) ו-`open_public_document` (מסמך רשמי שנפתח
 * בחיפוש החי). תוצאות חיפוש שלא נפתחו אינן מוצגות: התשובה לא מתבססת עליהן.
 *
 * המסמכים הרשמיים מוצגים ראשונים — הם המקור שהתשובה מצטטת, והיחידים שיש
 * להם קישור לחיצה.
 *
 * מסמכי המאגר חסומים ב-`MAX_KNOWLEDGE_SOURCES`, **אבל מסמך ששמו מופיע בטקסט
 * התשובה נכנס גם אם הוא מעל התקרה**: אחרת התשובה הייתה מסתיימת ב"מקור: X"
 * בלי תגית שתואמת לו, והלקוחה רואה ציטוט שאי אפשר לאמת.
 *
 * `knowledgeCited: false` מסתיר את תגיות המאגר לגמרי ומשאיר רק מסמכים רשמיים
 * שנפתחו בחיפוש החי. המתקשר קובע זאת לפי `citesKnowledgeDocument` — תשובה בלי
 * שורת "מקור:" מאומתת אינה מצטטת מסמך, ולכן אין לה תגיות מסמכים.
 */
/**
 * שמות המסמכים שבאמת חזרו מכלי ב**כל השיחה** — הבסיס לאימות שורת ה"מקור:"
 * (ר' `stripUnverifiedSourceLine` ב-message-text.ts).
 *
 * נאסף על פני כל ההודעות ולא על ההודעה הנוכחית בלבד, כי תשובה יכולה לצטט
 * בצדק מסמך שחזר בתור קודם ונותר בהקשר (נצפה 04.11.2026). מסמכים רשמיים
 * מהחיפוש החי נכללים גם הם: הפרומפט מייחד את שורת "מקור:" למסמכי המאגר,
 * אבל ציטוט אמיתי של מסמך שנפתח אינו שגיאה שצריך להסתיר.
 */
export function knowledgeDocuments(messages: UIMessage[]): string[] {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!("state" in part) || part.state !== "output-available") continue;

      if (part.type === "tool-search_knowledge") {
        const output = part.output as
          | { found: boolean; chunks: { document: string }[] }
          | undefined;
        if (!output?.found) continue;
        for (const chunk of output.chunks) if (chunk.document) names.add(chunk.document);
        continue;
      }

      if (part.type === "tool-open_public_document") {
        const output = part.output as
          | { found: boolean; title?: string | null; host?: string }
          | undefined;
        if (!output?.found) continue;
        const title = output.title?.trim();
        if (title) names.add(title);
        if (output.host) names.add(output.host);
      }
    }
  }
  return [...names];
}

/**
 * מספרי העמודים שחזרו מ-`search_knowledge` בכל השיחה, לפי שם מסמך — הבסיס
 * להסרת עמוד מומצא משורת ה"מקור:" (ר' `stripUnverifiedPageRefs`). קטע בלי עמוד
 * (`page: null`, כל מסמכי ה-txt) לא מוסיף דבר, ולכן מסמך כזה נשאר בלי עמודים
 * מותרים. נאסף על פני כל ההודעות מאותה סיבה כמו `knowledgeDocuments`.
 */
export function knowledgePages(messages: UIMessage[]): KnownPages {
  const pages: KnownPages = new Map();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!("state" in part) || part.state !== "output-available") continue;
      if (part.type !== "tool-search_knowledge") continue;
      const output = part.output as
        | { found: boolean; chunks: { document: string; page: number | null }[] }
        | undefined;
      if (!output?.found) continue;
      for (const chunk of output.chunks) {
        if (!chunk.document || chunk.page == null) continue;
        const set = pages.get(chunk.document) ?? new Set<number>();
        set.add(chunk.page);
        pages.set(chunk.document, set);
      }
    }
  }
  return pages;
}

export function extractSources(
  message: UIMessage,
  options?: { knowledgeCited?: boolean },
): Source[] {
  const knowledge = new Map<string, Source>();
  const sources = new Map<string, Source>();
  for (const part of message.parts) {
    if (!("state" in part) || part.state !== "output-available") continue;

    if (part.type === "tool-search_knowledge") {
      const output = part.output as
        | { found: boolean; chunks: { document: string; page: number | null }[] }
        | undefined;
      if (!output?.found) continue;
      for (const chunk of output.chunks) {
        // לפי מסמך ולא לפי מסמך+עמוד: שלושה קטעים מאותו מסמך הם מקור אחד
        if (!knowledge.has(chunk.document)) {
          knowledge.set(chunk.document, { document: chunk.document, page: chunk.page });
        }
      }
      continue;
    }

    if (part.type === "tool-open_public_document") {
      const output = part.output as
        | {
            found: boolean;
            url?: string;
            host?: string;
            title?: string | null;
            official?: boolean;
            kind?: string;
          }
        | undefined;
      if (!output?.found || !output.url) continue;
      if (!sources.has(output.url)) {
        sources.set(output.url, {
          document: output.title?.trim() || output.host || output.url,
          page: null,
          url: output.url,
          official: output.official,
          isPdf: output.kind === "pdf",
        });
      }
    }
  }
  // תשובה שאינה מצטטת מסמך מאגר — רק המקורות הרשמיים שנפתחו, בלי תגיות מאגר
  if (options?.knowledgeCited === false) return [...sources.values()];

  const ranked = [...knowledge.values()];
  const answer = messageText(message);
  const beyondCap = ranked
    .slice(MAX_KNOWLEDGE_SOURCES)
    .filter((s) => s.document.length > 0 && answer.includes(s.document));

  return [...sources.values(), ...ranked.slice(0, MAX_KNOWLEDGE_SOURCES), ...beyondCap];
}

export function SourceChips({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="מקורות">
      {sources.map((s) =>
        s.url ? (
          <a
            key={s.url}
            href={sourceHref(s.url, s.isPdf)}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="no-underline"
          >
            <Badge
              variant="outline"
              className="max-w-[16rem] text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{s.document}</span>
            </Badge>
          </a>
        ) : (
          <Badge
            key={`${s.document}#${s.page ?? ""}`}
            variant="outline"
            className="text-muted-foreground"
          >
            <FileText className="h-3 w-3" aria-hidden />
            {s.document}
            {s.page != null && <span>· עמ&#39; {s.page}</span>}
          </Badge>
        ),
      )}
    </div>
  );
}
