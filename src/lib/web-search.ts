import { fetchWithRetry as fetchWithRetryShared } from "./fetch-retry";
import { getDocumentProxy } from "unpdf";
import { config } from "./config";
import { GENERAL_SOURCE_HOSTS, isAllowedHost, isGovHost, parseAllowedUrl } from "./web-sources";

/**
 * חיפוש חי — **גיבוי** למאגר הידע של הסוכנות, לא תחליף לו.
 *
 * כל גישה לאינטרנט החי עוברת דרך המודול הזה בלבד (כמו `surense.ts` ל-Surense).
 * שתי יכולות, שתיהן כפופות לרשימת ההיתר ב-`web-sources.ts`:
 * 1. `searchPublicSources` — חיפוש דרך Serper (תוצאות Google), מוגבל לאתרי
 *    חברות הביטוח ולמקורות ממשלתיים — גם במסנני `site:` שבשאילתה וגם בסינון
 *    ה-host של כל תוצאה.
 * 2. `fetchPublicDocument` — פתיחת המסמך עצמו (HTML או PDF) וחילוץ הטקסט, כדי
 *    שהתשובה תתבסס על המסמך ולא על תקציר תוצאת החיפוש.
 *
 * כל מה שחוזר מכאן הוא **תוכן לא אמון** — נתונים בלבד, לא הוראות. התיחום
 * נאכף ב-system prompt ובהערות שמוחזרות עם הכלים.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  /** תקציר ממנוע החיפוש — לא מספיק לתשובה, רק לבחירת המסמך */
  snippet: string;
  host: string;
  /** האם המקור ממשלתי (לציון סוג המקור בתשובה) */
  official: boolean;
  /** "PDF" כשהקישור מצביע על קובץ PDF */
  fileFormat: string | null;
  /** תאריך שגוגל מציג לצד התוצאה, כשיש — רמז לטריות המסמך */
  date: string | null;
}

export interface WebDocument {
  url: string;
  host: string;
  official: boolean;
  kind: "html" | "pdf" | "text";
  title: string | null;
  /** תאריך עדכון שהמסמך מצהיר עליו, אם נמצא (meta/HTTP) */
  lastModified: string | null;
  text: string;
  truncated: boolean;
}

export class WebSourceError extends Error {}

/** החיפוש החי כבוי כל עוד לא הוגדר מפתח */
export function isWebSearchConfigured(): boolean {
  return config.webSearch.serperApiKey.length > 0;
}

/* ------------------------------- מטמון ------------------------------- */

interface CacheEntry<T> {
  at: number;
  value: T;
}

/** מטמון בזיכרון התהליך — חיפוש ופענוח PDF יקרים, והתקציב הדוק */
function cacheGet<T>(store: Map<string, CacheEntry<T>>, key: string, ttlMs: number): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    store.delete(key);
    return null;
  }
  // דחיפה לסוף המפה: `cacheSet` מפנה את הרשומה הראשונה, ובלי זה היה מפונה
  // המסמך הוותיק ביותר גם כשהוא זה שנפתח בכל שיחה (FIFO במקום LRU).
  // `at` נשאר כשהיה — קריאה אינה מרעננת את המסמך ולא מאריכה את ה-TTL.
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

function cacheSet<T>(store: Map<string, CacheEntry<T>>, key: string, value: T, maxSize = 200): void {
  store.set(key, { at: Date.now(), value });
  if (store.size > maxSize) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

const searchCache = new Map<string, CacheEntry<WebSearchResult[]>>();
const documentCache = new Map<string, CacheEntry<WebDocument>>();

/* ------------------------------ בקשות רשת ------------------------------ */

/**
 * **כל** בקשה יוצאת מהמודול עוברת כאן — גם החיפוש וגם הורדת המסמך. ההיגיון
 * המשותף (וההסבר על כשל החיבור הראשון מאחורי NetFree) יושב ב-fetch-retry.ts;
 * כאן רק התקציבים של החיפוש החי. כל הבקשות כאן הן קריאה בלבד, ולכן מותר
 * לחזור עליהן גם אחרי timeout.
 */
function fetchWithRetry(
  input: URL | string,
  init: Omit<RequestInit, "signal">,
): Promise<Response> {
  return fetchWithRetryShared(input, init, {
    timeoutMs: config.webSearch.timeoutMs,
    totalTimeoutMs: config.webSearch.totalTimeoutMs,
    retryAfterSend: true,
  });
}

/* ------------------------------- חיפוש ------------------------------- */

interface SerperOrganic {
  title?: string;
  link?: string;
  snippet?: string;
  /** תאריך שגוגל מציג לצד התוצאה, כשיש */
  date?: string;
}

/** `filetype:pdf` לא נשלח — אבל כשהקישור הוא PDF שווה לסמן זאת למודל */
function fileFormatOf(url: URL): string | null {
  return /\.pdf($|\?)/i.test(url.pathname + url.search) ? "PDF" : null;
}

/**
 * השאילתה שנשלחת לגוגל, עם מסנן `site:` כדי שההגבלה תחול כבר בחיפוש.
 *
 * אתר שצוין → `site:<אתר>`. לא צוין → gov.il והמקורות הכלליים (כל זכות): שאלה שלא
 * נקשרה לחברה מסוימת היא שאלה כללית או רגולטורית, ושם התשובה ממילא. קבוצת OR של
 * **כל** רשימת ההיתר נמדדה ב-43 מילים — מעבר למגבלת אורך השאילתה של גוגל, שהייתה
 * חותכת אותה בשקט; שני אתרים בלבד רחוקים מהמגבלה.
 */
function buildQuery(query: string, site?: string): string {
  if (site) return `${query} site:${site}`;
  const sites = ["gov.il", ...GENERAL_SOURCE_HOSTS].map((h) => `site:${h}`).join(" OR ");
  return `${query} (${sites})`;
}

/**
 * חיפוש במקורות הציבוריים המותרים, דרך Serper (תוצאות Google).
 *
 * ההגבלה נאכפת פעמיים: מסנני `site:` בשאילתה — כדי שגוגל בכלל לא יחזיר אתרים
 * אחרים — **וגם** בדיקת ה-host של כל תוצאה מול רשימת ההיתר, שהיא הקו האחרון.
 */
export async function searchPublicSources(
  query: string,
  options?: { site?: string },
): Promise<WebSearchResult[]> {
  if (!isWebSearchConfigured()) {
    throw new WebSourceError("live search is not configured");
  }
  const site = options?.site?.trim();
  if (site && !isAllowedHost(site)) {
    throw new WebSourceError(`site not allowed: ${site}`);
  }

  const cacheKey = `${site ?? "*"}|${query}`;
  const cached = cacheGet(searchCache, cacheKey, config.webSearch.searchCacheTtlMs);
  if (cached) return cached;

  let results = await runSearch(buildQuery(query, site));
  if (results.length === 0 && !site) {
    // לא נמצא כלום במקורות הממשלתיים — ניסיון שני פתוח, שבו ההגבלה נשענת על
    // סינון ה-host בלבד (אתרי החברות ייכנסו, השאר ייזרק). קרדיט נוסף רק אז.
    results = await runSearch(query);
  }

  // תוצאה ריקה אינה נשמרת: חיפוש שהחזיר 0 בגלל תקלה חולפת או בגלל מסנן
  // ה-site היה נועל את התשובה "לא נמצא מסמך" לכל אורך ה-TTL (שעה), גם אחרי
  // שהתנאי שגרם לה חלף, והמודל לא היה יכול להתאושש.
  if (results.length > 0) cacheSet(searchCache, cacheKey, results);
  return results;
}

async function runSearch(q: string): Promise<WebSearchResult[]> {
  const res = await fetchWithRetry("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": config.webSearch.serperApiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      q,
      gl: "il", // ישראל
      hl: "he", // עברית
      num: config.webSearch.maxResults,
    }),
  }).catch((err: unknown) => {
    throw new WebSourceError(`search request failed: ${errMessage(err)}`);
  });

  if (!res.ok) {
    // גוף התשובה עלול לכלול את המפתח — נרשם הסטטוס בלבד
    throw new WebSourceError(`search returned HTTP ${res.status}`);
  }

  const body = (await res.json().catch(() => null)) as { organic?: SerperOrganic[] } | null;
  return (body?.organic ?? [])
    .map((item) => {
      const parsed = parseAllowedUrl(item.link ?? "");
      if (!parsed) return null; // תוצאה מאתר שאינו ברשימת ההיתר — נזרקת
      return {
        title: item.title ?? parsed.hostname,
        url: parsed.toString(),
        snippet: (item.snippet ?? "").replace(/\s+/g, " ").trim(),
        host: parsed.hostname,
        official: isGovHost(parsed.hostname),
        fileFormat: fileFormatOf(parsed),
        date: item.date ?? null,
      };
    })
    .filter((r): r is WebSearchResult => r !== null);
}

/* --------------------------- פתיחת מסמך --------------------------- */

const ACCEPTED_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "application/pdf"];

/**
 * הורדת המסמך עצמו וחילוץ הטקסט ממנו.
 * רשימת ההיתר נבדקת גם על הכתובת המבוקשת וגם על הכתובת הסופית **אחרי הפניות**,
 * כדי שהפניה לא תוציא אותנו מהמקורות המותרים.
 */
export async function fetchPublicDocument(rawUrl: string): Promise<WebDocument> {
  const url = parseAllowedUrl(rawUrl);
  if (!url) {
    throw new WebSourceError(`url not allowed: ${rawUrl.slice(0, 120)}`);
  }

  const cached = cacheGet(documentCache, url.toString(), config.webSearch.docCacheTtlMs);
  if (cached) return cached;

  const { buffer, contentType, finalUrl, lastModified: headerModified } = await fetchAllowedBytes(url);

  const isPdf = contentType.includes("application/pdf") || hasPdfMagic(buffer);
  if (!isPdf && !ACCEPTED_TYPES.some((type) => contentType.includes(type))) {
    throw new WebSourceError(`unsupported content-type: ${contentType.slice(0, 60) || "unknown"}`);
  }

  let title: string | null = null;
  let lastModified = headerModified;
  let raw: string;
  let kind: WebDocument["kind"];

  if (isPdf) {
    kind = "pdf";
    raw = await pdfText(buffer);
    // ל-PDF אין כותרת HTML; השורה הראשונה היא בדרך כלל שם המסמך והמהדורה
    title = pdfTitle(raw);
  } else if (contentType.includes("text/plain")) {
    kind = "text";
    raw = new TextDecoder("utf-8").decode(buffer);
  } else {
    kind = "html";
    const parsed = htmlToText(new TextDecoder("utf-8").decode(buffer));
    title = parsed.title;
    lastModified = parsed.lastModified ?? lastModified;
    raw = parsed.text;
  }

  const text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = text.length > config.webSearch.docMaxChars;

  const doc: WebDocument = {
    url: finalUrl.toString(),
    host: finalUrl.hostname,
    official: isGovHost(finalUrl.hostname),
    kind,
    title,
    lastModified,
    text: truncated ? text.slice(0, config.webSearch.docMaxChars) : text,
    truncated,
  };

  if (doc.text.length === 0) {
    throw new WebSourceError("no text could be extracted (possibly a scanned PDF)");
  }

  cacheSet(documentCache, url.toString(), doc, 50);
  return doc;
}

export interface PublicFile {
  bytes: Uint8Array;
  contentType: string;
  url: string;
  fileName: string;
}

/**
 * הורדת מסמך PDF כבייטים, כדי להגיש אותו ללקוח לצפייה (`/api/source`).
 * אותן בדיקות כמו `fetchPublicDocument`, ובנוסף אימות חתימת ה-PDF — לא מגישים
 * ללקוח שום דבר שאינו PDF, כדי שלא נשמש להגשת HTML זר מהמקור שלנו.
 */
export async function fetchPublicPdf(rawUrl: string): Promise<PublicFile> {
  const url = parseAllowedUrl(rawUrl);
  if (!url) {
    throw new WebSourceError(`url not allowed: ${rawUrl.slice(0, 120)}`);
  }

  const { buffer, contentType, finalUrl } = await fetchAllowedBytes(url);
  if (!contentType.includes("application/pdf") && !hasPdfMagic(buffer)) {
    throw new WebSourceError("not a PDF");
  }

  const name = decodeURIComponent(finalUrl.pathname.split("/").pop() || "document.pdf");
  return {
    bytes: buffer,
    contentType: "application/pdf",
    url: finalUrl.toString(),
    // שם קובץ בטוח לכותרת Content-Disposition (ASCII בלבד, בלי מרכאות)
    fileName: /\.pdf$/i.test(name) ? name.replace(/[^\w.\-]/g, "_") : "document.pdf",
  };
}

/**
 * ההורדה המשותפת: רשימת היתר על הכתובת המבוקשת ועל הכתובת הסופית אחרי הפניות,
 * סוג תוכן נתמך, ותקרת גודל.
 */
async function fetchAllowedBytes(url: URL): Promise<{
  buffer: Uint8Array;
  contentType: string;
  finalUrl: URL;
  lastModified: string | null;
}> {
  const res = await fetchWithRetry(url, {
    redirect: "follow",
    headers: {
      accept: ACCEPTED_TYPES.join(","),
      "accept-language": "he-IL,he;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; InsuranceChat/1.0)",
    },
  }).catch((err: unknown) => {
    throw new WebSourceError(`fetch failed: ${errMessage(err)}`);
  });

  const finalUrl = parseAllowedUrl(res.url || url.toString());
  if (!finalUrl) {
    throw new WebSourceError("redirected outside the allowed sources");
  }
  if (!res.ok) {
    throw new WebSourceError(`document returned HTTP ${res.status}`);
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  // octet-stream מתקבל רק אם הבייטים עצמם הם PDF (ר' הבדיקה אחרי ההורדה)
  const maybeSupported =
    ACCEPTED_TYPES.some((type) => contentType.includes(type)) ||
    contentType.includes("application/octet-stream") ||
    contentType.length === 0;
  if (!maybeSupported) {
    throw new WebSourceError(`unsupported content-type: ${contentType.slice(0, 60)}`);
  }

  const declaredLength = Number(res.headers.get("content-length") ?? 0);
  if (declaredLength > config.webSearch.docMaxBytes) {
    throw new WebSourceError(
      `document too large (${Math.round(declaredLength / 1024)}KB)`,
    );
  }

  const buffer = new Uint8Array(await res.arrayBuffer());
  if (buffer.byteLength > config.webSearch.docMaxBytes) {
    throw new WebSourceError(`document too large (${Math.round(buffer.byteLength / 1024)}KB)`);
  }

  return {
    buffer,
    contentType,
    finalUrl,
    lastModified: res.headers.get("last-modified"),
  };
}

/* ------------------------------- עזר ------------------------------- */

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  shy: "",
  rlm: "",
  lrm: "",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** חילוץ טקסט מ-HTML בלי תלות חיצונית: הסרת סקריפטים, תגיות ו-entities */
function htmlToText(html: string): {
  title: string | null;
  text: string;
  lastModified: string | null;
} {
  const title = match(html, /<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  const lastModified =
    metaContent(html, "article:modified_time") ??
    metaContent(html, "og:updated_time") ??
    metaContent(html, "last-modified") ??
    metaContent(html, "date");

  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|td|th|br)\s*\/?>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return {
    title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() || null : null,
    lastModified,
    text: decodeEntities(text)
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n"),
  };
}

function metaContent(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    match(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)`, "i")) ??
    match(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"))
  );
}

function match(text: string, re: RegExp): string | null {
  return text.match(re)?.[1]?.trim() ?? null;
}

/**
 * כמה עמודים מפענחים יחד. `extractText` של unpdf מפענח את **כל** העמודים
 * ב-Promise.all אחד, וזה היה יקר כאן: תנאים כלליים של ביטוח הם בקלות כמה
 * מגה-בייט, והטקסט נחתך מיד אחר כך ל-docMaxChars. אצווה קטנה שומרת על
 * המקביליות במסמך קצר, ומאפשרת לעצור אחרי העמודים הראשונים במסמך ארוך.
 */
const PDF_PAGE_BATCH = 4;

/**
 * מפענחים מעט מעבר לתקרה: החיתוך הסופי נעשה על הטקסט **אחרי** נרמול הרווחים,
 * שמקצר אותו, ולכן עצירה בתקרה המדויקת הייתה חותכת מוקדם מדי.
 */
const PDF_BUDGET_SLACK = 1.3;

/**
 * הטקסט של עמוד בודד, בדיוק כפי ש-unpdf מחלץ אותו: `content.items`, השדה
 * `str`, ושבירת שורה לפי `hasEOL`.
 */
async function pdfPageText(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageNumber: number,
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items
    .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
    .join("");
}

/**
 * טקסט מתוך PDF, אצווה-אצווה, עם עצירה ברגע שיש די טקסט לתקרה.
 *
 * האיחוד זהה ל-`mergePages: true` של unpdf — `join("\n")` ואז כיווץ **כל**
 * רצף רווחים לרווח אחד — כדי שהטקסט שהמודל מקבל יישאר בית-בבית כשהיה. (שמירת
 * מבנה השורות של המסמך אפשרית וכנראה עדיפה, אבל זה שינוי תוכן ולא ביצועים.)
 */
async function pdfText(buffer: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(buffer);
  const budget = config.webSearch.docMaxChars * PDF_BUDGET_SLACK;
  const pages: string[] = [];
  let length = 0;

  for (let first = 1; first <= pdf.numPages && length < budget; first += PDF_PAGE_BATCH) {
    const count = Math.min(PDF_PAGE_BATCH, pdf.numPages - first + 1);
    const batch = await Promise.all(
      Array.from({ length: count }, (_, i) => pdfPageText(pdf, first + i)),
    );
    for (const text of batch) {
      pages.push(text);
      length += text.length;
    }
  }
  return pages.join("\n").replace(/\s+/g, " ");
}

/** כותרת ל-PDF מתוך תחילת הטקסט — עד 80 תווים, בגבול מילה */
function pdfTitle(text: string): string | null {
  const firstLine = text.trim().split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (firstLine.length === 0) return null;
  if (firstLine.length <= 80) return firstLine;
  const cut = firstLine.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + "…";
}

/** חתימת %PDF- בתחילת הקובץ */
function hasPdfMagic(buffer: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return magic.every((byte, i) => buffer[i] === byte);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 120) : "unknown";
}
