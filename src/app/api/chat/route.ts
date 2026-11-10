import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { getChatModel, getSummaryModel } from "@/ai/provider";
import { buildSystemPrompt } from "@/ai/system-prompt";
import { buildTools } from "@/ai/tools";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { isWebSearchConfigured } from "@/lib/web-search";
import {
  customerSessionSetCookieHeader,
  getCustomerSession,
  type CustomerSession,
} from "@/lib/session";

export const maxDuration = 120;

/**
 * תקרת שלבים לבקשה אחת. חיפוש חי צורך שלבים: מאגר → חיפוש → פתיחת מסמך
 * (ולפעמים עוד אחד) → תשובה.
 *
 * ב**שלב האחרון הכלים מנוטרלים** (`toolChoice: "none"`), אבל זו אינה ערובה —
 * ר' ההערה ב-prepareStep למטה. מה שבאמת מונע הגעה לתקרה הוא
 * `MAX_LIVE_SEARCH_CALLS` ב-src/ai/tools.ts: בלעדיו המודל קורא לחיפוש החי
 * שוב ושוב כשהאתר הציבורי מחזיר שגיאה, מרוקן את שמונת השלבים, והלקוחה מקבלת
 * תשובה ריקה. במדידה מ-09.11 אחרי התקרה: 4–5 שלבים לשאלה, ולא 8.
 */
const MAX_STEPS = 8;

function jsonError(status: number, message: string, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

/** טקסט ההודעה מתוך חלקי UIMessage */
function messageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * זיכרון שיחה (אפיון סעיף 8): חלון הזזה של ההודעות האחרונות; מעל החלון —
 * ההודעות הישנות מסוכמות. הסיכום נשמר בזיכרון התהליך בלבד (שום דבר במסד).
 */
const summaryCache = new Map<string, { olderCount: number; summary: string }>();

/**
 * כל כמה הודעות גבול הסיכום זז. בלי העיגול הגבול זחל בשתי הודעות בכל תור,
 * המטמון החטיא בכל תור, והסיכום נבנה מחדש על כל הבלוק הישן — שרק גדל. זו גם
 * קריאת LLM ש-`await`-ים עליה **לפני** שהסטרימינג מתחיל, כלומר הלקוחה מחכה לה.
 *
 * העיגול הוא כלפי מטה, ו**חלון ההודעות המלאות מתחיל בדיוק בגבול הזה** ולא
 * במספר קבוע. זה העיקר: אחרת היו נופלות בין הכיסאות ההודעות שבין סוף הסיכום
 * לתחילת החלון — לא בסיכום ולא בטקסט המלא. במחיר הזה החלון גדל בעד
 * SUMMARY_REBUILD_EVERY הודעות בין בנייה לבנייה, וזה זול בהרבה מקריאה נוספת.
 */
const SUMMARY_REBUILD_EVERY = 6;

/**
 * כמה הודעות מתחילת השיחה נכנסות לסיכום: מה שחורג מחלון ההזזה, מעוגל למטה
 * לכפולה של SUMMARY_REBUILD_EVERY. 0 = אין מה לסכם, השיחה נשלחת במלואה.
 */
export function summaryBoundary(messageCount: number, windowSize: number): number {
  const beyondWindow = messageCount - windowSize;
  if (beyondWindow <= 0) return 0;
  return Math.floor(beyondWindow / SUMMARY_REBUILD_EVERY) * SUMMARY_REBUILD_EVERY;
}

async function summarizeOlderMessages(chatId: string, older: UIMessage[]): Promise<string> {
  const cached = summaryCache.get(chatId);
  if (cached && cached.olderCount === older.length) return cached.summary;

  const transcript = older
    .map((m) => `${m.role === "user" ? "לקוח" : "עוזר"}: ${messageText(m)}`)
    .filter((line) => line.trim().length > 0)
    .join("\n");

  const { text } = await generateText({
    model: getSummaryModel(),
    system:
      "סכמו את קטע השיחה הבא בין לקוח לעוזר ביטוח דיגיטלי. עד 8 שורות בעברית. שמרו על עובדות, שאלות פתוחות והעדפות שהלקוח ציין. אל תוסיפו מידע חדש.",
    prompt: transcript,
  });

  summaryCache.set(chatId, { olderCount: older.length, summary: text });
  if (summaryCache.size > 1000) {
    const firstKey = summaryCache.keys().next().value;
    if (firstKey) summaryCache.delete(firstKey);
  }
  return text;
}

export async function POST(req: Request) {
  // הגבלת קצב לפי IP (מאחורי proxy של Railway — הכתובת ב-x-forwarded-for)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return jsonError(429, "שלחתם הרבה הודעות ברצף — נסו שוב בעוד כמה דקות.", {
      "Retry-After": String(rl.retryAfterSec ?? 60),
    });
  }

  const body = (await req.json().catch(() => null)) as
    | { id?: string; messages?: UIMessage[] }
    | null;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, "בקשה לא תקינה.");
  }
  const { messages } = body;
  const chatId = typeof body.id === "string" ? body.id : "anonymous";

  if (messages.length > config.chat.maxMessagesPerRequest) {
    return jsonError(400, "השיחה ארוכה מדי — רעננו את הדף כדי להתחיל שיחה חדשה.");
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user") return jsonError(400, "בקשה לא תקינה.");
  if (messageText(last).length > config.chat.maxMessageChars) {
    return jsonError(413, `ההודעה ארוכה מדי (מקסימום ${config.chat.maxMessageChars} תווים).`);
  }

  // מצב הזדהות (שלב 2): קובע אילו כלים נרשמים למודל — רישום צד-שרת בלבד (אפיון 6.2)
  let session: CustomerSession | null = null;
  try {
    session = await getCustomerSession();
  } catch {
    // SESSION_SECRET לא מוגדר — הצ'אט ממשיך במצב אנונימי
  }

  try {
    let windowed = messages;
    let historySummary: string | undefined;
    const covered = summaryBoundary(messages.length, config.chat.historyWindow);
    if (covered > 0) {
      // החלון מתחיל בדיוק בגבול הסיכום — הסיכום והטקסט המלא מכסים יחד את כל
      // השיחה, בלי פער ובלי כפילות (ר' SUMMARY_REBUILD_EVERY)
      windowed = messages.slice(covered);
      historySummary = await summarizeOlderMessages(chatId, messages.slice(0, covered));
    }

    const result = streamText({
      model: getChatModel(),
      system: buildSystemPrompt({
        historySummary,
        customerFirstName: session ? session.firstName : null,
        liveSearch: isWebSearchConfigured(),
      }),
      messages: convertToModelMessages(windowed),
      tools: buildTools(session),
      // stepNumber מתחיל ב-0, כך שהשלב המותר האחרון הוא MAX_STEPS - 1.
      //
      // `activeTools: []` מסיר את הכלים מהבקשה לגמרי, ו-`toolChoice: "none"`
      // נשאר כהצהרה נוספת. **שימו לב ששניהם יחד אינם ערובה:** במדידה מ-09.11
      // נשלח לשלב האחרון `tools=null toolConfig=null` — אפס כלים — ו-Gemini
      // בכל זאת החזיר קריאה ל-`open_public_document` מתוך הקשר השיחה, כלומר
      // תשובה באורך 0. רשת הביטוח ללקוחה היא המשפט החלופי ב-message-bubble.tsx.
      // ר' הרוויזיה 09.11 ב-docs/decisions.md.
      prepareStep: ({ stepNumber }) =>
        stepNumber === MAX_STEPS - 1 ? { toolChoice: "none", activeTools: [] } : undefined,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    return result.toUIMessageStreamResponse({
      // הארכת session מתגלגלת: כל בקשה מאומתת מאפסת את חלון השעתיים (אפיון 6.1)
      headers: session ? { "Set-Cookie": customerSessionSetCookieHeader(session) } : undefined,
    });
  } catch (err) {
    console.error("chat route error:", err);
    return jsonError(500, "משהו השתבש אצלנו. נסו שוב בעוד רגע.");
  }
}
