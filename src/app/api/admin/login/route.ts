import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { setAdminSession } from "@/lib/session";

/** כניסת הסוכן למסך הניהול — סיסמה מ-ADMIN_PASSWORD. */

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

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

  if (!config.admin.password || !config.auth.sessionSecret) {
    return Response.json(
      { error: "מסך הניהול לא הוגדר — נדרשים ADMIN_PASSWORD ו-SESSION_SECRET בסביבה." },
      { status: 503 },
    );
  }

  const parsed = z.object({ password: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !safeEqual(parsed.data.password, config.admin.password)) {
    audit("admin_login_failed");
    return Response.json({ error: "סיסמה שגויה." }, { status: 401 });
  }

  await setAdminSession();
  audit("admin_login");
  return Response.json({ ok: true });
}
