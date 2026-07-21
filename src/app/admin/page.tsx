"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Link2,
  Link2Off,
  Loader2,
  LogOut,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INSURANCE_DOMAINS } from "@/lib/domains";

/**
 * מסך הסוכן (US-5, אפיון 14 שלב 2): כניסה בסיסמה → העלאת מסמכי ידע (PDF/TXT)
 * עם metadata, רשימת המסמכים במאגר + מחיקה, וסטטוס חיבור Surense (דרך Make —
 * החיבור עצמו מוגדר בתוך Make, לא כאן; ר' src/lib/surense.ts).
 */

interface KnowledgeDocument {
  document_id: string;
  file_name: string;
  title: string;
  domain: string;
  version: string;
  pages: number | null;
  chunk_count: number;
  ingested_at: string;
}

interface Overview {
  surense: { configured: boolean };
  documents: KnowledgeDocument[];
  warning?: string;
}

export default function AdminPage() {
  const [checked, setChecked] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(
    () =>
      fetch("/api/admin/overview")
        .then(async (res) => {
          if (res.status === 401) setOverview(null);
          else setOverview((await res.json()) as Overview);
        })
        .catch(() => setOverview(null))
        .finally(() => setChecked(true)),
    [],
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLoginError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPassword("");
        await loadOverview();
      } else {
        setLoginError(String(data.error ?? "הכניסה נכשלה."));
      }
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setOverview(null);
  }

  if (!checked) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="טוען" />
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4">
        <form onSubmit={login} className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-lg font-semibold">מסך ניהול — הסוכנות</h1>
          <p className="mb-4 text-sm text-muted-foreground">העלאת מסמכי ידע וחיבור Surense</p>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="סיסמת ניהול"
            aria-label="סיסמת ניהול"
            autoFocus
            required
          />
          {loginError && <p className="mt-2 text-xs text-destructive">{loginError}</p>}
          <Button type="submit" className="mt-3 w-full" disabled={busy || !password}>
            {busy ? "נכנסים…" : "כניסה"}
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">מסך ניהול — הסוכנות</h1>
          <p className="text-sm text-muted-foreground">{"מאגר הידע של הצ'אט וחיבור Surense"}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut aria-hidden />
          יציאה
        </Button>
      </header>

      {overview.warning && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {overview.warning}
        </div>
      )}

      <SurenseCard surense={overview.surense} />
      <UploadCard onIngested={loadOverview} />
      <DocumentsCard documents={overview.documents} onChanged={loadOverview} />
    </main>
  );
}

function SurenseCard({ surense }: { surense: { configured: boolean } }) {
  return (
    <section className="mb-6 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {surense.configured ? (
            <Link2 className="h-5 w-5 text-emerald-600" aria-hidden />
          ) : (
            <Link2Off className="h-5 w-5 text-muted-foreground" aria-hidden />
          )}
          <div>
            <h2 className="text-sm font-semibold">חיבור Surense (דרך Make)</h2>
            <p className="text-xs text-muted-foreground">
              {surense.configured
                ? "מוגדר — לקוחות יכולים להזדהות ולשאול על הפוליסות שלהם. החיבור לשורנס עצמו מנוהל בחשבון ה-Make."
                : "חסרים MAKE_WEBHOOK_URL / MAKE_WEBHOOK_SECRET בסביבה. יש לבנות את תרחיש ה-Make ולהעתיק את כתובת ה-webhook."}
            </p>
          </div>
        </div>
        {surense.configured && (
          <Badge variant="secondary" className="gap-1 text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            מוגדר
          </Badge>
        )}
      </div>
    </section>
  );
}

function UploadCard({ onIngested }: { onIngested: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState<string>("כללי");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sanityFailed, setSanityFailed] = useState(false);
  const [success, setSuccess] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(force: boolean) {
    const file = fileRef.current?.files?.[0];
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("title", title);
      form.set("domain", domain);
      form.set("version", version);
      if (force) form.set("force", "true");
      const res = await fetch("/api/admin/documents", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSanityFailed(false);
        setSuccess(
          `"${data.title}" נקלט: ${data.chunks} קטעים${data.pages ? ` מ-${data.pages} עמודים` : ""}.` +
            (data.storedInStorage ? "" : " (שמירת קובץ המקור ב-Storage נכשלה — הקליטה עצמה הצליחה)"),
        );
        setTitle("");
        setVersion("");
        if (fileRef.current) fileRef.current.value = "";
        await onIngested();
      } else {
        setSanityFailed(!!data.sanityFailed);
        setError(String(data.error ?? "ההעלאה נכשלה."));
      }
    } catch {
      setError("ההעלאה נכשלה. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Upload className="h-4 w-4" aria-hidden />
        העלאת מסמך ידע (PDF או TXT)
      </h2>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          upload(false);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt"
          required
          aria-label="קובץ PDF או TXT"
          className="rounded-md border bg-transparent px-3 py-1.5 text-sm file:ml-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-xs file:text-primary sm:col-span-2"
        />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="כותרת המסמך (ברירת מחדל: שם הקובץ)" aria-label="כותרת המסמך" />
        <div className="flex gap-2">
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            aria-label="תחום ביטוח"
            className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
          >
            {INSURANCE_DOMAINS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="גרסה" aria-label="גרסת המסמך" className="w-24" />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                קולטים… (חלוקה לקטעים + embeddings)
              </>
            ) : (
              "העלאה וקליטה למאגר"
            )}
          </Button>
        </div>
      </form>
      {error && (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
          {sanityFailed && (
            <div className="mt-2">
              <p className="mb-1 text-xs">
                בדיקת השפיות לעברית נכשלה. אם בדקתם ידנית שהטקסט תקין — אפשר לקלוט בכל זאת:
              </p>
              <Button variant="outline" size="sm" onClick={() => upload(true)} disabled={busy}>
                קליטה בכל זאת (עוקף בדיקת שפיות)
              </Button>
            </div>
          )}
        </div>
      )}
      {success && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          {success}
        </p>
      )}
    </section>
  );
}

function DocumentsCard({
  documents,
  onChanged,
}: {
  documents: KnowledgeDocument[];
  onChanged: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function remove(id: string) {
    setDeleting(id);
    try {
      await fetch(`/api/admin/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
      await onChanged();
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <FileText className="h-4 w-4" aria-hidden />
        מסמכים במאגר ({documents.length})
      </h2>
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          המאגר ריק. העלו מסמך ראשון — או הריצו npm run ingest מהתיקייה knowledge/.
        </p>
      ) : (
        <ul className="divide-y">
          {documents.map((doc) => (
            <li key={doc.document_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{doc.title}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.file_name} · {doc.domain} · גרסה {doc.version} ·{" "}
                  {doc.pages ? `${doc.pages} עמודים · ` : ""}
                  {doc.chunk_count} קטעים ·{" "}
                  {new Date(doc.ingested_at).toLocaleDateString("he-IL")}
                </p>
              </div>
              {confirming === doc.document_id ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">למחוק את המסמך מהמאגר?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(doc.document_id)}
                    disabled={deleting === doc.document_id}
                  >
                    {deleting === doc.document_id ? "מוחקים…" : "כן, מחיקה"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                    ביטול
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(doc.document_id)}
                  aria-label={`מחיקת ${doc.title}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
