import { audit } from "@/lib/audit";
import { clearCustomerSession, getCustomerSession } from "@/lib/session";

/** ניתוק יזום (FR-8). */
export async function POST() {
  try {
    const session = await getCustomerSession();
    if (session) audit("logout", session.customerId);
  } catch {
    // גם אם ה-session לא נקרא (SESSION_SECRET חסר וכד') — עדיין מוחקים את ה-cookie
  }
  await clearCustomerSession();
  return Response.json({ ok: true });
}
