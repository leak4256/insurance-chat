import { timingSafeEqual } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
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
 *        · "portfolio" (customerId → List customer portfolio history)
 *        · "search_reports" · "create_report" · "report_url" (ר' להלן).
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

type MakeAction =
  | "search_customers"
  | "get_customer"
  | "portfolio"
  | "search_reports"
  | "create_report"
  | "report_url";

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
 * מודול "Make an API Call" מחזיר את תשובת ה-API עטופה ב-{statusCode, headers, body}.
 * המודולים הייעודיים מחזירים את הגוף ישירות. מקלפים כדי ששני הסוגים יתנהגו זהה.
 */
function unwrapBody(payload: unknown): unknown {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = (payload as Record<string, unknown>).body;
    if (body && typeof body === "object") return body;
  }
  return payload;
}

/**
 * פירוק סובלני: התרחיש שנבנה בפועל מחזיר {"array":[...]} (פלט ה-Array
 * aggregator דרך Transform to JSON); שאר המפתחות הם רשת ביטחון.
 */
function asArray<T>(payload: unknown): T[] {
  const value = unwrapBody(payload);
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["array", "customers", "reports", "rows", "data", "items", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

/** אובייקט בודד מתוך תשובה שעשויה להיות עטופה ב-body או במערך בן איבר אחד */
function asObject<T>(payload: unknown): T | null {
  const value = unwrapBody(payload);
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value && typeof value === "object" ? (value as T) : null;
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

// ---------- דוח "טרום טיפול" ללקוח (אומת מול Surense 19.08.2026) ----------

/**
 * שלוש הפעולות הנדרשות בראוטר ה-Make. שתיים מהן אינן חושפות מודול ייעודי
 * באפליקציית Surense ולכן נבנות עם המודול הגנרי "Make an API Call"
 * (בסיס: https://api.surense.com/api/v1, אותו connection):
 *
 *   search_reports  POST /customers/{customerId}/reports/search   ← Make an API Call
 *                   body: {"startRow":0,"endRow":50,"sorts":[{"field":"createdDate","dir":"desc"}]}
 *   create_report   מודול "Create Report" (סוג דוח: טרום טיפול קבוע בתרחיש;
 *                   שדות "דוח ישן" חייבים להיות Empty — אחרת 500)
 *   report_url      POST /customers/{customerId}/reports/{reportId}/url  ← Make an API Call
 *
 * ⚠️ scope: היצירה דורשת customers:update והקריאה customers:read — שונים זה מזה.
 *
 * ⚠️ ה-URL החוזר מ-report_url הוא נתיב /public/access חתום וללא אימות: כל מי
 * שמחזיק בו רואה את תיק הלקוח עד לתפוגה (~30 יום). לכן הוא **לא יוצא מהמודול
 * הזה** — הוא משמש רק להורדת ה-PDF בצד השרת, אינו נשמר בשום מקום, אינו נכתב
 * ללוגים ואינו מוחזר למודל או ללקוח. הצ'אט עונה מתוך תוכן הדוח, לא מקשר אליו.
 */

/** קוד סוג הדוח "טרום טיפול" — היחיד שמופק מהצ'אט */
const REPORT_TYPE_PRE_TREATMENT = 1;

/**
 * שדות הדוח כפי ששורנס מחזיר בפועל. שימו לב שהמזהה מגיע בשם שונה לפי הפעולה:
 * search_reports מחזיר `id`, ואילו create_report מחזיר {success, reportId}.
 */
export interface SurenseReport {
  id?: string;
  reportId?: string;
  customerId?: string;
  /** מזהה הקובץ עצמו — ישות נפרדת מהדוח */
  documentId?: string;
  documentSize?: number;
  createdDate?: string;
  /** חודש נכונות המידע, בפורמט YYYY-MM */
  validityMonth?: string;
  reportType?: { code?: number; description?: string };
  reportFormat?: { code?: number; description?: string };
  [key: string]: unknown;
}

export interface ReportContent {
  /** הטקסט שחולץ מה-PDF — מקור התשובה של הצ'אט */
  text: string;
  /** חודש נכונות המידע (YYYY-MM) — חשוב לציין ללקוח למה הנתונים נכונים */
  validityMonth?: string;
  createdDate?: string;
  /** האם נעשה שימוש בדוח קיים (true) או שהופק חדש (false) */
  reused: boolean;
  /** הטקסט נחתך בגלל תקרת האורך */
  truncated: boolean;
}

/** המזהה של הדוח, תחת שני השמות שבהם שורנס מחזיר אותו */
function reportIdOf(report: SurenseReport): string | undefined {
  return report.id ?? report.reportId;
}

function reportAgeDays(report: SurenseReport): number {
  const created = Date.parse(String(report.createdDate ?? ""));
  return Number.isNaN(created) ? Number.POSITIVE_INFINITY : (Date.now() - created) / 86_400_000;
}

/**
 * הדוח הטרי ביותר של הלקוח שעדיין בתוקף עניני. אין הסתמכות על מיון בצד השרת —
 * התשובה של search אינה מתועדת, ולכן ממיינים כאן.
 */
async function findFreshReport(customerId: string): Promise<SurenseReport | null> {
  const payload = await callMake<unknown>("search_reports", { customerId });
  const fresh = asArray<SurenseReport>(payload).filter(
    (r) =>
      reportIdOf(r) &&
      r.documentId && // בלי קובץ אין מה להציג
      r.reportType?.code === REPORT_TYPE_PRE_TREATMENT &&
      // הגנה לעומק: גם אם הסינון בתרחיש רופף, לא מחזירים דוח של לקוח אחר
      (!r.customerId || r.customerId === customerId) &&
      reportAgeDays(r) <= config.surense.reportMaxAgeDays,
  );
  fresh.sort((a, b) => reportAgeDays(a) - reportAgeDays(b));
  return fresh[0] ?? null;
}

/**
 * הורדת ה-PDF וחילוץ הטקסט ממנו. ה-URL נצרך כאן ומת כאן — הוא לא מוחזר
 * לקורא ולא נכנס להודעות שגיאה (הוא קישור גישה ציבורי לתיק הלקוח).
 */
async function downloadReportText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(config.surense.timeoutMs) });
  if (!res.ok) throw new Error(`הורדת קובץ הדוח נכשלה (${res.status})`);

  const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
  const { text: pages } = await extractText(pdf, { mergePages: false });
  return pages
    .map((page) => page.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * מטמון בזיכרון התהליך בלבד (כמו סיכום השיחה במסלול הצ'אט): הפקת דוח + הורדה +
 * פענוח היא פעולה יקרה, והמודל עשוי לקרוא לכלי כמה פעמים באותה שיחה.
 * שום דבר לא נכתב למסד, והרשומה פוקעת מעצמה.
 */
const reportCache = new Map<string, { at: number; content: ReportContent }>();

/**
 * תוכן דוח "טרום טיפול" של הלקוח, כטקסט, לשימוש המודל כמקור לתשובה.
 *
 * הזרימה: חיפוש דוח קיים וטרי → אם אין, הפקת דוח חדש → קישור חתום → הורדת
 * ה-PDF → חילוץ טקסט. מיחזור דוח קיים נועד לא לצבור דוחות מיותרים בתיק הלקוח.
 *
 * ה-customerId מגיע תמיד מה-session המאומת בצד השרת, לעולם לא מקלט המשתמש.
 */
export async function getReportContent(customerId: string): Promise<ReportContent> {
  const cached = reportCache.get(customerId);
  if (cached && Date.now() - cached.at < config.surense.reportCacheTtlMs) return cached.content;

  let report = await findFreshReport(customerId);
  const reused = !!report;

  if (!report) {
    const created = asObject<SurenseReport>(await callMake<unknown>("create_report", { customerId }));
    if (!created || !reportIdOf(created)) {
      throw new Error("Make create_report החזיר תשובה ללא מזהה דוח (id/reportId)");
    }
    report = created;
  }

  const link = asObject<{ url?: string }>(
    await callMake<unknown>("report_url", { customerId, reportId: reportIdOf(report)! }),
  );
  if (!link?.url) throw new Error("Make report_url החזיר תשובה ללא שדה url");

  const full = await downloadReportText(link.url);
  // PDF סרוק/מוצפן יחזיר טקסט ריק — עדיף להיכשל מאשר להזין למודל דף ריק
  if (full.length < 200) throw new Error("לא חולץ טקסט מקובץ הדוח");

  const truncated = full.length > config.surense.reportMaxChars;
  const content: ReportContent = {
    text: truncated ? full.slice(0, config.surense.reportMaxChars) : full,
    validityMonth: report.validityMonth,
    createdDate: report.createdDate,
    reused,
    truncated,
  };

  reportCache.set(customerId, { at: Date.now(), content });
  if (reportCache.size > 500) {
    const oldest = reportCache.keys().next().value;
    if (oldest) reportCache.delete(oldest);
  }
  return content;
}
