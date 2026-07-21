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
import {
  customerSessionSetCookieHeader,
  getCustomerSession,
  type CustomerSession,
} from "@/lib/session";

export const maxDuration = 120;

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
    if (messages.length > config.chat.historyWindow) {
      const older = messages.slice(0, messages.length - config.chat.historyWindow);
      windowed = messages.slice(-config.chat.historyWindow);
      historySummary = await summarizeOlderMessages(chatId, older);
    }

    const result = streamText({
      model: getChatModel(),
      system: buildSystemPrompt({
        historySummary,
        customerFirstName: session ? session.firstName : null,
      }),
      messages: convertToModelMessages(windowed),
      tools: buildTools(session),
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse({
      // הארכת session מתגלגלת: כל בקשה מאומתת מאפסת את חלון 30 הדקות (אפיון 6.1)
      headers: session ? { "Set-Cookie": customerSessionSetCookieHeader(session) } : undefined,
    });
  } catch (err) {
    console.error("chat route error:", err);
    return jsonError(500, "משהו השתבש אצלנו. נסו שוב בעוד רגע.");
  }
}
