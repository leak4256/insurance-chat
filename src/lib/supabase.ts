import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithRetry } from "./fetch-retry";

/**
 * לקוח Supabase לצד שרת בלבד (service role). אסור לייבא מקובץ client component.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables");
  }
  client = createClient(url, key, {
    auth: { persistSession: false },
    global: {
      /**
       * כל קריאות Supabase עוברות דרך ניסיון חוזר: מאחורי NetFree הקריאה
       * הראשונה מתהליך קר נופלת ב-`fetch failed` בלי שיצאה בכלל (ב-05.11.2026
       * זה הפיל את search_knowledge — "match_chunks failed"). retryAfterSend
       * נשאר כבוי, כדי שכתיבה (otp, audit) לא תוכל להיכתב פעמיים.
       */
      fetch: (input, init) =>
        fetchWithRetry(input, init, { timeoutMs: 15_000, totalTimeoutMs: 25_000 }),
    },
  });
  return client;
}
