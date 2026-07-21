/**
 * לוג ביקורת של אירועי התחברות (אפיון סעיף 6.2).
 * ללא נתונים אישיים: רק סוג אירוע, UUID של הלקוח ב-Surense (פסבדונים) וזמן.
 * לעולם לא ת"ז, אימייל או שם.
 */
export type AuditEvent =
  | "login_started"
  | "login_customer_not_found"
  | "otp_sent"
  | "otp_resent"
  | "otp_verified"
  | "otp_failed"
  | "otp_locked"
  | "logout"
  | "admin_login"
  | "admin_login_failed";

export function audit(event: AuditEvent, customerId?: string): void {
  console.log(JSON.stringify({ audit: event, customerId: customerId || undefined, at: new Date().toISOString() }));
}
