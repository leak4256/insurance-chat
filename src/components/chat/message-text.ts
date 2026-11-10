import type { UIMessage } from "ai";

/** הטקסט של ההודעה — חיבור חלקי ה-text שלה */
export function messageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<(typeof message.parts)[number], { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * המודל כותב לפעמים את שם הכלי `request_login` **כטקסט** בגוף התשובה במקום
 * לקרוא לכלי (נצפה ב-gemini-flash-lite). התוצאה אצל הלקוחה: שם של כלי פנימי
 * על המסך, ובלי כרטיס התחברות.
 *
 * הטיפול כאן דו-כיווני, ובכוונה בצד הלקוח: הטקסט מנוקה לפני ההצגה
 * (`stripLoginToolText`), והאזכור נחשב בקשת התחברות לכל דבר
 * (`mentionsLoginTool`), כך שהכרטיס מוצג בכל זאת. ה-system prompt מבקש מהמודל
 * לקרוא לכלי — אבל אסור שהתצוגה תישבר כשהוא לא מציית.
 */
const LOGIN_TOOL_TOKEN = String.raw`\[?\`?\brequest_login\b(?:\(\s*\))?\`?\]?`;

/** האם ההודעה מזכירה את הכלי בטקסט (ולכן ביקשה התחברות, גם בלי קריאה לכלי) */
export function mentionsLoginTool(text: string): boolean {
  return new RegExp(LOGIN_TOOL_TOKEN).test(text);
}

/** הסרת האזכור מהטקסט המוצג, עם ניקוי השורות הריקות שנשארות אחריו */
export function stripLoginToolText(text: string): string {
  return text
    .replace(new RegExp(LOGIN_TOOL_TOKEN, "g"), "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * אימות שורת "מקור:" — בדיקה **דטרמיניסטית** בצד הפלט.
 *
 * כל הגנות הדיוק האחרות הן הנחיות למודל. זו לא: שורת "מקור: X" כשאף כלי לא
 * החזיר מסמך בשם X היא עובדה בדיקה, לא שיפוט. כשאין התאמה השורה מוסרת
 * מההצגה — גוף התשובה נשאר, רק טענת המקור שאי אפשר לאמת יורדת. הלקוחה לא
 * רואה ציטוט שאין לו תגית.
 *
 * האימות נעשה מול **כל מסמכי השיחה**, לא מול ההודעה הנוכחית בלבד: תשובה
 * יכולה לצטט בצדק מסמך שחזר בתור קודם ונותר בהקשר (נצפה 04.11.2026), והסרת
 * ציטוט אמיתי גרועה מהשארתו.
 */
const SOURCE_LINE_RE = /^[ \t]*\*{0,2}מקור:[ \t]*(.+?)[ \t]*\*{0,2}[ \t]*$/m;

/** נרמול להשוואה: מרכאות/גרשיים, רווחים כפולים ו-nbsp */
function normalizeForMatch(value: string): string {
  return value
    .replace(/ /g, " ")
    .replace(/["'״׳]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** תוכן שורת ה"מקור:" של התשובה, או null אם אין שורה כזו */
export function sourceLine(text: string): string | null {
  return text.match(SOURCE_LINE_RE)?.[1]?.trim() ?? null;
}

/**
 * האם שורת ה"מקור:" מאוזכרת במסמך שבאמת חזר מכלי בשיחה.
 * אין שורת מקור → true (אין מה לאמת).
 */
export function sourceLineIsVerified(text: string, knownDocuments: string[]): boolean {
  const line = sourceLine(text);
  if (line == null) return true;
  const haystack = normalizeForMatch(line);
  return knownDocuments.some((doc) => {
    const needle = normalizeForMatch(doc);
    // שם קצר מדי יוצר התאמות שווא
    return needle.length >= 3 && haystack.includes(needle);
  });
}

/**
 * האם התשובה **מצטטת** מסמך מאגר בפועל: יש שורת "מקור:" והיא מאומתת.
 *
 * זה התנאי להצגת תגיות מסמכי המאגר (ר' `extractSources`). בלעדיו הוצגו תגיות
 * גם על תשובת ידע כללי — כל מה ש-`search_knowledge` החזיר קיבל תגית, בלי קשר
 * לשאלה אם התשובה נשענה עליו. ללקוחה זו הצגה מטעה: שלוש תגיות מסמכים ליד
 * משפט שאומר שההסבר כללי (נצפה 06.11.2026).
 */
export function citesKnowledgeDocument(text: string, knownDocuments: string[]): boolean {
  return sourceLine(text) != null && sourceLineIsVerified(text, knownDocuments);
}

/**
 * מספרי העמודים שחזרו מ-`search_knowledge` בשיחה, לפי שם מסמך.
 * מסמך טקסט (בלי עמודים, `page: null`) אינו מופיע כאן כלל.
 */
export type KnownPages = Map<string, Set<number>>;

/**
 * הפניית עמוד בשורת המקור: "עמ' 12", "עמ׳ 3-4", "עמוד 5" — כולל המפריד שלפניה
 * (פסיק או מקף), כדי שהסרתה לא תשאיר "שם מסמך," תלוי באוויר. סוגריים אינם
 * נבלעים כאן — "(עמ' 7)" משאיר "()" שמנוקה אחר כך, ו"(חלק א, עמ' 5)" שומר על
 * הסוגר הסוגר של שם המסמך.
 * הבדיקה שלפני "עמ" מוודאת שזו מילה שלמה ולא סוף של מילה אחרת.
 */
const PAGE_REF_SOURCE = String.raw`[ \t]*[,،\-–—]*[ \t]*(?<![֐-׿])(?:עמ(?:וד|['׳’])?|ע['׳’])[ \t]*(\d+)(?:[ \t]*[-–][ \t]*(\d+))?`;

/**
 * הסרת הפניות עמוד שאין להן כיסוי בקטעים שחזרו מהכלי — בדיקה **דטרמיניסטית**.
 *
 * המקרה (נצפה 10.11.2026): מסמכי ה-txt של המאגר נטענים בלי עמודים, והמודל
 * (Gemini) כתב "מקור: …, עמ' 1" — עמוד שלא קיים, בהשראת הדוגמה בפרומפט. שם
 * המסמך אמיתי, ולכן `stripUnverifiedSourceLine` לא תופס את זה.
 *
 * ההפניה נבדקת מול המסמך ששמו מופיע **באותו מקטע** של שורת המקור (מקטעים
 * מופרדים ב-";"), לא מול כל עמוד שחזר בשיחה: "עמ' 1" ליד מסמך טקסט אינו נהיה
 * אמיתי בגלל שמסמך PDF אחר החזיר את עמוד 1. מסמך רשמי מהחיפוש החי אינו מחזיר
 * עמודים, ולכן גם הפניית עמוד אליו מוסרת — אין לנו נתון שמאמת אותה.
 *
 * רק ההפניה יורדת; שם המסמך והתשובה נשארים. שורה בלי הפניות עמוד, או שכולן
 * מאומתות — הטקסט כמו שהוא.
 */
export function stripUnverifiedPageRefs(text: string, knownPages: KnownPages): string {
  const line = sourceLine(text);
  if (line == null || !new RegExp(PAGE_REF_SOURCE).test(line)) return text;

  const cleanSegment = (segment: string): string => {
    const haystack = normalizeForMatch(segment);
    const allowed = new Set<number>();
    for (const [doc, pages] of knownPages) {
      const needle = normalizeForMatch(doc);
      if (needle.length >= 3 && haystack.includes(needle)) pages.forEach((p) => allowed.add(p));
    }
    return segment
      .replace(new RegExp(PAGE_REF_SOURCE, "g"), (ref, from: string, to?: string) =>
        [from, to].filter(Boolean).every((n) => allowed.has(Number(n))) ? ref : "",
      )
      .replace(/\(\s*\)/g, "")
      .replace(/[ \t]+/g, " ")
      .trim();
  };

  const cleaned = line
    .split(";")
    .map(cleanSegment)
    .filter(Boolean)
    .join("; ");
  if (cleaned === line) return text;

  if (process.env.NODE_ENV !== "production") {
    console.warn(`הפניית עמוד לא מאומתת הוסרה משורת המקור: "${line}"`);
  }
  // החלפה לפי פונקציה: ב-`cleaned` עלול להיות "$", שהוא תחביר מיוחד במחרוזת חלופה
  return text.replace(SOURCE_LINE_RE, (whole, captured: string) =>
    whole.replace(captured, () => cleaned),
  );
}

/** הסרת שורת "מקור:" שאינה מאומתת. שורה מאומתת, או היעדר שורה — הטקסט כמו שהוא. */
export function stripUnverifiedSourceLine(text: string, knownDocuments: string[]): string {
  if (sourceLineIsVerified(text, knownDocuments)) return text;
  if (process.env.NODE_ENV !== "production") {
    console.warn(`שורת מקור לא מאומתת הוסרה מההצגה: "${sourceLine(text)}"`);
  }
  return text
    .replace(SOURCE_LINE_RE, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
