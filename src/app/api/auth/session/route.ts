import { customerSessionTiming, getCustomerSession, isAdminChatAuthenticated } from "@/lib/session";

/**
 * מצב ההזדהות לתצוגת ה-UI (כפתור התחברות / תג "מחובר/ת" — FR-10).
 * כולל את הזמנים עד הודעת הניתוק ועד הניתוק בפועל, כדי שהם ישרדו רענון עמוד.
 */
export async function GET() {
  try {
    const [session, admin] = await Promise.all([getCustomerSession(), isAdminChatAuthenticated()]);
    if (!session) return Response.json({ authenticated: false, admin });
    return Response.json({
      authenticated: true,
      firstName: session.firstName,
      admin,
      viaAdmin: session.viaAdmin === true,
      ...customerSessionTiming(session),
    });
  } catch {
    // SESSION_SECRET חסר וכד' — מבחינת ה-UI פשוט לא מחוברים
    return Response.json({ authenticated: false });
  }
}
