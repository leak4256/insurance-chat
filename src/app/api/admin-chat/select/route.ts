import { z } from "zod";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAdminChatAuthenticated, setCustomerSession } from "@/lib/session";
import { findCustomerByIdAndEmail, isSurenseConfigured } from "@/lib/surense";

/** ר' auth/start: קריאה ל-Make עשויה לקחת עד 45 שניות */
export const maxDuration = 60;

/**
 * מצב מנהל: בחירת לקוח לפי ת"ז + אימייל, בלי קוד ללקוח. כותב session לקוח
 * רגיל (viaAdmin) — מכאן הצ'אט עובד בדיוק כאילו הלקוח עצמו התחבר.
 *
 * החיפוש דורש את שני השדות כי זה מה שתרחיש ה-Make מסנן לפיו
 * (search_customers{idNumber,email}); חיפוש לפי ת"ז בלבד דורש שינוי בתרחיש.
 */

const bodySchema = z.object({
  idNumber: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\d{5,9}$/)),
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export async function POST(req: Request) {
  if (!(await isAdminChatAuthenticated().catch(() => false))) {
    return Response.json({ error: "פג תוקף כניסת המנהל — התחברו מחדש.", expired: true }, { status: 401 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  // מכסה נדיבה יותר מזו של ההתחברות — בבדיקות מחליפים לקוח הרבה
  const rl = checkRateLimit(`admin-select:${ip}`, { windowMs: 15 * 60_000, max: 30 });
  if (!rl.allowed) {
    return Response.json(
      { error: "יותר מדי חיפושים — נסו שוב בעוד כמה דקות." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "יש להזין ת\"ז ואימייל תקינים של הלקוח." }, { status: 400 });
  }

  if (!isSurenseConfigured()) {
    return Response.json({ error: "החיבור ל-Surense אינו מוגדר בסביבה הזו." }, { status: 503 });
  }

  try {
    const customer = await findCustomerByIdAndEmail(parsed.data.idNumber, parsed.data.email);
    if (!customer) {
      return Response.json({ error: "לא נמצא לקוח עם הת\"ז והאימייל האלה." }, { status: 404 });
    }
    const firstName = customer.fullName?.trim().split(/\s+/)[0] ?? "";
    await setCustomerSession(customer.id, firstName, true);
    audit("admin_customer_selected", customer.id);
    return Response.json({ ok: true, firstName, fullName: customer.fullName ?? firstName });
  } catch (err) {
    console.error("admin-chat/select error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "החיפוש ב-Surense נכשל. נסו שוב בעוד רגע." }, { status: 502 });
  }
}
