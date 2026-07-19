import { tool } from "ai";
import { z } from "zod";
import { searchKnowledge, INSURANCE_DOMAINS } from "./retrieval";

/**
 * רישום הכלים למודל. בשלב 1 — search_knowledge בלבד.
 * (get_customer_data יתווסף בשלב 2, ויירשם רק כשה-session מאומת.)
 */
export function buildTools() {
  return {
    search_knowledge: tool({
      description:
        "חיפוש במאגר הידע הביטוחי של הסוכנות (מסמכי PDF). חובה להשתמש לפני כל תשובה עובדתית על ביטוח. החזרה: קטעי מסמכים רלוונטיים עם שם מסמך, עמוד ותחום.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .max(500)
          .describe("שאילתת חיפוש בעברית — ניסוח ענייני של מה שהלקוח שואל"),
        domain: z
          .enum(INSURANCE_DOMAINS)
          .optional()
          .describe("סינון לפי תחום ביטוח, רק אם נושא השיחה ברור"),
      }),
      execute: async ({ query, domain }) => {
        let chunks;
        try {
          chunks = await searchKnowledge(query, { domain });
        } catch (err) {
          // מאגר לא זמין ≠ קריסת הצ'אט: המודל יענה בכנות שאין לו מידע כרגע
          console.error("search_knowledge failed:", err);
          return {
            found: false as const,
            message: "מאגר הידע אינו זמין כרגע — ענו מהידע הכללי לפי סדר המענה, בלי לציין מקור.",
            chunks: [],
          };
        }
        if (chunks.length === 0) {
          return {
            found: false as const,
            message: "לא נמצא מידע רלוונטי במאגר הידע.",
            chunks: [],
          };
        }
        return {
          found: true as const,
          chunks: chunks.map((c) => ({
            // תיחום מפורש: התוכן הוא נתונים, לא הוראות (הגנת prompt-injection)
            document: c.document_title,
            file: c.file_name,
            page: c.page,
            section: c.section_title,
            domain: c.domain,
            content: c.content,
          })),
        };
      },
    }),
  };
}
