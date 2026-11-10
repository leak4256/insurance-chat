import { cookies } from "next/headers";
import { config } from "./config";
import { signPayload, verifyPayload } from "./signing";

/**
 * ניהול session (אפיון סעיף 6.1): cookie חתום httpOnly + Secure + SameSite,
 * מכיל את ה-UUID של הלקוח ב-Surense. ההתחברות נמשכת שעתיים מהשימוש האחרון
 * (מתגלגלת: כל הודעה מאומתת בצ'אט מאפסת את הספירה) ושורדת רענון עמוד,
 * כי היא יושבת ב-cookie. אחרי שעתיים של חוסר שימוש ה-UI מציג דקת אזהרה עם
 * אפשרות ביטול; לכן ה-cookie תקף שעתיים + דקת האזהרה, וביטול הניתוק
 * מנפיק session חדש (/api/auth/extend).
 * אין שום נתון אישי במסד — הכול בתוך ה-cookie החתום בלבד.
 */

const CUSTOMER_COOKIE = "ic_session";
const ADMIN_COOKIE = "ic_admin";

export interface CustomerSession {
  /** UUID של הלקוח ב-Surense */
  customerId: string;
  /** שם פרטי לתצוגה בלבד */
  firstName: string;
  /** תום תוקף (epoch ms) */
  exp: number;
}

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

/** כמה זמן ה-cookie תקף בפועל: משך ההתחברות + חלון האזהרה */
function customerCookieLifetimeMs(): number {
  return config.auth.sessionTtlMs + config.auth.sessionWarningMs;
}

/** session חדש (תום תוקף מחושב מעכשיו) וה-cookie שמכיל אותו */
function buildCustomerSessionCookie(customerId: string, firstName: string): {
  session: CustomerSession;
  name: string;
  value: string;
  options: ReturnType<typeof cookieOptions>;
} {
  const lifetimeMs = customerCookieLifetimeMs();
  const session: CustomerSession = { customerId, firstName, exp: Date.now() + lifetimeMs };
  return { session, name: CUSTOMER_COOKIE, value: signPayload(session), options: cookieOptions(lifetimeMs) };
}

export async function setCustomerSession(customerId: string, firstName: string): Promise<CustomerSession> {
  const { session, name, value, options } = buildCustomerSessionCookie(customerId, firstName);
  (await cookies()).set(name, value, options);
  return session;
}

/**
 * זמנים לתצוגת ה-UI, יחסיים ל"עכשיו" (ולא חותמות זמן מוחלטות) כדי שהפרשי שעון
 * בין השרת לדפדפן לא יזיזו את האזהרה.
 * warnInMs — עד תחילת הודעת הניתוק; expiresInMs — עד הניתוק בפועל.
 */
export function customerSessionTiming(session: CustomerSession): {
  warnInMs: number;
  expiresInMs: number;
} {
  const expiresInMs = Math.max(0, session.exp - Date.now());
  return { warnInMs: Math.max(0, expiresInMs - config.auth.sessionWarningMs), expiresInMs };
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  const session = verifyPayload<CustomerSession>(token);
  if (!session || typeof session.exp !== "number" || session.exp < Date.now()) return null;
  return session;
}

export async function clearCustomerSession(): Promise<void> {
  (await cookies()).delete(CUSTOMER_COOKIE);
}

/** כותרת Set-Cookie להארכת session בתשובת streaming (שם=ערך; אפשרויות כטקסט) */
export function customerSessionSetCookieHeader(session: CustomerSession): string {
  const { name, value, options } = buildCustomerSessionCookie(session.customerId, session.firstName);
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    `SameSite=${options.sameSite === "lax" ? "Lax" : options.sameSite}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

// ---------- session של הסוכן (מסך האדמין) ----------

interface AdminSession {
  admin: true;
  exp: number;
}

export async function setAdminSession(): Promise<void> {
  const session: AdminSession = { admin: true, exp: Date.now() + config.admin.sessionTtlMs };
  (await cookies()).set(ADMIN_COOKIE, signPayload(session), cookieOptions(config.admin.sessionTtlMs));
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  const session = verifyPayload<AdminSession>(token);
  return !!session && session.admin === true && session.exp > Date.now();
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}
