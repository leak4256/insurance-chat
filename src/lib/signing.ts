import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

/**
 * חתימת HMAC-SHA256 לערכים שנשמרים אצל הלקוח (session cookies, OAuth state).
 * הפורמט: base64url(payload) + "." + base64url(signature)
 */

function requireSecret(): string {
  const secret = config.auth.sessionSecret;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET חסר או קצר מדי (נדרשים לפחות 16 תווים)");
  }
  return secret;
}

function hmac(data: string): Buffer {
  return createHmac("sha256", requireSecret()).update(data).digest();
}

export function signPayload(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${hmac(encoded).toString("base64url")}`;
}

export function verifyPayload<T>(token: string | undefined): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const encoded = token.slice(0, dot);
  const signature = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = hmac(encoded);
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
