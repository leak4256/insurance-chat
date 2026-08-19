import { timingSafeEqual } from "node:crypto";
import { config } from "./config";

/**
 * גישת Surense דרך Make.com (רוויזיה 20.07.2026 — מחליף את סעיף 11 באפיון).
 *
 * תמיכת Surense (בכתב): אין גישה ישירה ל-API עם client id/secret — הגישה
 * היחידה היא דרך מודולי Make/Zapier. לכן תרחיש Make משמש כמתווך:
 *
 *   השרת שלנו ─POST─▶ Custom Webhook ─▶ Router לפי action ─▶ מודול Surense
 *                                                            └▶ Webhook Response
 *
 * חוזה הבקשה (גוף JSON): { action, ...פרמטרים } + כותרת x-make-apikey
 * (אימות ה-API Key המובנה של Custom Webhook ב-Make).
 * פעולות: "search_customers" (idNumber+email) · "get_customer" (customerId)
 *        · "portfolio" (customerId → List customer portfolio history).
 *
 * החיבור לשורנס עצמו (מייל+סיסמה+קוד אימות של הסוכנת) חי בתוך Make —
 * חד-פעמי, לא באפליקציה שלנו. אין טוקנים לשמור ואין OAuth.
 *
 * ⚠️ מבנה התשובות של מודולי Make אינו מתועד — הפירוק כאן סובלני
 * (מערך ישיר או תחת data/items/customers). לאמת מול הרצת ניסיון אמיתית.
 */

export function isSurenseConfigured(): boolean {
  return !!(config.surense.makeWebhookUrl && config.surense.makeWebhookSecret);
}

type MakeAction = "search_customers" | "get_customer" | "portfolio";

async function callMake<T>(action: MakeAction, params: Record<string, string>): Promise<T> {
  if (!isSurenseConfigured()) {
    throw new Error("חיבור Make אינו מוגדר — חסרים MAKE_WEBHOOK_URL / MAKE_WEBHOOK_SECRET");
  }
  const res = await fetch(config.surense.makeWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-make-apikey": config.surense.makeWebhookSecret,
    },
    body: JSON.stringify({ action, ...params }),
    signal: AbortSignal.timeout(config.surense.timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Make webhook (${action}) failed (${res.status}): ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // "Accepted" = התרחיש לא מוגדר עם מודול Webhook Response
    throw new Error(
      `Make webhook (${action}) החזיר תשובה שאינה JSON ("${text.slice(0, 50)}") — ` +
        "ודאו שהתרחיש מסתיים במודול Webhook Response עם גוף JSON.",
    );
  }
}

/**
 * פירוק סובלני: התרחיש שנבנה בפועל מחזיר {"array":[...]} (פלט ה-Array
 * aggregator דרך Transform to JSON); שאר המפתחות הם רשת ביטחון.
 */
function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["array", "customers", "data", "items", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

/** שמות השדות כפי ששורנס מחזיר בפועל (אומת 20.07.2026) */
export interface SurenseCustomer {
  id: string;
  idNumber?: string;
  email?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  /** סיכום המסלקה הפנסיונית — קיים בתשובת get_customer (לא ב-search) */
  tromStats?: Record<string, unknown>;
  [key: string]: unknown;
}

/** השוואה בזמן קבוע (מניעת timing attack על פרטי זיהוי) */
function safeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a.trim().toLowerCase());
  const bb = Buffer.from(b.trim().toLowerCase());
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * אימות זהות (אפיון 6.1): מודול "Search customers" בתרחיש ה-Make מסנן לפי
 * idNumber + email מגוף ה-webhook. בנוסף מאומת כאן שוב מקומית — גם אם
 * הסינון בתרחיש הוגדר רופף, לקוח לא נכון לא יעבור.
 */
export async function findCustomerByIdAndEmail(
  idNumber: string,
  email: string,
): Promise<SurenseCustomer | null> {
  const payload = await callMake<unknown>("search_customers", { idNumber, email });
  const matches = asArray<SurenseCustomer>(payload).filter(
    (c) =>
      c?.id &&
      safeEquals(String(c.idNumber ?? ""), idNumber) &&
      safeEquals(String(c.email ?? ""), email),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** פרטי הלקוח המחובר — מודול "Get customer" */
export async function getCustomer(customerId: string): Promise<SurenseCustomer> {
  const payload = await callMake<unknown>("get_customer", { customerId });
  const customer = (
    Array.isArray(payload) ? payload[0] : payload
  ) as SurenseCustomer | undefined;
  if (!customer?.id) throw new Error("Make get_customer החזיר תשובה ריקה או ללא שדה id");
  return customer;
}

/**
 * תמצית האחזקות של הלקוח (אילו ביטוחים/פנסיה יש לו, פרמיות וצבירות) —
 * נשלפת מ-`tromStats` שבתוך תשובת get_customer, שהוא סיכום המסלקה הפנסיונית.
 *
 * ⚠️ שמות השדות של שורנס מתועדים חלקית והתוויות בעברית טעונות אימות מול
 * הסוכנת. מוחזר תת-קבוצה מצומצמת בלבד (מזעור נתונים) — לא כל האובייקט.
 */
export function summarizeHoldings(customer: SurenseCustomer): Record<string, unknown> | null {
  const s = customer.tromStats;
  if (!s || typeof s !== "object") return null;

  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const has = (v: unknown) => v === true || v === "True" || v === "true";
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const coverage = (exists: unknown, premiumKey?: string) => {
    const c: Record<string, unknown> = { קיים: has(exists) };
    const p = premiumKey ? num(s[premiumKey]) : undefined;
    if (has(exists) && p !== undefined) c["פרמיה חודשית"] = p;
    return c;
  };

  return {
    כיסויים: {
      "ביטוח חיים": coverage(s.kayamHaim, "premiaHaim"),
      "ביטוח חיים למשכנתא": coverage(s.kayamHaimMashkanta),
      "ביטוח בריאות": coverage(s.kayamBriut),
      "מחלות קשות": coverage(s.kayamMahalotKashot, "premiaMahalotKashot"),
      "תאונות אישיות": coverage(s.kayamTeunotIshiot),
      "ביטוח סיעודי": coverage(s.kayamSiudi),
      "נכות מתאונה": coverage(s.kayamNehutMiteuna),
      "אבדן כושר עבודה": coverage(s.kayamAka),
    },
    צבירות: {
      פנסיה: num(s.tzviraPensia),
      "קרן השתלמות": num(s.tzviraHishtalmut),
      גמל: num(s.tzviraGemel),
      פיצויים: num(s.tzviraPitsuim),
      "סך צבירה כוללת": num(s.tzvira),
    },
    הפקדות: {
      "הפקדה חודשית (פנסיה/גמל)": num(s.hafkadot),
      "קרן השתלמות": num(s.hafkadotHishtalmut),
      "גמל להשקעה": num(s.hafkadotGemelLeashkaa),
    },
    "הנתונים מעודכנים לחודש": text(s.validityMonth) ?? text(customer.lastE9100DataDate),
    "פרמיה חודשית כוללת": num(s.premia),
    "קצבת פרישה חזויה (חודשית)": num(s.kitzbaHazuyaKolelHafkadot),
    "כיסוי חד-פעמי לשארים": num(s.kisuiHadPaamiSheerim),
    "דמי ניהול חזויים (חודשי)": num(s.dmeiNihulHazuim),
    "קיימות הלוואות": has(s.kayamHalvaot),
    "קיימים עיקולים/שעבודים": has(s.kayamIkulimShiabudim),
  };
}
