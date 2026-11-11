import { getCustomerSession } from "@/lib/session";
import { dataValidityMonth, getCustomer, isSurenseConfigured } from "@/lib/surense";

/**
 * לאיזה חודש נכונים נתוני הלקוח המחובר — להודעה הקבועה שמוצגת מיד אחרי
 * ההתחברות (לבקשת לאה, 11.11.2026). מחזיר רק את החודש, לא שום נתון אחר
 * מהרשומה, ושום דבר לא נשמר.
 */
export async function GET() {
  const session = await getCustomerSession().catch(() => null);
  if (!session) return Response.json({ error: "לא מחובר/ת" }, { status: 401 });
  if (!isSurenseConfigured()) return Response.json({ month: null });
  try {
    const customer = await getCustomer(session.customerId);
    return Response.json({ month: dataValidityMonth(customer) ?? null });
  } catch {
    // ההודעה היא תוספת — כשל כאן לא מפריע להתחברות; פשוט לא מוצג תאריך
    return Response.json({ month: null });
  }
}
