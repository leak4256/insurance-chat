/**
 * ערכות מיתוג לפי סוכנות. הבחירה ב-NEXT_PUBLIC_BRAND; ערך חסר או לא מוכר → default.
 * הצבעים עצמם ב-globals.css תחת [data-brand="<id>"]; כאן רק שם ולוגו.
 */
export interface Brand {
  id: string;
  /** שם העוזר בכותרת הצ'אט */
  name: string;
  /** כותרת לשונית הדפדפן */
  title: string;
  /** נתיב ב-public, או null להצגת האייקון הגנרי */
  logo: { src: string; alt: string; width: number; height: number } | null;
}

const BRANDS: Record<string, Brand> = {
  default: {
    id: "default",
    name: "העוזר הדיגיטלי של הסוכנות",
    title: "צ'אט הביטוח של הסוכנות",
    logo: null,
  },
  // "האור" — המיתוג של רחלי טיירי (design/שפה עיצובית סופית + מוצרים פרזנטציה.pdf)
  haor: {
    id: "haor",
    name: "העוזר הדיגיטלי של רחלי טיירי",
    title: "רחלי טיירי · העוזר הדיגיטלי",
    // כבוי בינתיים לבקשת לאה — מוצג האייקון הגנרי. להחזרה:
    // logo: { src: "/brand/haor/logo.png", alt: "רחלי טיירי", width: 340, height: 369 },
    logo: null,
  },
};

export const brand: Brand = BRANDS[process.env.NEXT_PUBLIC_BRAND ?? ""] ?? BRANDS.default;
