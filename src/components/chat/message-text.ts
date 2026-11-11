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
 * שורת ההבהרה של תשובה מידע כללי ("ההסבר כאן כללי — ..."). הפרומפט מתיר נוסח
 * "קרוב לו", ולכן התבנית גמישה ("ההסבר כאן/הזה (הוא) כללי"), אבל המילה "כללי"
 * חייבת לעמוד לבדה ולהיגמר בסימן פיסוק, והשורה קצרה — כך שורה בגוף התשובה
 * כמו "ההסבר על קרן כללית…" אינה נמחקת.
 */
const DISCLAIMER_LINE_RE =
  /^[ \t]*[*_]{0,2}ההסבר(?: כאן| הזה)?(?: הוא)? כללי[ \t]*[—–\-,.:][^\n]{0,100}$/gm;

/**
 * הסרת שורת ההבהרה מתשובה **שיש לה מקור** — בדיקה דטרמיניסטית (לבקשת לאה,
 * 11.11.2026). ההבהרה מיועדת רק לתשובה שהמודל כתב מהידע שלו; תשובה ממסמך
 * המאגר או ממסמך רשמי שנפתח בחיפוש החי אינה "כללית". המודל מוסיף אותה בכל
 * זאת, למרות ההנחיה — ולכן ההצגה מתקנת את זה, כמו את שורת "מקור:".
 *
 * `hasSource` נקבע אצל המתקשר: יש תגיות מקור להצגה (ובזמן ההזרמה — יש שורת
 * "מקור:", כדי שההבהרה לא תופיע ותיעלם עם סיום התשובה).
 */
export function stripGeneralDisclaimer(text: string, hasSource: boolean): string {
  if (!hasSource) return text;
  DISCLAIMER_LINE_RE.lastIndex = 0;
  if (!DISCLAIMER_LINE_RE.test(text)) return text;
  return text
    .replace(DISCLAIMER_LINE_RE, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * הסרת שורת "מקור:" מההצגה — **תמיד**, גם כשהיא מאומתת (החלטת לאה, 10.11.2026).
 *
 * המסמכים כבר מוצגים כתגיות מתחת לתשובה, תחת הכותרת "מקורות:", והשורה בטקסט
 * רק כפלה אותן. המודל ממשיך לכתוב את השורה, כי היא מה שמאמת שהתשובה מצטטת
 * מסמך (`citesKnowledgeDocument`) — ולכן ההסרה נעשית בהצגה בלבד, על הטקסט
 * שכבר נבדק. נקרא גם בזמן ההזרמה: הביטוי תופס גם שורה שנכתבה רק בחלקה, כך
 * שהשורה לא מהבהבת לפני שהיא נעלמת.
 */
export function stripSourceLine(text: string): string {
  if (sourceLine(text) == null) return text;
  return text
    .replace(SOURCE_LINE_RE, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
