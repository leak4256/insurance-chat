import { z } from "zod";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { sendOtpEmail } from "@/lib/mailer";
import { createPendingLogin, generateOtpCode } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { findCustomerByIdAndEmail, isSurenseConfigured } from "@/lib/surense";

/**
 * שלב א' של ההתחברות (אפיון 6.1): ת"ז + אימייל → אימות מול Surense → קוד למייל.
 *
 * מניעת enumeration: אותה תשובה בדיוק בין אם הלקוח נמצא ובין אם לא —
 * "אם הפרטים נכונים, נשלח קוד". pendingId מוחזר תמיד.
 */

const bodySchema = z.object({
  idNumber: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\d{5,9}$/, "מספר זהות לא תקין")),
  email: z.string().trim().toLowerCase().pipe(z.email("כתובת אימייל לא תקינה")),
});

const UNIFORM_MESSAGE = "אם הפרטים תואמים לרשומות שלנו — שלחנו קוד בן 6 ספרות לכתובת המייל.";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = checkRateLimit(`auth:${ip}`, {
    windowMs: config.auth.rateLimitWindowMs,
    max: config.auth.rateLimitMax,
  });
  if (!rl.allowed) {
    return Response.json(
      { error: "יותר מדי ניסיונות התחברות — נסו שוב מאוחר יותר." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "יש למלא מספר זהות וכתובת אימייל תקינים." }, { status: 400 });
  }
  const { idNumber, email } = parsed.data;

  if (!isSurenseConfigured() || !config.auth.sessionSecret) {
    return Response.json(
      { error: "שירות ההזדהות אינו זמין כרגע. אפשר להמשיך לשאול שאלות כלליות." },
      { status: 503 },
    );
  }

  audit("login_started");
  try {
    const customer = await findCustomerByIdAndEmail(idNumber, email);

    if (!customer) {
      audit("login_customer_not_found");
      // רשומה ממתינה "ריקה" — האימות ייכשל, אבל התשובה זהה (מניעת enumeration)
      const pendingId = createPendingLogin({ found: false });
      return Response.json({ ok: true, pendingId, message: UNIFORM_MESSAGE });
    }

    const code = generateOtpCode();
    const pendingId = createPendingLogin({
      found: true,
      customerId: customer.id,
      // שורנס מחזיר fullName; לברכה בצ'אט מספיקה המילה הראשונה (השם הפרטי)
      firstName: customer.fullName?.trim().split(/\s+/)[0] ?? "",
      email,
      code,
    });
    await sendOtpEmail(email, code);
    audit("otp_sent", customer.id);
    return Response.json({ ok: true, pendingId, message: UNIFORM_MESSAGE });
  } catch (err) {
    console.error("auth/start error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "משהו השתבש. נסו שוב בעוד רגע." }, { status: 500 });
  }
}
