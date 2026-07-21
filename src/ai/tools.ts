import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getCustomer, summarizeHoldings } from "@/lib/surense";
import type { CustomerSession } from "@/lib/session";
import { searchKnowledge, INSURANCE_DOMAINS } from "./retrieval";

/**
 * רישום הכלים למודל, לפי מצב ההזדהות (אפיון 6.2):
 * - תמיד: search_knowledge.
 * - לא מזוהה: request_login — כלי צד-לקוח שמציג את כרטיס ההתחברות בצ'אט (FR-3).
 * - מזוהה בלבד: get_customer_data — ללא פרמטר מזהה; ה-UUID מוזרק מה-session
 *   המאומת בצד השרת. המודל פיזית לא יכול לבקש נתונים של לקוח אחר.
 */
export function buildTools(session: CustomerSession | null): ToolSet {
  const authTools: ToolSet = session
    ? {
        get_customer_data: tool({
          description:
            "שליפת הנתונים האישיים של הלקוח המחובר מ-Surense: שם ומייל, ותמצית האחזקות שלו — אילו כיסויים ביטוחיים יש לו (חיים, בריאות, סיעודי, מחלות קשות ועוד) עם פרמיות, וצבירות (פנסיה, השתלמות, גמל) וקצבה חזויה. השתמשו בכלי הזה לכל שאלה על המצב האישי של הלקוח (מה יש לי, הכיסוי שלי, הפנסיה שלי וכד').",
          inputSchema: z.object({}),
          execute: async () => {
            try {
              const customer = await getCustomer(session.customerId);
              // צמצום שדות: לא מזרימים למודל את כל 60+ השדות של Surense —
              // רק זהות בסיסית + תמצית האחזקות (כיסויים/צבירות) מ-tromStats
              return {
                found: true as const,
                customer: {
                  name: customer.fullName,
                  email: customer.email,
                },
                holdings:
                  summarizeHoldings(customer) ??
                  "תמצית האחזקות אינה זמינה כרגע — ציינו זאת ללקוח והציעו לנסות שוב מאוחר יותר.",
              };
            } catch (err) {
              console.error("get_customer_data failed:", err instanceof Error ? err.message : err);
              return {
                found: false as const,
                message:
                  "שליפת הנתונים האישיים נכשלה כרגע. התנצלו בפני הלקוח והציעו לנסות שוב בעוד רגע.",
              };
            }
          },
        }),
      }
    : {
        request_login: tool({
          // כלי צד-לקוח (ללא execute): הקריאה מוזרמת לדפדפן, שמציג את כרטיס ההתחברות
          description:
            "הצגת כרטיס התחברות בתוך הצ'אט. קראו לכלי הזה בכל פעם שלקוח לא מזוהה שואל שאלה אישית (הפוליסות שלי, הכיסוי שלי, החשבון שלי) או מבקש להתחבר — יחד עם משפט קצר שמסביר שנדרשת הזדהות.",
          inputSchema: z.object({}),
        }),
      };

  return {
    ...authTools,
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
