/**
 * בקשות רשת יוצאות עם ניסיונות חוזרים — מודול אחד לכולן.
 *
 * מאחורי סינון ה-TLS של NetFree החיבור הראשון מתהליך קר נתקע ונופל
 * ב-UND_ERR_CONNECT_TIMEOUT **בלי שנשלחה בקשה כלל**, והניסיון הבא מצליח.
 * זה הפיל את החיפוש החי (תוקן 04.11.2026), ואז את כרטיס ההתחברות ואת
 * search_knowledge (05.11.2026: `auth/start error: fetch failed` /
 * `match_chunks failed: TypeError: fetch failed` — שתי בקשות שלא יצאו).
 */

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;
/** פחות מזה לא מספיק לניסיון אמיתי — עדיף להיכשל מיד מלבזבז את שארית התקציב */
const MIN_ATTEMPT_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * כשלים שקורים **לפני** שהבקשה יצאה. חזרה עליהם אינה יכולה לשכפל פעולה בצד
 * השני, ולכן היא בטוחה תמיד — גם בבקשה שמשנה נתונים.
 */
const UNSENT_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * כשלים שבהם ייתכן שהבקשה כן התקבלה ובוצעה, ורק התשובה אבדה: חיבור שנקטע
 * באמצע או timeout. חזרה עליהם בטוחה רק בבקשה אידמפוטנטית.
 */
const SENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET"]);

export interface FetchRetryOptions {
  /** תקרת המתנה לניסיון בודד */
  timeoutMs: number;
  /**
   * תקרת המתנה לכל הניסיונות יחד. בלעדיה שלושה ניסיונות של timeoutMs כל אחד
   * היו יכולים לבלוע לבדם את `maxDuration` של הראוט.
   */
  totalTimeoutMs: number;
  /**
   * האם לחזור גם על כשל שאחריו ייתכן שהבקשה כבר בוצעה בצד השני. ברירת המחדל
   * false היא השמרנית: על פעולה שמשנה נתונים — create_report, למשל — חזרה כזו
   * הייתה מייצרת דוח כפול בתיק הלקוח. קריאה בלבד יכולה להעביר true.
   */
  retryAfterSend?: boolean;
}

function isRetryable(err: unknown, retryAfterSend: boolean): boolean {
  // AbortSignal.timeout זורק DOMException, שאינו instanceof Error
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return retryAfterSend;
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code !== "string") return false;
  return UNSENT_CODES.has(code) || (retryAfterSend && SENT_CODES.has(code));
}

/**
 * ניסיונות חוזרים על **כשל רשת בלבד**. תשובת HTTP חוזרת לקורא כמו שהיא, גם
 * כשהיא שגיאה — 403 או 429 לא ישתנו בניסיון נוסף.
 */
export async function fetchWithRetry(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  options: FetchRetryOptions,
): Promise<Response> {
  const { timeoutMs, totalTimeoutMs, retryAfterSend = false } = options;
  const deadline = Date.now() + totalTimeoutMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break;
    // signal חדש בכל ניסיון: AbortSignal.timeout מתחיל לרוץ ברגע היצירה,
    // ושיתוף שלו בין הניסיונות היה מפיל את השני מיד אחרי timeout של הראשון
    const timeout = AbortSignal.timeout(Math.min(timeoutMs, remaining));
    try {
      return await fetch(input, {
        ...init,
        // signal של הקורא (supabase-js מעביר אחד) נשמר לצד תקרת הזמן
        signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      });
    } catch (err) {
      lastError = err;
      if (!isRetryable(err, retryAfterSend)) throw err;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError ?? new Error(`no attempt fit in the ${totalTimeoutMs}ms budget`);
}
