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
} as const;
