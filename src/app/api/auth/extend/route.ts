import { audit } from "@/lib/audit";
import {
  customerSessionTiming,
  getCustomerSession,
  setCustomerSession,
} from "@/lib/session";

/**
 * ביטול הניתוק (בדקת האזהרה בסוף ההתחברות): פותח session חדש לשעתיים.
 * דורש session תקף — אחרי שהדקה חלפה וה-cookie פג, אין מה להאריך וצריך להתחבר מחדש (OTP).
 */
export async function POST() {
  try {
    const session = await getCustomerSession();
    if (!session) return Response.json({ authenticated: false }, { status: 401 });

    const renewed = await setCustomerSession(session.customerId, session.firstName);
    audit("session_extended", session.customerId);

    return Response.json({
      authenticated: true,
      firstName: renewed.firstName,
      ...customerSessionTiming(renewed),
    });
  } catch {
    return Response.json({ authenticated: false }, { status: 401 });
  }
}
