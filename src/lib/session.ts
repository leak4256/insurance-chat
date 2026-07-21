import { cookies } from "next/headers";
import { config } from "./config";
import { signPayload, verifyPayload } from "./signing";

/**
 * ניהול session (אפיון סעיף 6.1): cookie חתום httpOnly + Secure + SameSite,
 * מכיל את ה-UUID של הלקוח ב-Surense. פקיעה אחרי 30 דקות חוסר פעילות —
 * ההארכה (sliding) נעשית במסלול הצ'אט על כל בקשה מאומתת.
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

/** ערך ה-cookie של session לקוח (לשימוש גם בכותרת Set-Cookie ידנית בתשובת streaming) */
export function buildCustomerSessionCookie(customerId: string, firstName: string): {
  name: string;
  value: string;
  options: ReturnType<typeof cookieOptions>;
} {
  const session: CustomerSession = {
    customerId,
    firstName,
    exp: Date.now() + config.auth.sessionTtlMs,
  };
  return { name: CUSTOMER_COOKIE, value: signPayload(session), options: cookieOptions(config.auth.sessionTtlMs) };
}

export async function setCustomerSession(customerId: string, firstName: string): Promise<void> {
  const { name, value, options } = buildCustomerSessionCookie(customerId, firstName);
  (await cookies()).set(name, value, options);
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
