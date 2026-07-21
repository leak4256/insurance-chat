/**
 * סקריפט קליטת מסמכים (FR-9, אפיון סעיף 9) — ניתן להרצה חוזרת בכל רענון תוכן.
 * הליבה המשותפת (גם למסך האדמין) ב-src/lib/ingest.ts.
 *
 * שימוש:
 *   npm run ingest              קליטת כל קובצי ה-PDF וה-TXT בתיקיית knowledge/
 *   npm run ingest -- --force   קליטה גם אם בדיקת השפיות נכשלה (לא מומלץ)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { embedder } from "../src/ai/embedder";
import { IngestSanityError, ingestDocument } from "../src/lib/ingest";
import { getSupabase } from "../src/lib/supabase";

const KNOWLEDGE_DIR = path.resolve("knowledge");
const MANIFEST_PATH = path.join(KNOWLEDGE_DIR, "manifest.json");

interface ManifestEntry {
  file: string;
  title?: string;
  domain?: string;
  version?: string;
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

  const files = (await readdir(KNOWLEDGE_DIR)).filter((f) => /\.(pdf|txt)$/i.test(f));
  if (files.length === 0) {
    console.error("לא נמצאו קובצי PDF או TXT בתיקיית knowledge/.");
    process.exit(1);
  }

  const manifest = await loadManifest();
  let totalChunks = 0;
  const skipped: string[] = [];

  console.log(`נמצאו ${files.length} קבצים. מודל embeddings: ${embedder.model} (${embedder.dimensions} ממדים)\n`);

  for (const file of files) {
    const meta = manifest.get(file) ?? { file };
    process.stdout.write(`📄 ${file} … `);
    try {
      const buffer = await readFile(path.join(KNOWLEDGE_DIR, file));
      const result = await ingestDocument(
        file,
        new Uint8Array(buffer),
        { title: meta.title, domain: meta.domain, version: meta.version },
        { force },
      );
      if (result.sanityWarning) console.log(`⚠️  ${result.sanityWarning} — ממשיכים בגלל --force`);
      totalChunks += result.chunks;
      console.log(
        result.pages === null
          ? `✅ קובץ טקסט → ${result.chunks} קטעים (תחום: ${meta.domain ?? "כללי"})`
          : `✅ ${result.pages} עמודים → ${result.chunks} קטעים (תחום: ${meta.domain ?? "כללי"})`,
      );
    } catch (err) {
      if (err instanceof IngestSanityError) {
        console.log(`⚠️  דילוג — ${err.reason} (אפשר לעקוף עם --force)`);
        skipped.push(`${file}: ${err.reason}`);
        continue;
      }
      throw err;
    }
  }

  console.log(`\nסה"כ נטענו ${totalChunks} קטעים.`);
  if (skipped.length > 0) {
    console.log(`\n⚠️  ${skipped.length} קבצים דולגו:`);
    for (const s of skipped) console.log(`   - ${s}`);
  }

  // דגימה ידנית (אפיון סעיף 9): הצגת קטע אקראי לבדיקת עין
  const { data: sample } = await getSupabase()
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
