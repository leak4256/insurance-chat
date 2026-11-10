import { z } from "zod";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { sendOtpEmail } from "@/lib/mailer";
import { createPendingLogin, generateOtpCode } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * כניסת מנהל לצ'אט (בדיקות), שלב א': מייל מהרשימה הסגורה → קוד למייל.
 * מייל שאינו ברשימה מקבל בדיוק אותה תשובה — רשומה ממתינה שהאימות שלה ייכשל.
 */

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("כתובת אימייל לא תקינה")),
});

const UNIFORM_MESSAGE = "אם הכתובת מורשית — שלחנו אליה קוד בן 6 ספרות.";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = checkRateLimit(`admin:${ip}`, {
    windowMs: config.auth.rateLimitWindowMs,
    max: config.auth.rateLimitMax,
  });
  if (!rl.allowed) {
    return Response.json(
      { error: "יותר מדי ניסיונות — נסו שוב מאוחר יותר." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } },
    );
  }

  if (!config.auth.sessionSecret || config.admin.chatEmails.length === 0) {
    return Response.json({ error: "מצב מנהל אינו מוגדר בסביבה הזו." }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "יש להזין כתובת אימייל תקינה." }, { status: 400 });
  }
  const { email } = parsed.data;

  if (!config.admin.chatEmails.includes(email)) {
    audit("admin_chat_login_failed");
    const pendingId = createPendingLogin({ kind: "admin", found: false });
    return Response.json({ ok: true, pendingId, message: UNIFORM_MESSAGE });
  }

  try {
    const code = generateOtpCode();
    const pendingId = createPendingLogin({ kind: "admin", found: true, email, code });
    await sendOtpEmail(email, code);
    audit("admin_chat_otp_sent");
    return Response.json({ ok: true, pendingId, message: UNIFORM_MESSAGE });
  } catch (err) {
    console.error("admin-chat/start error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "שליחת הקוד נכשלה. נסו שוב בעוד רגע." }, { status: 500 });
  }
}
