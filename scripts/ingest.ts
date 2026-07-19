/**
 * סקריפט קליטת PDF (FR-9, אפיון סעיף 9) — ניתן להרצה חוזרת בכל רענון תוכן.
 *
 * שימוש:
 *   npm run ingest              קליטת כל ה-PDF בתיקיית knowledge/
 *   npm run ingest -- --force   קליטה גם אם בדיקת השפיות נכשלה (לא מומלץ)
 *
 * לכל מסמך: פענוח → בדיקת שפיות עברית → חלוקה לקטעים עם metadata →
 * embeddings (Voyage) → החלפה אטומית של קטעי המסמך ב-pgvector.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { embedder } from "../src/ai/embedder";
import { getSupabase } from "../src/lib/supabase";

const KNOWLEDGE_DIR = path.resolve("knowledge");
const MANIFEST_PATH = path.join(KNOWLEDGE_DIR, "manifest.json");

/** יעד גודל קטע בתווים (~500 טוקנים בעברית) וחפיפה בין קטעים */
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 250;

interface ManifestEntry {
  file: string;
  title?: string;
  domain?: string;
  version?: string;
}

interface Chunk {
  content: string;
  page: number;
}

function slugify(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/**
 * בדיקת שפיות לטקסט עברי שחולץ מ-PDF (אפיון סעיף 9):
 * מזהה טקסט הפוך לפי אותיות סופיות (ך ם ן ף ץ) שמופיעות בתחילת מילה במקום בסופה.
 */
function hebrewSanityCheck(text: string): { ok: boolean; reason?: string } {
  const letters = text.replace(/[^א-תa-zA-Z]/g, "");
  if (letters.length < 100) return { ok: false, reason: "כמעט אין טקסט — ייתכן PDF סרוק (נדרש OCR)" };

  const hebrewLetters = text.replace(/[^א-ת]/g, "");
  const hebrewRatio = hebrewLetters.length / letters.length;
  if (hebrewRatio < 0.3) {
    return { ok: false, reason: `רק ${(hebrewRatio * 100).toFixed(0)}% עברית — ייתכן קידוד שבור` };
  }

  const words = text.split(/\s+/).filter((w) => /[א-ת]{2,}/.test(w));
  const finals = "ךםןףץ";
  let startsWithFinal = 0;
  let endsWithFinal = 0;
  for (const word of words) {
    const clean = word.replace(/[^א-ת]/g, "");
    if (clean.length < 2) continue;
    if (finals.includes(clean[0])) startsWithFinal++;
    if (finals.includes(clean[clean.length - 1])) endsWithFinal++;
  }
  // בטקסט תקין אותיות סופיות כמעט לא מופיעות בתחילת מילה
  if (startsWithFinal > endsWithFinal && startsWithFinal > words.length * 0.02) {
    return { ok: false, reason: "זוהה טקסט הפוך (RTL reversed) — אותיות סופיות בתחילת מילים" };
  }
  return { ok: true };
}

/** חלוקה לקטעים בגבולות מילים, עם חפיפה */
function chunkPage(pageText: string, page: number): Chunk[] {
  const text = pageText.replace(/\s+/g, " ").trim();
  if (!text) return [];
  if (text.length <= CHUNK_SIZE) return [{ content: text, page }];

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start + CHUNK_SIZE / 2) end = lastSpace;
    }
    chunks.push({ content: text.slice(start, end).trim(), page });
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

async function loadManifest(): Promise<Map<string, ManifestEntry>> {
  const map = new Map<string, ManifestEntry>();
  if (existsSync(MANIFEST_PATH)) {
    const entries = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as ManifestEntry[];
    for (const entry of entries) map.set(entry.file, entry);
  }
  return map;
}

async function main() {
  const force = process.argv.includes("--force");

  if (!existsSync(KNOWLEDGE_DIR)) {
    console.error(`התיקייה ${KNOWLEDGE_DIR} לא קיימת. צרו אותה והניחו בה את קובצי ה-PDF.`);
    process.exit(1);
  }

  const files = (await readdir(KNOWLEDGE_DIR)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (files.length === 0) {
    console.error("לא נמצאו קובצי PDF בתיקיית knowledge/.");
    process.exit(1);
  }

  const manifest = await loadManifest();
  const supabase = getSupabase();
  let totalChunks = 0;
  const skipped: string[] = [];

  console.log(`נמצאו ${files.length} קובצי PDF. מודל embeddings: ${embedder.model} (${embedder.dimensions} ממדים)\n`);

  for (const file of files) {
    const meta = manifest.get(file) ?? { file };
    const documentId = slugify(file);
    const title = meta.title ?? file.replace(/\.pdf$/i, "");
    process.stdout.write(`📄 ${file} … `);

    const buffer = await readFile(path.join(KNOWLEDGE_DIR, file));
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text: pages } = await extractText(pdf, { mergePages: false });

    const fullText = pages.join("\n");
    const sanity = hebrewSanityCheck(fullText);
    if (!sanity.ok && !force) {
      console.log(`⚠️  דילוג — ${sanity.reason} (אפשר לעקוף עם --force)`);
      skipped.push(`${file}: ${sanity.reason}`);
      continue;
    }
    if (!sanity.ok) console.log(`⚠️  ${sanity.reason} — ממשיכים בגלל --force`);

    const chunks: Chunk[] = pages.flatMap((pageText, i) => chunkPage(pageText, i + 1));
    if (chunks.length === 0) {
      console.log("⚠️  דילוג — לא חולץ טקסט");
      skipped.push(`${file}: לא חולץ טקסט`);
      continue;
    }

    const embeddings = await embedder.embedDocuments(chunks.map((c) => c.content));

    // רענון פר-מסמך: מחיקת הקטעים הישנים של המסמך והטענת החדשים
    const { error: deleteError } = await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", documentId);
    if (deleteError) throw new Error(`delete failed for ${documentId}: ${deleteError.message}`);

    const rows = chunks.map((chunk, i) => ({
      document_id: documentId,
      document_title: title,
      file_name: file,
      page: chunk.page,
      section_title: null,
      domain: meta.domain ?? "כללי",
      version: meta.version ?? "1",
      language: "he",
      content: chunk.content,
      embedding: embeddings[i],
      embedding_model: embedder.model,
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const { error: insertError } = await supabase
        .from("knowledge_chunks")
        .insert(rows.slice(i, i + 100));
      if (insertError) throw new Error(`insert failed for ${documentId}: ${insertError.message}`);
    }

    totalChunks += chunks.length;
    console.log(`✅ ${pages.length} עמודים → ${chunks.length} קטעים (תחום: ${meta.domain ?? "כללי"})`);
  }

  console.log(`\nסה"כ נטענו ${totalChunks} קטעים.`);
  if (skipped.length > 0) {
    console.log(`\n⚠️  ${skipped.length} קבצים דולגו:`);
    for (const s of skipped) console.log(`   - ${s}`);
  }

  // דגימה ידנית (אפיון סעיף 9): הצגת קטע אקראי לבדיקת עין
  const { data: sample } = await supabase
    .from("knowledge_chunks")
    .select("document_title, page, content")
    .limit(1);
  if (sample && sample.length > 0) {
    console.log("\n🔍 דגימה לבדיקה ידנית:");
    console.log(`   מסמך: ${sample[0].document_title}, עמ' ${sample[0].page}`);
    console.log(`   "${String(sample[0].content).slice(0, 300)}…"`);
  }
}

main().catch((err) => {
  console.error("\n❌ הקליטה נכשלה:", err.message ?? err);
  process.exit(1);
});
