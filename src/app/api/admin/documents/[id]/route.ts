import { config } from "@/lib/config";
import { deleteDocument } from "@/lib/ingest";
import { isAdminAuthenticated } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";

/** מחיקת מסמך ידע: הקטעים מה-pgvector, הרשומה, והקובץ מה-Storage. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated().catch(() => false))) {
    return Response.json({ error: "נדרשת כניסה למסך הניהול." }, { status: 401 });
  }

  const { id } = await params;
  if (!id || id.length > 200) return Response.json({ error: "מזהה לא תקין." }, { status: 400 });

  try {
    const storagePath = await deleteDocument(decodeURIComponent(id));
    if (storagePath) {
      await getSupabase().storage.from(config.admin.storageBucket).remove([storagePath]).catch(() => {});
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("document delete error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "המחיקה נכשלה. נסו שוב." }, { status: 500 });
  }
}
