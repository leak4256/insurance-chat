import { z } from "zod";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { verifyPendingLogin } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { setCustomerSession } from "@/lib/session";

/** שלב ב' של ההתחברות: אימות קוד ה-OTP ופתיחת session (אפיון 6.1). */

const bodySchema = z.object({
  pendingId: z.string().min(8).max(64),
  code: z.string().regex(/^\d{6}$/, "הקוד הוא 6 ספרות"),
});

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
  if (!parsed.success) {
    return Response.json({ error: "יש להזין קוד בן 6 ספרות." }, { status: 400 });
  }

  const result = verifyPendingLogin(parsed.data.pendingId, parsed.data.code);
  if (!result.ok) {
    if (result.reason === "expired") {
      return Response.json(
        { error: "הקוד פג תוקף — התחילו את ההתחברות מחדש.", expired: true },
        { status: 410 },
      );
    }
    if (result.reason === "locked") {
      audit("otp_locked");
      return Response.json(
        { error: "יותר מדי ניסיונות שגויים — התחילו את ההתחברות מחדש.", expired: true },
        { status: 429 },
      );
    }
    audit("otp_failed");
    return Response.json({ error: "הקוד שגוי. נסו שוב." }, { status: 401 });
  }

  await setCustomerSession(result.customerId, result.firstName);
  audit("otp_verified", result.customerId);
  return Response.json({ ok: true, firstName: result.firstName });
}
