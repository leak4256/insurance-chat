import { config } from "./config";

/**
 * הגבלת קצב פשוטה בזיכרון (sliding window) — מספיקה לשרת יחיד ב-Railway.
 * אם בעתיד ירוצו כמה instances — להחליף למימוש מבוסס Redis/Supabase.
 */
const hits = new Map<string, number[]>();

export function checkRateLimit(key: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const windowStart = now - config.rateLimit.windowMs;
  const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= config.rateLimit.max) {
    const retryAfterSec = Math.ceil((timestamps[0] + config.rateLimit.windowMs - now) / 1000);
    hits.set(key, timestamps);
    return { allowed: false, retryAfterSec };
  }

  timestamps.push(now);
  hits.set(key, timestamps);

  // ניקוי תקופתי כדי שהמפה לא תגדל בלי סוף
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => t <= windowStart)) hits.delete(k);
    }
  }

  return { allowed: true };
}
