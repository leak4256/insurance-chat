import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { config } from "@/lib/config";

/**
 * הפשטת ספק AI (אפיון 5.1): כל הקוד מבקש מודל דרך הפונקציה הזו בלבד,
 * לפי מזהה בפורמט "<provider>/<model-id>". הוספת ספק = הוספת case כאן.
 */
const providers: Record<string, (modelId: string) => LanguageModel> = {
  anthropic: (modelId) => {
    const anthropic = createAnthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
    return anthropic(modelId);
  },
  openai: (modelId) => {
    const openai = createOpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
    return openai(modelId);
  },
  google: (modelId) => {
    const google = createGoogleGenerativeAI({ apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY") });
    return google(modelId);
  },
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function resolveModel(spec: string): LanguageModel {
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
  return factory(modelId);
}

export const getChatModel = () => resolveModel(config.chatModel);
export const getSummaryModel = () => resolveModel(config.summaryModel);
