/**
 * קונפיגורציית שרת מרוכזת. כל ערך רגיש/משתנה-סביבה נקרא כאן בלבד.
 * (ר' אפיון סעיף 5.1 — הפשטת ספק AI דרך env)
 */
export const config = {
  /** מזהה מודל בפורמט "<provider>/<model-id>" — החלפת מודל = שינוי env בלבד */
  chatModel: process.env.CHAT_MODEL ?? "anthropic/claude-haiku-4-5",
  /** מודל לסיכום היסטוריה ארוכה (ברירת מחדל: אותו מודל) */
  summaryModel: process.env.SUMMARY_MODEL ?? process.env.CHAT_MODEL ?? "anthropic/claude-haiku-4-5",
  /** כתובת המייל של הסוכנת רחלי (FR-7). ריק = טרם הוגדר */
  agentEmail: process.env.AGENT_EMAIL ?? "",

  chat: {
    /** אורך הודעת משתמש מקסימלי בתווים (guardrail — מניעת שימוש לרעה) */
    maxMessageChars: Number(process.env.MAX_MESSAGE_CHARS ?? 2000),
    /** חלון הזזה: מספר ההודעות האחרונות שנשלחות למודל כמו שהן */
    historyWindow: Number(process.env.HISTORY_WINDOW ?? 20),
    /** מקסימום הודעות בבקשה אחת (הגנת קלט) */
    maxMessagesPerRequest: 200,
  },

  rag: {
    /** כמה קטעים מאוחזרים לכל חיפוש */
    matchCount: Number(process.env.RAG_MATCH_COUNT ?? 8),
    /** סף דמיון מינימלי (cosine similarity) לקטע רלוונטי */
    minSimilarity: Number(process.env.RAG_MIN_SIMILARITY ?? 0.35),
  },

  rateLimit: {
    /** חלון זמן במילישניות */
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 5 * 60_000),
    /** מספר הודעות מקסימלי בחלון */
    max: Number(process.env.RATE_LIMIT_MAX ?? 20),
  },

  /** הזדהות לקוחות (אפיון סעיף 6.1) */
  auth: {
    /** סוד לחתימת cookies (session + OTP). חובה בשלב 2 */
    sessionSecret: process.env.SESSION_SECRET ?? "",
    /** תוקף session — פקיעה אחרי 30 דקות חוסר פעילות */
    sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 30 * 60_000),
    /** תוקף קוד OTP — 10 דקות */
    otpTtlMs: Number(process.env.OTP_TTL_MS ?? 10 * 60_000),
    /** מספר ניסיונות מקסימלי לקוד */
    otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
    /** השהיה בין שליחות חוזרות של קוד (שניות) */
    otpResendCooldownSec: Number(process.env.OTP_RESEND_COOLDOWN_SEC ?? 60),
    /** הגבלת קצב ייעודית למסלולי ההזדהות: ניסיונות לכל IP בחלון */
    rateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 8),
    rateLimitWindowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60_000),
  },

  /** שליחת אימייל OTP דרך Resend (אפיון סעיף 5) */
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? "",
    /** כתובת השולח. לבדיקות אפשר onboarding@resend.dev */
    from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
  },

  /**
   * אינטגרציית Surense דרך Make.com (רוויזיה 20.07.2026 — ר' src/lib/surense.ts).
   * אין גישה ישירה ל-API; תרחיש Make עם Custom Webhook משמש מתווך.
   */
  surense: {
    /** כתובת ה-Custom Webhook של תרחיש ה-Make (https://hook.eu?.make.com/...) */
    makeWebhookUrl: process.env.MAKE_WEBHOOK_URL ?? "",
    /** ה-API Key שהוגדר על ה-webhook ב-Make (נשלח בכותרת x-make-apikey) */
    makeWebhookSecret: process.env.MAKE_WEBHOOK_SECRET ?? "",
    /** תקרת המתנה לתשובת התרחיש (Make עשוי להיות איטי מ-API ישיר) */
    timeoutMs: Number(process.env.MAKE_TIMEOUT_MS ?? 30_000),
    /**
     * גיל מקסימלי (בימים) של דוח קיים שעדיין נחשב טרי. מעבר לכך מופק דוח חדש
     * במקום למחזר — כדי לא להציג ללקוח נתוני מסלקה מיושנים.
     */
    reportMaxAgeDays: Number(process.env.SURENSE_REPORT_MAX_AGE_DAYS ?? 30),
    /** תקרת אורך לטקסט שחולץ מהדוח לפני שהוא נכנס להקשר המודל */
    reportMaxChars: Number(process.env.SURENSE_REPORT_MAX_CHARS ?? 40_000),
    /** תוקף המטמון בזיכרון לתוכן דוח (הפקה+הורדה+פענוח יקרים) */
    reportCacheTtlMs: Number(process.env.SURENSE_REPORT_CACHE_TTL_MS ?? 15 * 60_000),
  },

  /** כתובת האפליקציה */
  appUrl: process.env.APP_URL ?? "http://localhost:3000",

  /** מסך הסוכן (העלאת PDF + חיבור Surense) */
  admin: {
    password: process.env.ADMIN_PASSWORD ?? "",
    /** תוקף session של הסוכן */
    sessionTtlMs: Number(process.env.ADMIN_SESSION_TTL_MS ?? 2 * 60 * 60_000),
    /** שם ה-bucket ב-Supabase Storage לקובצי הידע */
    storageBucket: process.env.KNOWLEDGE_BUCKET ?? "knowledge",
  },
} as const;
