import { createHash } from "node:crypto";
import { config } from "@/lib/config";
import { IngestSanityError, ingestDocument } from "@/lib/ingest";
import { isAdminAuthenticated } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";

/**
 * העלאת מסמך ידע מהמסך של הסוכן (US-5, אפיון 14 שלב 2):
 * קובץ PDF/TXT + metadata (כותרת, תחום, גרסה) → שמירת המקור ב-Supabase Storage →
 * קליטה מלאה (חלוקה, embeddings, החלפת קטעים) — זהה לסקריפט ה-CLI.
 */

export const maxDuration = 300;

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** שם קובץ עברי אינו חוקי כמפתח Storage — נגזר מפתח יציב מה-hash של השם */
function storageKeyFor(fileName: string): string {
  const ext = /\.txt$/i.test(fileName) ? ".txt" : ".pdf";
  return `${createHash("sha256").update(fileName).digest("hex").slice(0, 16)}${ext}`;
}

async function uploadToStorage(fileName: string, buffer: Uint8Array): Promise<string | null> {
  try {
    const supabase = getSupabase();
    const bucket = config.admin.storageBucket;
    // יצירת ה-bucket אם אינו קיים (idempotent — שגיאת "כבר קיים" נבלעת)
    await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
    const key = storageKeyFor(fileName);
    const { error } = await supabase.storage.from(bucket).upload(key, buffer, {
      contentType: /\.txt$/i.test(fileName) ? "text/plain" : "application/pdf",
      upsert: true,
    });
    if (error) throw new Error(error.message);
    return key;
  } catch (err) {
    // שמירת המקור היא נוחות — כישלון בה לא חוסם את הקליטה עצמה
    console.error("storage upload failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function POST(req: Request) {
  if (!(await isAdminAuthenticated().catch(() => false))) {
    return Response.json({ error: "נדרשת כניסה למסך הניהול." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "בקשה לא תקינה." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || !/\.(pdf|txt)$/i.test(file.name)) {
    return Response.json({ error: "יש לצרף קובץ PDF או TXT." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "הקובץ גדול מדי (מקסימום 20MB)." }, { status: 413 });
  }

  const meta = {
    title: String(form.get("title") ?? ""),
    domain: String(form.get("domain") ?? ""),
    version: String(form.get("version") ?? ""),
  };
  const force = form.get("force") === "true";

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const storagePath = await uploadToStorage(file.name, buffer);
    const result = await ingestDocument(file.name, buffer, { ...meta, storagePath }, { force });
    return Response.json({ ok: true, ...result, storedInStorage: storagePath !== null });
  } catch (err) {
    if (err instanceof IngestSanityError) {
      // 422: המסך מציע לסוכן לאשר קליטה בכפייה (force) אחרי בדיקה ידנית
      return Response.json({ error: err.reason, sanityFailed: true }, { status: 422 });
    }
    console.error("document upload error:", err instanceof Error ? err.message : err);
    return Response.json(
      { error: "הקליטה נכשלה. בדקו שסכמת שלב 2 הורצה ב-Supabase ונסו שוב." },
      { status: 500 },
    );
  }
}
