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

async function callMake<T>(action: MakeAction, params: Record<string, string | number>): Promise<T> {
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
  /**
   * סיכום הפרודוקציה (נתוני חברות הביטוח לסוכנות) — אותם שדות כמו tromStats עם
   * קידומת `stats`. מכיל מוצרים שאינם במסלקה, למשל ביטוח חיים למשכנתא (אומת 17.09.2026)
   */
  productiaStats?: Record<string, unknown>;
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

/** כיסוי ← [שדה הקיום, שדה הפרמיה (אם ידוע)] — שמות השדות של tromStats */
const COVERAGES: [label: string, existsKey: string, premiumKey?: string][] = [
  ["ביטוח חיים", "kayamHaim", "premiaHaim"],
  ["ביטוח חיים למשכנתא", "kayamHaimMashkanta", "premiaHaimMashkanta"],
  ["ביטוח בריאות", "kayamBriut"],
  ["מחלות קשות", "kayamMahalotKashot", "premiaMahalotKashot"],
  ["תאונות אישיות", "kayamTeunotIshiot"],
  ["ביטוח סיעודי", "kayamSiudi"],
  ["נכות מתאונה", "kayamNehutMiteuna"],
  ["אבדן כושר עבודה", "kayamAka"],
];

const ACCUMULATIONS: [label: string, key: string][] = [
  ["פנסיה", "tzviraPensia"],
  ["קרן השתלמות", "tzviraHishtalmut"],
  ["גמל", "tzviraGemel"],
  ["גמל להשקעה", "tzviraGemelLeashkaa"],
  ["פיצויים", "tzviraPitsuim"],
  ["סך צבירה כוללת", "tzvira"],
];

const DEPOSITS: [label: string, key: string][] = [
  ["הפקדה חודשית (פנסיה/גמל)", "hafkadot"],
  ["קרן השתלמות", "hafkadotHishtalmut"],
  ["גמל להשקעה", "hafkadotGemelLeashkaa"],
];

const OTHER_AMOUNTS: [label: string, key: string][] = [
  ["פרמיה חודשית כוללת", "premia"],
  ["קצבת פרישה חזויה (חודשית)", "kitzbaHazuyaKolelHafkadot"],
  ["כיסוי חד-פעמי לשארים", "kisuiHadPaamiSheerim"],
  ["דמי ניהול חזויים (חודשי)", "dmeiNihulHazuim"],
];

/**
 * תמצית מקור נתונים אחד. נכללים **רק** כיסויים קיימים וסכומים שאינם אפס:
 * "לא קיים" / 0 ברשומה משמעו לרוב "המקור לא דיווח", והמודל נוטה להציג אותם
 * ללקוח כעובדה ("יש לך 0 ש"ח בפנסיה"). מקור בלי שום נתון → null.
 */
function summarizeStats(
  s: Record<string, unknown> | undefined,
  field: (key: string) => string,
  fallbackMonth: unknown,
): Record<string, unknown> | null {
  if (!s || typeof s !== "object") return null;

  const num = (key: string) => {
    const v = s[field(key)];
    return typeof v === "number" && v !== 0 ? v : undefined;
  };
  const has = (key: string) => {
    const v = s[field(key)];
    return v === true || v === "True" || v === "true";
  };
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const amounts = (entries: [string, string][]) =>
    Object.fromEntries(
      entries.flatMap(([label, key]) => (num(key) === undefined ? [] : [[label, num(key)]])),
    );

  const coverages = Object.fromEntries(
    COVERAGES.filter(([, existsKey]) => has(existsKey)).map(([label, , premiumKey]) => {
      const premium = premiumKey ? num(premiumKey) : undefined;
      return [label, premium === undefined ? "קיים" : { "פרמיה חודשית": premium }];
    }),
  );
  const flags = [
    ...(has("kayamHalvaot") ? ["קיימות הלוואות"] : []),
    ...(has("kayamIkulimShiabudim") ? ["קיימים עיקולים/שעבודים"] : []),
  ];

  const groups: Record<string, unknown> = {
    "כיסויים קיימים": coverages,
    צבירות: amounts(ACCUMULATIONS),
    הפקדות: amounts(DEPOSITS),
    ...amounts(OTHER_AMOUNTS),
  };
  const content = Object.fromEntries(
    Object.entries(groups).filter(
      ([, v]) => !(v && typeof v === "object" && Object.keys(v).length === 0),
    ),
  );
  if (Object.keys(content).length === 0 && flags.length === 0) return null;

  return {
    ...content,
    ...(flags.length ? { "הערות נוספות": flags } : {}),
    "הנתונים מעודכנים לחודש": text(s[field("validityMonth")]) ?? text(fallbackMonth),
  };
}

const NO_SOURCE_DATA = "אין נתונים במקור הזה";

/**
 * תמצית האחזקות של הלקוח (אילו ביטוחים/פנסיה יש לו, פרמיות וצבירות) מתוך
 * תשובת get_customer, משני מקורות נפרדים:
 * - `tromStats` — המסלקה הפנסיונית.
 * - `productiaStats` — הפרודוקציה (נתוני חברות הביטוח לסוכנות). אותם שדות
 *   בקידומת `stats`. כאן מופיעים מוצרים שאינם במסלקה, כמו ביטוח חיים למשכנתא.
 * לא מאחדים את המקורות: אותו מוצר עשוי להופיע בשניהם, וחיבור היה סופר פעמיים.
 *
 * ⚠️ שמות השדות של שורנס מתועדים חלקית והתוויות בעברית טעונות אימות מול
 * הסוכנת. מוחזר תת-קבוצה מצומצמת בלבד (מזעור נתונים) — לא כל האובייקט.
 * null = אין ברשומה אף אחד משני אובייקטי הסיכום (תקלה, לא "אין מוצרים").
 */
export function summarizeHoldings(customer: SurenseCustomer): Record<string, unknown> | null {
  if (!customer.tromStats && !customer.productiaStats) return null;

  const trom = summarizeStats(customer.tromStats, (k) => k, customer.lastE9100DataDate);
  const productia = summarizeStats(
    customer.productiaStats,
    (k) => `stats${k[0].toUpperCase()}${k.slice(1)}`,
    customer.lastProductiaMonth,
  );

  return {
    "מסלקה פנסיונית": trom ?? NO_SOURCE_DATA,
    "פרודוקציה (נתוני חברות הביטוח לסוכנות)": productia ?? NO_SOURCE_DATA,
  };
}

// ---------- דוח פר-לקוח (טרום טיפול אומת 19.08.2026, פרודוקציה 22.09.2026) ----------

/**
 * שלוש הפעולות הנדרשות בראוטר ה-Make. שתיים מהן אינן חושפות מודול ייעודי
 * באפליקציית Surense ולכן נבנות עם המודול הגנרי "Make an API Call"
 * (בסיס: https://api.surense.com/api/v1, אותו connection):
 *
 *   search_reports  POST /customers/{customerId}/reports/search   ← Make an API Call
 *                   body: {"startRow":0,"endRow":50,"sorts":[{"field":"createdDate","dir":"desc"}]}
 *   create_report   מודול "Create Report". מקבל מגוף ה-webhook `reportType` (1/2, ר'
 *                   REPORT_TYPES) ו-`month` (YYYY-MM, חודש נכונות המידע; נשלח רק כשידוע).
 *                   שדות "דוח ישן" חייבים להיות Empty (לא No) — אחרת 500 או "לא נמצאו מוצרים".
 *   report_url      POST /customers/{customerId}/reports/{reportId}/url  ← Make an API Call
 *
 * ⚠️ scope: היצירה דורשת customers:update והקריאה customers:read — שונים זה מזה.
 *
 * ⚠️ ה-URL החוזר מ-report_url הוא נתיב /public/access חתום וללא אימות: כל מי
 * שמחזיק בו רואה את תיק הלקוח עד לתפוגה (~30 יום). לכן הוא **לא יוצא מהמודול
 * הזה** — הוא משמש רק להורדת ה-PDF בצד השרת, אינו נשמר בשום מקום, אינו נכתב
 * ללוגים ואינו מוחזר למודל או ללקוח. הצ'אט עונה מתוך תוכן הדוח, לא מקשר אליו.
 */

/** סוגי הדוח שהצ'אט מפיק — כל אחד מכסה מקור נתונים אחר של הלקוח */
export const REPORT_TYPES = {
  /** "טרום טיפול" — המסלקה הפנסיונית (`tromStats`) */
  preTreatment: 1,
  /** "פרודוקציה" — נתוני חברות הביטוח לסוכנות (`productiaStats`) */
  production: 2,
} as const;
type ReportType = (typeof REPORT_TYPES)[keyof typeof REPORT_TYPES];

const REPORT_SOURCE_LABEL: Record<ReportType, string> = {
  [REPORT_TYPES.preTreatment]: "מסלקה פנסיונית",
  [REPORT_TYPES.production]: "פרודוקציה (נתוני חברות הביטוח לסוכנות)",
};

/** YYYY-MM מתוך מחרוזת חודש או תאריך (למשל "2026-06-30T…" → "2026-06") */
function toMonth(v: unknown): string | undefined {
  return typeof v === "string" ? /^\d{4}-\d{2}/.exec(v)?.[0] : undefined;
}

/**
 * איזה דוח להפיק ללקוח: טרום טיפול כשיש לו נתוני מסלקה (ההתנהגות המקורית),
 * ופרודוקציה כשאין — כמו לקוח שכל מה שיש לו הוא ביטוח חיים למשכנתא.
 *
 * החודש הוא "חודש נכונות המידע" של המקור, והוא שונה מלקוח ללקוח: עם חודש שבו
 * אין למקור נתונים Surense עונה "לא נמצאו מוצרים ללקוח" (אומת 22.09.2026).
 * הוא נלקח מרשומת הלקוח עצמה, בלי קריאה נוספת ל-portfolio.
 * טרום טיפול נשלח בלי חודש — כך הוא הופק בהצלחה מאז 19.08, ולא נבדק עם חודש.
 */
function reportRequestFor(customer: SurenseCustomer): { type: ReportType; month?: string } {
  const p = customer.productiaStats;
  if (summarizeStats(customer.tromStats, (k) => k, undefined) !== null) {
    return { type: REPORT_TYPES.preTreatment };
  }
  return {
    type: REPORT_TYPES.production,
    month: toMonth(p?.statsValidityMonth) ?? toMonth(customer.lastProductiaMonth),
  };
}

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
  /** מקור הנתונים שהדוח מכסה (תווית בעברית, ר' REPORT_SOURCE_LABEL) */
  source: string;
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

function reportTypeOf(report: SurenseReport): ReportType | undefined {
  const code = report.reportType?.code;
  return code === REPORT_TYPES.preTreatment || code === REPORT_TYPES.production ? code : undefined;
}

/**
 * הדוחות של הלקוח שעדיין בתוקף עניני, מהסוגים שהצ'אט מכיר, הטרי ראשון. אין
 * הסתמכות על מיון בצד השרת — התשובה של search אינה מתועדת, ולכן ממיינים כאן.
 */
async function findFreshReports(customerId: string): Promise<SurenseReport[]> {
  const payload = await callMake<unknown>("search_reports", { customerId });
  const fresh = asArray<SurenseReport>(payload).filter(
    (r) =>
      reportIdOf(r) &&
      r.documentId && // בלי קובץ אין מה להציג
      reportTypeOf(r) !== undefined &&
      // הגנה לעומק: גם אם הסינון בתרחיש רופף, לא מחזירים דוח של לקוח אחר
      (!r.customerId || r.customerId === customerId) &&
      reportAgeDays(r) <= config.surense.reportMaxAgeDays,
  );
  return fresh.sort((a, b) => reportAgeDays(a) - reportAgeDays(b));
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
 * תוכן הדוח של הלקוח, כטקסט, לשימוש המודל כמקור לתשובה.
 *
 * הזרימה: חיפוש דוח קיים וטרי → אם אין, הפקת דוח חדש → קישור חתום → הורדת
 * ה-PDF → חילוץ טקסט. מיחזור דוח קיים נועד לא לצבור דוחות מיותרים בתיק הלקוח.
 * סוג הדוח נקבע לפי מקור הנתונים של הלקוח (ר' reportRequestFor); רשומת הלקוח
 * נשלפת רק כשצריך להכריע — דוח טרי יחיד מתקבל כמו שהוא, בלי קריאה נוספת ל-Make.
 *
 * ה-customerId מגיע תמיד מה-session המאומת בצד השרת, לעולם לא מקלט המשתמש.
 */
export async function getReportContent(customerId: string): Promise<ReportContent> {
  const cached = reportCache.get(customerId);
  if (cached && Date.now() - cached.at < config.surense.reportCacheTtlMs) return cached.content;

  const fresh = await findFreshReports(customerId);
  const freshTypes = new Set(fresh.map(reportTypeOf));

  let report: SurenseReport | undefined;
  let type: ReportType;
  if (freshTypes.size === 1) {
    report = fresh[0];
    type = reportTypeOf(report)!;
  } else {
    const wanted = reportRequestFor(await getCustomer(customerId));
    type = wanted.type;
    report = fresh.find((r) => reportTypeOf(r) === type);
    if (!report) {
      const created = asObject<SurenseReport>(
        await callMake<unknown>("create_report", {
          customerId,
          // מספר, לא מחרוזת: Surense דוחה "2" ב-400 "Request body is missing or could not be read"
          reportType: type,
          ...(wanted.month ? { month: wanted.month } : {}),
        }),
      );
      if (!created || !reportIdOf(created)) {
        throw new Error("Make create_report החזיר תשובה ללא מזהה דוח (id/reportId)");
      }
      report = { ...created, validityMonth: created.validityMonth ?? wanted.month };
    }
  }
  const reused = fresh.includes(report);

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
    source: REPORT_SOURCE_LABEL[type],
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
