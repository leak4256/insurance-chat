import { fetchPublicPdf, WebSourceError } from "@/lib/web-search";
import { checkRateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/config";

/**
 * הגשת מסמך מקור לצפייה בדפדפן.
 *
 * למה בכלל: חלק משרתי חברות הביטוח (וגם סינון ה-TLS בדרך) מחזירים את ה-PDF
 * באופן שגורם לדפדפן להוריד אותו במקום להציג אותו. הלקוחה לוחצת על "מקור"
 * ומקבלת חלון שמירה. כאן אנחנו מורידים את הקובץ בצד שרת ומגישים אותו מחדש עם
 * `Content-Disposition: inline`, כך שהוא נפתח בצפיין ה-PDF של הדפדפן.
 *
 * זה **לא** פרוקסי כללי: רק כתובות מרשימת ההיתר (`src/lib/web-sources.ts`),
 * רק קבצים שהבייטים שלהם הם PDF, ועם הגבלת קצב לפי IP.
 */
export const maxDuration = 60;

export async function GET(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = checkRateLimit(`source:${ip}`, {
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max * 2, // פתיחת מסמכים זולה יותר מהודעה למודל
  });
  if (!rl.allowed) {
    return new Response("יותר מדי בקשות — נסו שוב בעוד כמה דקות.", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSec ?? 60) },
    });
  }

  const target = new URL(req.url).searchParams.get("url");
  if (!target) return new Response("חסרה כתובת מסמך.", { status: 400 });

  try {
    const file = await fetchPublicPdf(target);
    return new Response(file.bytes as BodyInit, {
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.bytes.byteLength),
        // inline = להציג בדפדפן; השם נשמר כדי שהורדה ידנית תקבל שם הגיוני
        "content-disposition": `inline; filename="${file.fileName}"`,
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (err) {
    const reason = err instanceof WebSourceError ? err.message : "unknown";
    console.error("source route failed:", reason.slice(0, 160));
    // כתובת שאינה ברשימת ההיתר או שאינה PDF — לא נחשפים פרטים מיותרים
    const notAllowed = reason.startsWith("url not allowed") || reason === "not a PDF";
    return new Response(
      notAllowed ? "המסמך הזה אינו זמין לצפייה." : "לא הצלחנו לפתוח את המסמך כרגע.",
      { status: notAllowed ? 400 : 502 },
    );
  }
}
