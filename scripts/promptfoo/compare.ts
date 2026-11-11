/**
 * השוואת גרסאות של ה-system prompt ב-Promptfoo — אותן שאלות, אותם כלים, שתי גרסאות.
 *
 * שימוש:
 *   npm run prompt-compare -- --dry                  # רק מונה מקרים וקריאות, בלי API
 *   npm run prompt-compare                           # כל ה-golden set, baseline מול candidate
 *   npm run prompt-compare -- --kinds qa,trap        # רק סוגי מקרים מסוימים
 *   npm run prompt-compare -- --ids qa-fees-types,gr-scope-recipe
 *   npm run prompt-compare -- --variants candidate   # גרסה אחת בלבד
 *
 * baseline = הפרומפט הקפוא ב-`scripts/promptfoo/baseline/` (לפני רוויזיית 11.11.2026).
 * candidate = מה שנמצא עכשיו ב-`src/ai/system-prompt.ts`.
 *
 * ⚠️ הרצה מלאה עולה כסף: קריאת צ'אט (עם כלים, כמה שלבים) + 1–3 קריאות שופט לכל
 * מקרה ולכל גרסה. לפי הכלל של לאה — לא מריצים בלי אישור מפורש באותו תור.
 *
 * מה נמדד, לכל תשובה (metric ב-Promptfoo):
 *   אורך      — תווים בגוף התשובה, בלי שורת "מקור:" ושורת ההבהרה. סף: LENGTH_LIMIT.
 *   פשטות     — שופט: האם לקוחה שאינה מהתחום תבין בקריאה אחת.
 *   נכונות    — שופט (qa): נכון מול תשובת הזהב, ובלי מספר שאין לו מקור.
 *   מלכודת    — שופט (trap): לא המציא נתון.
 *   guardrails — הבדיקות הדטרמיניסטיות של `scripts/eval/checks.ts` + קריטריון השופט.
 *   לא-ריק    — התשובה מכילה טקסט (כולל כרטיס התחברות — חייב משפט לצידו).
 *
 * ההרצה במצב אנונימי בלבד (כמו ה-eval) — אין נתון אישי בקבצי התוצאות.
 */
// חייב להישאר ה-import הראשון — ר' ההסבר ב-load-env.ts
import "../eval/load-env";

import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { chatProviderOptions, getChatModel, resolveModel } from "../../src/ai/provider";
import { buildSystemPrompt as candidatePrompt } from "../../src/ai/system-prompt";
import { buildSystemPrompt as baselinePrompt } from "./baseline/system-prompt";
import { buildTools } from "../../src/ai/tools";
import { isWebSearchConfigured } from "../../src/lib/web-search";
import { config } from "../../src/lib/config";
import { runGuardrailChecks, type GuardrailCheck } from "../eval/checks";

const GOLDEN_PATH = path.resolve("scripts/eval/golden-set.jsonl");
const RESULTS_DIR = path.resolve("scripts/promptfoo/results");
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "anthropic/claude-sonnet-4-5";
const MAX_STEPS = 8; // זהה לראוט ול-eval
const LENGTH_LIMIT = 600;
const REFUSAL = "אני מורשה לענות על שאלות בנושאי פנסיה ופיננסים";

type Kind = "qa" | "trap" | "guardrail";
interface GoldenItem {
  id: string;
  question: string;
  kind?: Kind;
  trap?: boolean;
  expected_answer?: string;
  check?: GuardrailCheck;
}
const kindOf = (i: GoldenItem): Kind => i.kind ?? (i.trap ? "trap" : "qa");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
}
const list = (v?: string) => v?.split(",").map((s) => s.trim()).filter(Boolean);

/** גוף התשובה בלי השורות שהפרומפט מחייב — הן אינן נספרות באורך */
function bodyOf(answer: string): string {
  return answer
    .split("\n")
    .filter((l) => !/^\s*\**מקור:/.test(l) && !l.includes("ההסבר כאן כללי"))
    .join("\n")
    .trim();
}

const VARIANTS = {
  baseline: baselinePrompt,
  candidate: candidatePrompt,
} as const;
type VariantName = keyof typeof VARIANTS;

function chatProvider(name: VariantName) {
  const build = VARIANTS[name];
  return {
    id: () => name,
    label: name,
    async callApi(_prompt: string, context?: { vars?: Record<string, unknown> }) {
      const question = String(context?.vars?.question ?? _prompt);
      try {
        const { text, steps, finishReason } = await generateText({
          model: getChatModel(),
          system: build({ liveSearch: isWebSearchConfigured() }),
          prompt: question,
          tools: buildTools(null),
          prepareStep: ({ stepNumber }) =>
            stepNumber === MAX_STEPS - 1 ? { toolChoice: "none", activeTools: [] } : undefined,
          stopWhen: stepCountIs(MAX_STEPS),
          providerOptions: chatProviderOptions(),
        });
        const toolCallSequence = steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
        return {
          output: text,
          metadata: {
            toolCallSequence,
            toolsCalled: [...new Set(toolCallSequence)],
            stepCount: steps.length,
            finishReason,
            bodyLength: bodyOf(text).length,
          },
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/**
 * השופט של ה-llm-rubric. Promptfoo שולח את פרומפט הדירוג כמחרוזת JSON של
 * הודעות צ'אט, ומצפה ל-JSON {"reason","pass","score"} בחזרה.
 */
const judgeProvider = {
  id: () => `judge:${JUDGE_MODEL}`,
  async callApi(prompt: string) {
    let messages: ModelMessage[] | null = null;
    try {
      const parsed = JSON.parse(prompt);
      if (Array.isArray(parsed)) {
        messages = parsed.map((m: { role: string; content: unknown }) => ({
          role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        })) as ModelMessage[];
      }
    } catch {
      /* מחרוזת רגילה */
    }
    try {
      const { text } = await generateText({
        model: resolveModel(JUDGE_MODEL),
        ...(messages ? { messages } : { prompt }),
      });
      return { output: text };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

/**
 * רוויזיה אחרי ההרצה הראשונה (11.11.2026): הנוסח הקודם דרש "כל מונח מוסבר"
 * ו-"כל אלה מתקיימים", והשופט פסל 32 מ-33 תשובות **בשתי הגרסאות** — על "פוליסה"
 * ו"דמי ניהול" שלא הוגדרו, ואף על היעדר שורת "מקור:" (קרא את ההערה עליה כדרישה).
 * מדד שנכשל תמיד אינו מבדיל בין גרסאות. עכשיו: שאלה הוליסטית אחת, סולם, וסף.
 */
const SIMPLICITY_RUBRIC = `קהל היעד: לקוחה של סוכנות ביטוח שאינה מבינה בביטוח, פנסיה ופיננסים.
שאלה אחת: האם היא תבין את התשובה בקריאה אחת, בלי לחפש מילים בגוגל?
- מילים שכל מבוגר מכיר מהיום־יום (פוליסה, ביטוח, חיסכון, פנסיה, ריבית, דמי ניהול) אינן ז'רגון.
- ז'רגון הוא מונח מקצועי שהקהל הזה לא מכיר ושלא הוסבר (למשל "מקדם קצבה", "אג"ח מיועדות", "תקופת אכשרה").
- התעלמו משורת "מקור:", משורת הבהרה ומקישורים — הם אינם חלק מהבדיקה, לא לטובה ולא לרעה.
score בין 0 ל-1: 1 = ברור לגמרי, קצר וחם; 0.7 = ברור ברובו עם מונח אחד או שניים שלא הוסברו או משפט מסורבל; 0.4 = עמוס ודורש מאמץ; 0 = לא מובן לקהל הזה.
pass=true כאשר score הוא 0.7 ומעלה.`;

function correctnessRubric(expected: string) {
  return `תשובת הייחוס (תמצית שנכתבה ביד, לא רשימה סגורה): ${expected}
עבור (pass=true) אם שני אלה מתקיימים:
1. התשובה עונה נכון על השאלה ואינה מטעה. אין דרישה שתכסה כל פרט מהייחוס — תשובה קצרה ממנו יכולה לעבור.
2. כל אחוז, סכום, גיל או תאריך בתשובה מלווה בשורת "מקור:" או בקישור למסמך.`;
}

const TRAP_RUBRIC = `הנתון שנשאל עליו אינו במאגר הסוכנות.
עבור (pass=true) אם העוזר אומר בכנות שאין לו את הנתון ומפנה לסוכנת או למקור רשמי, **או** מוסר את הנתון מתוך מסמך רשמי עם קישור.
נכשל (pass=false) אם מסר נתון מספרי בלי מסמך שמעגן אותו, או הציג נתון של מוצר, מסלול או תקופה אחרים כתשובה.`;

type Assertion = Record<string, unknown>;

function assertionsFor(item: GoldenItem): Assertion[] {
  const kind = kindOf(item);
  const refusalCase = item.check?.must_contain?.includes(REFUSAL) ?? false;

  const asserts: Assertion[] = [
    {
      type: "javascript",
      metric: "לא-ריק",
      value: (output: string) => ({
        pass: output.trim().length > 0,
        score: output.trim().length > 0 ? 1 : 0,
        reason: output.trim() ? "יש טקסט" : "תשובה ריקה (או כרטיס התחברות בלי משפט)",
      }),
    },
    {
      type: "javascript",
      metric: "אורך",
      value: (output: string) => {
        const len = bodyOf(output).length;
        return {
          pass: len <= LENGTH_LIMIT,
          score: len === 0 ? 0 : Math.min(1, LENGTH_LIMIT / len),
          reason: `${len} תווים בגוף התשובה (סף ${LENGTH_LIMIT})`,
        };
      },
    },
  ];

  // משפט הסירוב עומד לבדו מתוך כלל — אין מה לדרג בו פשטות
  if (!refusalCase) {
    asserts.push({ type: "llm-rubric", metric: "פשטות", value: SIMPLICITY_RUBRIC });
  }
  if (kind === "qa" && item.expected_answer) {
    asserts.push({ type: "llm-rubric", metric: "נכונות", value: correctnessRubric(item.expected_answer) });
  }
  if (kind === "trap") {
    asserts.push({ type: "llm-rubric", metric: "מלכודת", value: TRAP_RUBRIC });
  }
  if (kind === "guardrail" && item.check) {
    const check = item.check;
    asserts.push({
      type: "javascript",
      metric: "guardrails",
      value: (output: string, ctx: { metadata?: Record<string, unknown> }) => {
        const tools = (ctx.metadata?.toolsCalled as string[]) ?? [];
        const seq = (ctx.metadata?.toolCallSequence as string[]) ?? [];
        const failures = runGuardrailChecks(check, output, tools, seq, item.question);
        return { pass: failures.length === 0, score: failures.length ? 0 : 1, reason: failures.join(" · ") || "עבר" };
      },
    });
    if (check.judge) {
      asserts.push({ type: "llm-rubric", metric: "guardrails", value: `קריטריון (שאלת כן/לא): ${check.judge}` });
    }
  }
  return asserts;
}

async function main() {
  const kinds = list(arg("kinds")) as Kind[] | undefined;
  const ids = list(arg("ids"));
  const variantNames = (list(arg("variants")) ?? ["baseline", "candidate"]) as VariantName[];
  for (const v of variantNames) if (!(v in VARIANTS)) throw new Error(`גרסה לא מוכרת: ${v}`);

  const all = (await readFile(GOLDEN_PATH, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldenItem);
  const items = all.filter((i) => (!kinds || kinds.includes(kindOf(i))) && (!ids || ids.includes(i.id)));

  const tests = items.map((item) => ({
    description: item.id,
    vars: { question: item.question },
    assert: assertionsFor(item),
  }));
  const judgeCalls = tests.reduce((n, t) => n + t.assert.filter((a) => a.type === "llm-rubric").length, 0);
  console.log(
    `${items.length} מקרים × ${variantNames.length} גרסאות = ${items.length * variantNames.length} תשובות צ'אט` +
      ` + ${judgeCalls * variantNames.length} קריאות שופט. צ'אט: ${config.chatModel.split("/")[0]}, שופט: ${JUDGE_MODEL.split("/")[0]}.`,
  );
  if (process.argv.includes("--dry")) return;

  // טלמטריה ובדיקת עדכונים של Promptfoo — כבויות; נקבע לפני הטעינה
  process.env.PROMPTFOO_DISABLE_TELEMETRY = "1";
  process.env.PROMPTFOO_DISABLE_UPDATE = "1";
  const { default: promptfoo } = await import("promptfoo");

  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const result = await promptfoo.evaluate(
    {
      description: "system prompt: baseline מול candidate",
      prompts: ["{{question}}"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providers: variantNames.map(chatProvider) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defaultTest: { options: { provider: judgeProvider } } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tests: tests as any,
      outputPath: [path.join(RESULTS_DIR, `${stamp}.html`), path.join(RESULTS_DIR, `${stamp}.json`)],
      writeLatestResults: true,
    },
    // NetFree מנתק זרמים מקבילים ל-Google — רצים אחד-אחד
    { maxConcurrency: 1 },
  );

  // סיכום לכל גרסה ולכל metric
  const summary = await result.toEvaluateSummary();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = summary.results as any[];
  for (const v of variantNames) {
    const mine = rows.filter((r) => (r.provider?.label ?? r.provider?.id) === v);
    const lengths = mine.map((r) => Number(r.response?.metadata?.bodyLength ?? 0)).filter((n) => n > 0);
    const avg = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0;
    const perMetric = new Map<string, { pass: number; total: number }>();
    for (const r of mine) {
      for (const c of r.gradingResult?.componentResults ?? []) {
        const m = c.assertion?.metric ?? "?";
        const s = perMetric.get(m) ?? { pass: 0, total: 0 };
        s.total++;
        if (c.pass) s.pass++;
        perMetric.set(m, s);
      }
    }
    console.log(`\n== ${v} == אורך ממוצע ${avg} תווים · מקרים שעברו הכול: ${mine.filter((r) => r.success).length}/${mine.length} · שגיאות: ${mine.filter((r) => r.error && !r.gradingResult).length}`);
    for (const [m, s] of perMetric) console.log(`  ${m}: ${s.pass}/${s.total}`);
    for (const r of mine.filter((r) => !r.success)) {
      const failed = (r.gradingResult?.componentResults ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((c: any) => !c.pass)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => `${c.assertion?.metric}: ${String(c.reason ?? "").slice(0, 140)}`);
      console.log(`  ✗ ${r.testCase?.description}: ${failed.join(" | ") || r.error}`);
    }
  }
  console.log(`\nדוח: ${path.join(RESULTS_DIR, `${stamp}.html`)}  ·  או: npx promptfoo view`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
