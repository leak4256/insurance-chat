import { createHash, randomBytes, randomInt } from "node:crypto";
import { config } from "./config";

/**
 * קודי OTP (אפיון סעיף 6.1): 6 ספרות, תוקף 10 דקות, עד 5 ניסיונות,
 * השהיית שליחה חוזרת של 60 שניות.
 *
 * האחסון בזיכרון התהליך בלבד (שרת יחיד ב-Railway) — עולה בקנה אחד עם
 * עקרון "אין נתונים אישיים במנוחה". הקוד עצמו נשמר כ-hash בלבד.
 *
 * מניעת enumeration: נוצרת רשומה ממתינה גם כשהלקוח לא נמצא ב-Surense
 * (found=false) — המסלול מחזיר תמיד אותה תשובה, והאימות פשוט ייכשל.
 */

interface PendingLogin {
  /** hash של קוד ה-OTP (או null כשהלקוח לא נמצא — אימות ייכשל תמיד) */
  codeHash: string | null;
  /** UUID של הלקוח ב-Surense (ריק כשלא נמצא) */
  customerId: string;
  firstName: string;
  email: string;
  attemptsLeft: number;
  expiresAt: number;
  /** מתי מותר לשלוח קוד חוזר */
  resendAllowedAt: number;
}

const pending = new Map<string, PendingLogin>();

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (entry.expiresAt < now) pending.delete(id);
  }
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** יצירת בקשת התחברות ממתינה. מחזירה מזהה אקראי שנמסר ללקוח. */
export function createPendingLogin(input: {
  found: boolean;
  customerId?: string;
  firstName?: string;
  email?: string;
  code?: string;
}): string {
  prune();
  const id = randomBytes(16).toString("base64url");
  pending.set(id, {
    codeHash: input.found && input.code ? hashCode(input.code) : null,
    customerId: input.customerId ?? "",
    firstName: input.firstName ?? "",
    email: input.email ?? "",
    attemptsLeft: config.auth.otpMaxAttempts,
    expiresAt: Date.now() + config.auth.otpTtlMs,
    resendAllowedAt: Date.now() + config.auth.otpResendCooldownSec * 1000,
  });
  return id;
}

export type VerifyResult =
  | { ok: true; customerId: string; firstName: string }
  | { ok: false; reason: "invalid" | "expired" | "locked" };

export function verifyPendingLogin(pendingId: string, code: string): VerifyResult {
  prune();
  const entry = pending.get(pendingId);
  if (!entry || entry.expiresAt < Date.now()) return { ok: false, reason: "expired" };
  if (entry.attemptsLeft <= 0) return { ok: false, reason: "locked" };

  entry.attemptsLeft--;
  const valid = entry.codeHash !== null && hashCode(code) === entry.codeHash;
  if (!valid) {
    if (entry.attemptsLeft <= 0) {
      pending.delete(pendingId);
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "invalid" };
  }

  pending.delete(pendingId);
  return { ok: true, customerId: entry.customerId, firstName: entry.firstName };
}

/** שליחה חוזרת: קוד חדש לאותה רשומה, בכפוף להשהיה. מחזירה את פרטי היעד. */
export function refreshPendingLogin(pendingId: string):
  | { ok: true; found: boolean; email: string; code: string }
  | { ok: false; reason: "expired" | "cooldown" } {
  prune();
  const entry = pending.get(pendingId);
  if (!entry || entry.expiresAt < Date.now()) return { ok: false, reason: "expired" };
  if (Date.now() < entry.resendAllowedAt) return { ok: false, reason: "cooldown" };

  const code = generateOtpCode();
  const found = entry.codeHash !== null;
  if (found) entry.codeHash = hashCode(code);
  entry.expiresAt = Date.now() + config.auth.otpTtlMs;
  entry.resendAllowedAt = Date.now() + config.auth.otpResendCooldownSec * 1000;
  entry.attemptsLeft = config.auth.otpMaxAttempts;
  return { ok: true, found, email: entry.email, code };
}
