-- סכמת שלב 2 — להרצה ב-SQL Editor של Supabase, אחרי schema.sql.
-- ניתן להרצה חוזרת (idempotent).

-- הערה (20.07.2026): טבלת surense_tokens בוטלה — אין OAuth ישיר מול Surense;
-- הגישה עוברת דרך תרחיש Make (ר' src/lib/surense.ts), והחיבור נשמר ב-Make עצמו.

-- רישום מסמכי הידע (מזין את הרשימה במסך האדמין; נכתב גם מסקריפט ה-CLI)
create table if not exists knowledge_documents (
  document_id text primary key,
  file_name text not null,
  title text not null,
  domain text not null default 'כללי',
  version text not null default '1',
  pages integer,
  chunk_count integer not null default 0,
  -- מפתח הקובץ המקורי ב-Supabase Storage (bucket: knowledge); null בקליטת CLI
  storage_path text,
  ingested_at timestamptz not null default now()
);

alter table knowledge_documents enable row level security;

-- הערה: ה-bucket "knowledge" ב-Storage נוצר אוטומטית בהעלאה הראשונה מהמסך
-- (או ידנית ב-Dashboard: Storage → New bucket → knowledge, private).
