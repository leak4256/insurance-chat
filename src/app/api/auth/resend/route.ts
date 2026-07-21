import { z } from "zod";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { sendOtpEmail } from "@/lib/mailer";
import { refreshPendingLogin } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";

/** שליחה חוזרת של קוד OTP — בכפוף להשהיה של 60 שניות (אפיון 6.1). */

const bodySchema = z.object({ pendingId: z.string().min(8).max(64) });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = checkRateLimit(`auth:${ip}`, {
    windowMs: config.auth.rateLimitWindowMs,
    max: config.auth.rateLimitMax,
  });
  if (!rl.allowed) {
    return Response.json(
      { error: "יותר מדי ניסיונות — נסו שוב מאוחר יותר." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "בקשה לא תקינה." }, { status: 400 });

  const result = refreshPendingLogin(parsed.data.pendingId);
  if (!result.ok) {
    if (result.reason === "cooldown") {
      return Response.json(
        { error: `אפשר לבקש קוד חדש רק אחרי ${config.auth.otpResendCooldownSec} שניות.` },
        { status: 429 },
      );
    }
    return Response.json(
      { error: "הבקשה פגה — התחילו את ההתחברות מחדש.", expired: true },
      { status: 410 },
    );
  }

  try {
    // גם כאן שומרים על תשובה אחידה: שולחים בפועל רק אם הלקוח נמצא
    if (result.found) {
      await sendOtpEmail(result.email, result.code);
      audit("otp_resent");
    }
    return Response.json({ ok: true, message: "אם הפרטים תואמים — נשלח קוד חדש למייל." });
  } catch (err) {
    console.error("auth/resend error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "משהו השתבש. נסו שוב בעוד רגע." }, { status: 500 });
  }
}
