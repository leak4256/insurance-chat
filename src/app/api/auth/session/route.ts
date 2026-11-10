import { customerSessionTiming, getCustomerSession } from "@/lib/session";

/**
 * מצב ההזדהות לתצוגת ה-UI (כפתור התחברות / תג "מחובר/ת" — FR-10).
 * כולל את הזמנים עד הודעת הניתוק ועד הניתוק בפועל, כדי שהם ישרדו רענון עמוד.
 */
export async function GET() {
  try {
    const session = await getCustomerSession();
    if (!session) return Response.json({ authenticated: false });
    return Response.json({
      authenticated: true,
      firstName: session.firstName,
      ...customerSessionTiming(session),
    });
  } catch {
    // SESSION_SECRET חסר וכד' — מבחינת ה-UI פשוט לא מחוברים
    return Response.json({ authenticated: false });
  }
}
