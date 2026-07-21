import { config } from "./config";

/**
 * שליחת אימייל OTP דרך Resend (אפיון סעיף 5) — קריאת REST ישירה, בלי SDK.
 *
 * בפיתוח בלבד: אם RESEND_API_KEY חסר, הקוד מודפס ללוג השרת כדי לאפשר
 * בדיקת הזרימה מקצה לקצה. בפרודקשן מפתח חסר = שגיאה.
 */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (!config.resend.apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[dev בלבד — RESEND_API_KEY חסר] קוד OTP עבור ${to}: ${code}`);
      return;
    }
    throw new Error("RESEND_API_KEY חסר — לא ניתן לשלוח קוד התחברות");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resend.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.resend.from,
      to: [to],
      subject: `${code} — קוד ההתחברות שלך`,
      html: `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">קוד ההתחברות שלך</h2>
  <p style="margin:0 0 16px;color:#444">להמשך ההתחברות לצ'אט של הסוכנות, הזינו את הקוד:</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;direction:ltr;margin:0 0 16px">${code}</p>
  <p style="margin:0;color:#777;font-size:13px">הקוד תקף ל-10 דקות. אם לא ביקשתם קוד — אפשר להתעלם מהמייל הזה.</p>
</div>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`שליחת המייל נכשלה (${res.status}): ${detail.slice(0, 200)}`);
  }
}
