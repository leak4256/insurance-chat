/**
 * הערכת RAG דו-שכבתית (אפיון סעיף 10) — סקריפט מקומי, ללא שירות בתשלום.
 *
 * שימוש: npm run eval
 *
 * שכבה 1 — אחזור: recall@5 — האם הקטע מהמסמך הנכון מופיע ב-top-5?
 * שכבה 2 — תשובות: LLM-כשופט (Sonnet) מדרג נאמנות להקשר ונכונות מול תשובת הזהב.
 * שאלות מלכודת (trap): התשובה הנכונה היא "אין לי מידע" — כל תשובה עניינית = כישלון.
 *
 * ספי מעבר: recall@5 ≥ 90% · נאמנות ≥ 95% · אפס תשובות מומצאות במלכודות.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { generateText, stepCountIs } from "ai";
import { getChatModel, resolveModel } from "../../src/ai/provider";
import { buildSystemPrompt } from "../../src/ai/system-prompt";
import { buildTools } from "../../src/ai/tools";
import { searchKnowledge } from "../../src/ai/retrieval";

const GOLDEN_PATH = path.resolve("scripts/eval/golden-set.jsonl");
const EXAMPLE_PATH = path.resolve("scripts/eval/golden-set.example.jsonl");
const RESULTS_DIR = path.resolve("scripts/eval/results");

const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "anthropic/claude-sonnet-4-5";
const RECALL_K = 5;

// ספי מעבר (אפיון סעיף 10)
const THRESHOLDS = { recall: 0.9, faithfulness: 0.95, trapFailures: 0 };

interface GoldenItem {
  id: string;
  question: string;
  expected_answer: string;
  /** שם קובץ ה-PDF שממנו התשובה (לא נדרש במלכודות) */
  expected_file?: string;
  expected_page?: number;
  /** שאלת מלכודת: התשובה הנכונה היא "אין לי מידע על זה" */
  trap?: boolean;
}

interface ItemResult {
  id: string;
  question: string;
  trap: boolean;
  retrievalHit: boolean | null;
  answer: string;
  faithful: boolean | null;
  correct: boolean | null;
  invented: boolean | null;
  judgeReasoning: string;
}

async function loadGoldenSet(): Promise<GoldenItem[]> {
  const p = existsSync(GOLDEN_PATH) ? GOLDEN_PATH : EXAMPLE_PATH;
  if (p === EXAMPLE_PATH) {
    console.warn("⚠️  לא נמצא golden-set.jsonl — משתמשים בקובץ הדוגמה. כתבו את הסט האמיתי עם הסוכן.\n");
  }
  const lines = (await readFile(p, "utf8")).split("\n").filter((l) => l.trim());
  return lines.map((l) => JSON.parse(l) as GoldenItem);
}

async function generateAnswer(question: string): Promise<string> {
  const { text } = await generateText({
    model: getChatModel(),
    system: buildSystemPrompt(),
    prompt: question,
    tools: buildTools(),
    stopWhen: stepCountIs(5),
  });
  return text;
}

interface JudgeVerdict {
  faithful: boolean;
  correct: boolean;
  invented: boolean;
  reasoning: string;
}

async function judge(item: GoldenItem, answer: string): Promise<JudgeVerdict> {
  const prompt = item.trap
    ? `זוהי שאלת מלכודת: אין במאגר הידע מידע לענות עליה. תשובה נכונה = העוזר אומר שאינו יודע / אין לו מידע, ואולי מפנה לסוכנת.

שאלה: ${item.question}
תשובת העוזר: ${answer}

האם העוזר המציא תשובה עניינית (invented=true) או הודה שאינו יודע (invented=false)?`
    : `הערך את תשובת עוזר הביטוח מול תשובת הזהב.

שאלה: ${item.question}
תשובת הזהב: ${item.expected_answer}
תשובת העוזר: ${answer}

- faithful: האם כל העובדות בתשובת העוזר נתמכות בתשובת הזהב או עקביות איתה (ללא עובדות שנוגדות אותה או מומצאות)?
- correct: האם התשובה עונה נכון על השאלה בהשוואה לתשובת הזהב?`;

  const { text } = await generateText({
    model: resolveModel(JUDGE_MODEL),
    system:
      'אתם שופט קפדן של איכות תשובות. השיבו JSON בלבד, בפורמט: {"faithful": boolean, "correct": boolean, "invented": boolean, "reasoning": "משפט קצר בעברית"}. במלכודות faithful/correct = !invented.',
    prompt,
  });

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`judge returned non-JSON: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as Partial<JudgeVerdict>;
  return {
    faithful: Boolean(parsed.faithful),
    correct: Boolean(parsed.correct),
    invented: Boolean(parsed.invented),
    reasoning: parsed.reasoning ?? "",
  };
}

async function main() {
  const items = await loadGoldenSet();
  console.log(`מריצים הערכה על ${items.length} שאלות (שופט: ${JUDGE_MODEL})\n`);

  const results: ItemResult[] = [];

  for (const item of items) {
    process.stdout.write(`• ${item.id}: ${item.question.slice(0, 60)} … `);

    // שכבה 1: אחזור
    let retrievalHit: boolean | null = null;
    if (!item.trap && item.expected_file) {
      const chunks = await searchKnowledge(item.question, { matchCount: RECALL_K });
      retrievalHit = chunks.some(
        (c) =>
          c.file_name === item.expected_file &&
          (item.expected_page == null || (c.page != null && Math.abs(c.page - item.expected_page) <= 1)),
      );
    }

    // שכבה 2: תשובה + שופט
    const answer = await generateAnswer(item.question);
    const verdict = await judge(item, answer);

    results.push({
      id: item.id,
      question: item.question,
      trap: Boolean(item.trap),
      retrievalHit,
      answer,
      faithful: item.trap ? null : verdict.faithful,
      correct: item.trap ? null : verdict.correct,
      invented: item.trap ? verdict.invented : null,
      judgeReasoning: verdict.reasoning,
    });

    const marks = [
      retrievalHit == null ? "" : retrievalHit ? "אחזור✓" : "אחזור✗",
      item.trap ? (verdict.invented ? "מלכודת✗" : "מלכודת✓") : verdict.correct ? "נכונות✓" : "נכונות✗",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(marks);
  }

  // סיכום
  const retrievalChecked = results.filter((r) => r.retrievalHit != null);
  const recall = retrievalChecked.length
    ? retrievalChecked.filter((r) => r.retrievalHit).length / retrievalChecked.length
    : null;

  const judged = results.filter((r) => !r.trap);
  const faithfulness = judged.length ? judged.filter((r) => r.faithful).length / judged.length : null;
  const correctness = judged.length ? judged.filter((r) => r.correct).length / judged.length : null;
  const trapFailures = results.filter((r) => r.trap && r.invented).length;

  const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
  console.log("\n===== סיכום =====");
  console.log(`recall@${RECALL_K}:  ${pct(recall)}  (סף: ≥${THRESHOLDS.recall * 100}%)`);
  console.log(`נאמנות:      ${pct(faithfulness)}  (סף: ≥${THRESHOLDS.faithfulness * 100}%)`);
  console.log(`נכונות:      ${pct(correctness)}`);
  console.log(`מלכודות שנכשלו: ${trapFailures}  (סף: 0)`);

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(
    outPath,
    JSON.stringify({ summary: { recall, faithfulness, correctness, trapFailures }, results }, null, 2),
    "utf8",
  );
  console.log(`\nתוצאות מלאות: ${outPath}`);

  const failed =
    (recall != null && recall < THRESHOLDS.recall) ||
    (faithfulness != null && faithfulness < THRESHOLDS.faithfulness) ||
    trapFailures > THRESHOLDS.trapFailures;

  if (failed) {
    console.error("\n❌ ההערכה מתחת לספי המעבר.");
    process.exit(1);
  }
  console.log("\n✅ כל הספים עברו.");
}

main().catch((err) => {
  console.error("\n❌ ההערכה נכשלה:", err.message ?? err);
  process.exit(1);
});
