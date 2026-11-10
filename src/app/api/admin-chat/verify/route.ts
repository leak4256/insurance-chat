import { z } from "zod";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { verifyPendingLogin } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { setAdminChatSession } from "@/lib/session";

/** כניסת מנהל לצ'אט, שלב ב': אימות הקוד ופתיחת session מנהל (לבחירת לקוח בלבד). */

const bodySchema = z.object({
  pendingId: z.string().min(8).max(64),
  code: z.string().regex(/^\d{6}$/),
});

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

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "יש להזין קוד בן 6 ספרות." }, { status: 400 });
  }

  // kind "admin": קוד של התחברות לקוח לא פותח כאן כלום, ולהפך
  const result = verifyPendingLogin(parsed.data.pendingId, parsed.data.code, "admin");
  if (!result.ok) {
    audit("admin_chat_login_failed");
    if (result.reason === "invalid") {
      return Response.json({ error: "הקוד שגוי. נסו שוב." }, { status: 401 });
    }
    return Response.json({ error: "הקוד פג תוקף — התחילו מחדש.", expired: true }, { status: 410 });
  }

  await setAdminChatSession();
  audit("admin_chat_login");
  return Response.json({ ok: true });
}
