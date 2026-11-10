import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { config } from "@/lib/config";

/**
 * הפשטת ספק AI (אפיון 5.1): כל הקוד מבקש מודל דרך הפונקציה הזו בלבד,
 * לפי מזהה בפורמט "<provider>/<model-id>". הוספת ספק = הוספת case כאן.
 */
/**
 * כבר הודענו על המשתנה הזה — אזהרה אחת לכל תהליך, לא אחת לכל בקשה.
 */
const warnedBase = new Set<string>();

/**
 * כתובת הבסיס של ספק, עם תיקון התקלה שהפילה את הרצת ה-eval מ-09.11.2026:
 * `ANTHROPIC_BASE_URL` היה מוגדר כ-`https://api.anthropic.com` בלי `/v1`.
 * ה-SDK מכבד את המשתנה כלשונו, ולכן **כל** בקשה הלכה ל-`/messages` וחזרה
 * 404 "Not Found" — 37 מקרים נפלו בזה, בלי שום רמז שהבעיה היא בכתובת.
 *
 * הנתיב `/v1` הוא חלק מה-API של Anthropic ושל OpenAI, לא העדפה. ולכן אם
 * המשתנה מוגדר בלי הסיומת — משלימים אותה ומזהירים פעם אחת, במקום לשלוח
 * בקשות שאין סיכוי שיענו. (ל-Google מבנה אחר, `/v1beta`, ולכן הוא לא כאן.)
 */
function apiBase(envName: string, fallback: string): string {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  const base = raw.replace(/\/+$/, "");
  if (base.endsWith("/v1")) return base;
  if (!warnedBase.has(envName)) {
    warnedBase.add(envName);
    console.warn(
      `${envName} אינו נגמר ב-"/v1" — משלימים אותו. ` +
        "המשתנה מגיע מהסביבה ולא מהפרויקט (ר' ההסבר למעלה), ולכן אין מה לתקן בקוד הפרויקט.",
    );
  }
  return `${base}/v1`;
}

const providers: Record<string, (modelId: string) => LanguageModel> = {
  anthropic: (modelId) => {
    const anthropic = createAnthropic({
      apiKey: requireEnv("ANTHROPIC_API_KEY"),
      baseURL: apiBase("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"),
    });
    return anthropic(modelId);
  },
  openai: (modelId) => {
    const openai = createOpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
      baseURL: apiBase("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    });
    return openai(modelId);
  },
  google: (modelId) => {
    const google = createGoogleGenerativeAI({ apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY") });
    return google(modelId);
  },
};

/**
 * לקוח הספק נבנה פעם אחת לכל מזהה מודל. בלי המטמון `getChatModel()` היה בונה
 * אובייקט ספק חדש בכל בקשה, ובמסלול החם זה קורה פעמיים (צ'אט וסיכום).
 * אובייקט המודל של ה-AI SDK הוא קונפיגורציה בלבד — אין בו מצב לכל בקשה.
 */
const modelCache = new Map<string, LanguageModel>();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function resolveModel(spec: string): LanguageModel {
  const cached = modelCache.get(spec);
  if (cached) return cached;

  const slash = spec.indexOf("/");
  if (slash === -1) {
    throw new Error(`CHAT_MODEL must be "<provider>/<model-id>", got: ${spec}`);
  }
  const provider = spec.slice(0, slash);
  const modelId = spec.slice(slash + 1);
  const factory = providers[provider];
  if (!factory) {
    throw new Error(`Unknown AI provider "${provider}". Supported: ${Object.keys(providers).join(", ")}`);
  }
  const model = factory(modelId);
  modelCache.set(spec, model);
  return model;
}

export const getChatModel = () => resolveModel(config.chatModel);
export const getSummaryModel = () => resolveModel(config.summaryModel);
