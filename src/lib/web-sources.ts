/**
 * רשימת ההיתר למקורות החיפוש החי (גיבוי למאגר הידע).
 *
 * החיפוש החי מוגבל בכוונה לשני סוגי מקורות בלבד:
 * 1. אתרים ממשלתיים — כל מה שתחת `gov.il` (רשות שוק ההון, האוצר, הר הביטוח,
 *    ביטוח לאומי, פנסיה-נט/גמל-נט).
 * 2. אתרי חברות הביטוח ובתי ההשקעות עצמם — הרשימה למטה.
 *
 * אתר שאינו ברשימה לא ייכנס לתשובה גם אם מנוע החיפוש יחזיר אותו: הסינון נאכף
 * גם על תוצאות החיפוש וגם על הורדת המסמך (כולל אחרי הפניות). זו רשימת היתר,
 * לא רשימת חסימה — host לא מוכר נדחה.
 *
 * מודול נטול תלויות (כמו `domains.ts`) כדי שיהיה בטוח לייבוא מכל מקום.
 */

/**
 * האתרים שאומתו חיים (21.10.2026, בדיקת HTTP ישירה).
 * להוספת חברה: שורה אחת כאן, או `WEB_SEARCH_EXTRA_HOSTS` ב-env (מופרד בפסיקים).
 * host שאינו נכון פירושו רק שלא נחפש שם — הוא אינו מסוכן, אבל גם אינו מכוסה.
 */
export const SOURCES: { host: string; names: string[] }[] = [
  // חברות ביטוח
  { host: "harel-group.co.il", names: ["הראל"] },
  { host: "migdal.co.il", names: ["מגדל"] },
  { host: "clalbit.co.il", names: ["כלל", "כלל ביטוח"] },
  { host: "fnx.co.il", names: ["הפניקס"] },
  { host: "menoramivt.co.il", names: ["מנורה", "מנורה מבטחים", "מבטחים"] },
  { host: "ayalon-ins.co.il", names: ["איילון"] },
  { host: "shirbit.co.il", names: ["שירביט"] },
  { host: "hcsra.co.il", names: ["הכשרה", "הכשרת הישוב"] },
  { host: "aig.co.il", names: ["AIG", "איי איי ג'י"] },
  { host: "shlomo-bit.co.il", names: ["שלמה", "שלמה ביטוח"] },
  { host: "we-sure.co.il", names: ["וישור"] },
  { host: "passportcard.co.il", names: ["פספורטכארד", "PassportCard"] },
  { host: "davidshield.com", names: ["דיוידשילד", "DavidShield"] },
  // בתי השקעות / קופות גמל וקרנות פנסיה
  { host: "as-invest.co.il", names: ["אלטשולר", "אלטשולר שחם"] },
  { host: "meitav.co.il", names: ["מיטב", "מיטב דש"] },
  { host: "moreinvest.co.il", names: ["מור"] },
  { host: "more.co.il", names: [] }, // מפנה ל-moreinvest.co.il
  { host: "psagot.co.il", names: ["פסגות"] },
  { host: "xnes.co.il", names: ["אקסלנס", "הפניקס בית השקעות"] },
];

export const ALLOWED_SOURCE_HOSTS = SOURCES.map((s) => s.host);

/**
 * תרגום שם גוף לדומיין, כדי שהמודל לא ינחש כתובות. מקבל גם דומיין כמו שהוא.
 * לא נמצאה התאמה → null, והחיפוש יירוץ על המקורות הממשלתיים בלבד.
 */
export function resolveSourceHost(input: string): string | null {
  const raw = input.trim();
  if (raw.length === 0) return null;
  if (isAllowedHost(raw)) return normalizeHost(raw);

  const needle = raw.toLowerCase().replace(/^חברת\s+|\s+ביטוח$/g, "").trim();
  for (const source of SOURCES) {
    if (source.names.some((name) => name.toLowerCase() === needle)) return source.host;
  }
  return null;
}

/** הרחבה מ-env, לשינוי בלי שינוי קוד */
function extraHosts(): string[] {
  return (process.env.WEB_SEARCH_EXTRA_HOSTS ?? "")
    .split(",")
    .map((h) => normalizeHost(h))
    .filter((h) => h.length > 0);
}

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/\.$/, "") // trailing dot ב-FQDN
    .replace(/^www\./, "");
}

/** התאמה ל-host עצמו או לתת-דומיין שלו — ולא ל-"evil-migdal.co.il" */
function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * האם ה-host מותר כמקור לחיפוש החי.
 * מקור ממשלתי: כל תת-דומיין של gov.il. אחרת: רשימת ההיתר + הרחבת ה-env.
 */
export function isAllowedHost(rawHost: string): boolean {
  const host = normalizeHost(rawHost);
  if (host.length === 0) return false;
  if (hostMatches(host, "gov.il")) return true;
  return [...ALLOWED_SOURCE_HOSTS, ...extraHosts()].some((allowed) =>
    hostMatches(host, normalizeHost(allowed)),
  );
}

/** האם ה-host הוא מקור ממשלתי (לציון סוג המקור בתשובה) */
export function isGovHost(rawHost: string): boolean {
  return hostMatches(normalizeHost(rawHost), "gov.il");
}

/** בדיקת כתובת שלמה: סכמה + host מותר. מחזיר את ה-URL המנורמל או null */
export function parseAllowedUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null; // כתובת עם credentials — לא
  if (!isAllowedHost(url.hostname)) return null;
  return url;
}
