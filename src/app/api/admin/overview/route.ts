import { listDocuments } from "@/lib/ingest";
import { isAdminAuthenticated } from "@/lib/session";
import { isSurenseConfigured } from "@/lib/surense";

/** מצב מסך האדמין: חיבור Surense + רשימת מסמכי הידע. */
export async function GET() {
  let authenticated = false;
  try {
    authenticated = await isAdminAuthenticated();
  } catch {
    // SESSION_SECRET חסר — מתנהג כלא מחובר
  }
  if (!authenticated) return Response.json({ authenticated: false }, { status: 401 });

  try {
    const documents = await listDocuments();
    return Response.json({
      authenticated: true,
      surense: { configured: isSurenseConfigured() },
      documents,
    });
  } catch (err) {
    console.error("admin/overview error:", err instanceof Error ? err.message : err);
    return Response.json(
      {
        authenticated: true,
        surense: { configured: isSurenseConfigured() },
        documents: [],
        warning:
          "טעינת הנתונים נכשלה — ודאו שסכמת שלב 2 (supabase/schema-phase2.sql) הורצה ב-Supabase.",
      },
      { status: 200 },
    );
  }
}
