import { extractText, getDocumentProxy } from "unpdf";
import { embedder } from "../ai/embedder";
import { getSupabase } from "./supabase";

/**
 * ליבת קליטת מסמכים (FR-9, אפיון סעיף 9) — משותפת לסקריפט ה-CLI
 * (scripts/ingest.ts) ולמסך העלאת ה-PDF של הסוכן (שלב 2).
 *
 * לכל מסמך: פענוח → בדיקת שפיות עברית → חלוקה לקטעים עם metadata →
 * embeddings → החלפה אטומית של קטעי המסמך ב-pgvector + רישום בטבלת המסמכים.
 *
 * הייבוא כאן יחסי (לא @/) כדי שהסקריפטים ירוצו עם tsx בלי resolver של paths.
 */

/** יעד גודל קטע בתווים (~500 טוקנים בעברית) וחפיפה בין קטעים */
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 250;

export interface IngestMeta {
  title?: string;
  domain?: string;
  version?: string;
  /** נתיב הקובץ ב-Supabase Storage (העלאה מהמסך); null בקליטת CLI מקומית */
  storagePath?: string | null;
}

export interface IngestResult {
  documentId: string;
  title: string;
  /** מספר עמודים; null בקובצי טקסט */
  pages: number | null;
  chunks: number;
  /** אזהרת שפיות כשהקליטה נכפתה עם force */
  sanityWarning?: string;
}

export class IngestSanityError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export function slugify(fileName: string): string {
  return fileName
    .replace(/\.(pdf|txt)$/i, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/**
 * בדיקת שפיות לטקסט עברי שחולץ מ-PDF (אפיון סעיף 9):
 * מזהה טקסט הפוך לפי אותיות סופיות (ך ם ן ף ץ) שמופיעות בתחילת מילה במקום בסופה.
 */
export function hebrewSanityCheck(text: string): { ok: boolean; reason?: string } {
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

interface Chunk {
  content: string;
  page: number | null;
}

/** חלוקה לקטעים בגבולות מילים, עם חפיפה */
function chunkPage(pageText: string, page: number | null): Chunk[] {
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

/** קליטת מסמך יחיד (PDF או TXT) מתוך buffer. זורק IngestSanityError כשבדיקת השפיות נכשלת ללא force. */
export async function ingestDocument(
  fileName: string,
  buffer: Uint8Array,
  meta: IngestMeta = {},
  options: { force?: boolean } = {},
): Promise<IngestResult> {
  const documentId = slugify(fileName);
  const title = meta.title?.trim() || fileName.replace(/\.(pdf|txt)$/i, "");
  const isTxt = /\.txt$/i.test(fileName);

  let pages: string[];
  let pageNumbers: (number | null)[];
  if (isTxt) {
    pages = [Buffer.from(buffer).toString("utf8")];
    pageNumbers = [null];
  } else {
    const pdf = await getDocumentProxy(buffer);
    ({ text: pages } = await extractText(pdf, { mergePages: false }));
    pageNumbers = pages.map((_, i) => i + 1);
  }

  const sanity = hebrewSanityCheck(pages.join("\n"));
  if (!sanity.ok && !options.force) throw new IngestSanityError(sanity.reason ?? "בדיקת השפיות נכשלה");

  const chunks = pages.flatMap((pageText, i) => chunkPage(pageText, pageNumbers[i]));
  if (chunks.length === 0) throw new IngestSanityError("לא חולץ טקסט מהמסמך");

  const embeddings = await embedder.embedDocuments(chunks.map((c) => c.content));
  const supabase = getSupabase();

  // רענון פר-מסמך: מחיקת הקטעים הישנים של המסמך והטענת החדשים
  const { error: deleteError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("document_id", documentId);
  if (deleteError) throw new Error(`delete failed for ${documentId}: ${deleteError.message}`);

  const rows = chunks.map((chunk, i) => ({
    document_id: documentId,
    document_title: title,
    file_name: fileName,
    page: chunk.page,
    section_title: null,
    domain: meta.domain?.trim() || "כללי",
    version: meta.version?.trim() || "1",
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

  // רישום בטבלת המסמכים (מזין את הרשימה במסך האדמין)
  const { error: docError } = await supabase.from("knowledge_documents").upsert({
    document_id: documentId,
    file_name: fileName,
    title,
    domain: meta.domain?.trim() || "כללי",
    version: meta.version?.trim() || "1",
    pages: isTxt ? null : pages.length,
    chunk_count: chunks.length,
    storage_path: meta.storagePath ?? null,
    ingested_at: new Date().toISOString(),
  });
  if (docError) throw new Error(`document upsert failed for ${documentId}: ${docError.message}`);

  return {
    documentId,
    title,
    pages: isTxt ? null : pages.length,
    chunks: chunks.length,
    sanityWarning: sanity.ok ? undefined : sanity.reason,
  };
}

export interface KnowledgeDocument {
  document_id: string;
  file_name: string;
  title: string;
  domain: string;
  version: string;
  pages: number | null;
  chunk_count: number;
  storage_path: string | null;
  ingested_at: string;
}

export async function listDocuments(): Promise<KnowledgeDocument[]> {
  const { data, error } = await getSupabase()
    .from("knowledge_documents")
    .select("*")
    .order("ingested_at", { ascending: false });
  if (error) throw new Error(`list documents failed: ${error.message}`);
  return (data ?? []) as KnowledgeDocument[];
}

/** מחיקת מסמך: הקטעים + הרשומה. מחזירה את נתיב הקובץ ב-Storage למחיקה בידי הקורא. */
export async function deleteDocument(documentId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("knowledge_documents")
    .select("storage_path")
    .eq("document_id", documentId)
    .maybeSingle();

  const { error: chunksError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("document_id", documentId);
  if (chunksError) throw new Error(`delete chunks failed: ${chunksError.message}`);

  const { error: docError } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("document_id", documentId);
  if (docError) throw new Error(`delete document failed: ${docError.message}`);

  return (data?.storage_path as string | null) ?? null;
}
