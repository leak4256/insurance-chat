import { getCustomerSession } from "@/lib/session";

/** מצב ההזדהות לתצוגת ה-UI (כפתור התחברות / תג "מחובר/ת" — FR-10). */
export async function GET() {
  try {
    const session = await getCustomerSession();
    if (!session) return Response.json({ authenticated: false });
    return Response.json({ authenticated: true, firstName: session.firstName });
  } catch {
    // SESSION_SECRET חסר וכד' — מבחינת ה-UI פשוט לא מחוברים
    return Response.json({ authenticated: false });
  }
}
