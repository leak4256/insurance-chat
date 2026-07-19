# צ'אט AI ללקוחות סוכנות ביטוח — שלב 1 (MVP)

צ'אט בעברית (RTL) לשאלות כלליות על ביטוח, מבוסס RAG על מסמכי ה-PDF של הסוכנות.
מסמך האפיון המלא: [docs/characterization.md](docs/characterization.md) — הוא מקור האמת.

**תכולת שלב 1:** צ'אט זורם בעברית · RAG עם metadata וציטוטי מקור · guardrails ·
סקריפט קליטת PDF · הערכת RAG (golden set + LLM-judge).
ללא התחברות/Surense — אלה בשלב 2.

## סטאק

Next.js 16 (App Router) · TypeScript · Tailwind v4 + shadcn/ui · Vercel AI SDK v5 ·
Claude Haiku 4.5 · Supabase pgvector · Voyage voyage-3.5-lite · Railway

> הערה: האפיון נכתב על Next.js 15; הפרויקט הוקם על 16 (ה-stable הנוכחי, אותה ארכיטקטורה).

## הקמה

1. **Supabase:** צרו פרויקט (free tier) → SQL Editor → הריצו את [supabase/schema.sql](supabase/schema.sql).
2. **מפתחות:** `cp .env.example .env.local` ומלאו: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ו-`AGENT_EMAIL` כשתהיה כתובת).
3. **תלויות:** `npm install`

## קליטת מסמכי ידע

1. הניחו את קובצי ה-PDF בתיקיית `knowledge/`.
2. (מומלץ) צרו `knowledge/manifest.json` לפי [manifest.example.json](knowledge/manifest.example.json) —
   כותרת, תחום ביטוח וגרסה לכל קובץ. קובץ בלי רשומה יקבל ברירות מחדל.
3. הריצו: `npm run ingest`

הסקריפט ניתן להרצה חוזרת: רענון PDF מחליף רק את הקטעים של אותו מסמך.
בדיקת שפיות עברית רצה אוטומטית (טקסט הפוך/סרוק נחסם; `--force` עוקף — לא מומלץ).
בסוף הריצה מודפסת דגימת קטע — **בדקו אותה בעין** לפני שסומכים על התוכן.

## הערה למחשב הזה (NetFree)

הרשת כאן עוברת דרך סינון NetFree שמחליף תעודות TLS. Node לא סומך על התעודה הזו
כברירת מחדל, ולכן כל סקריפטי ה-npm מגדירים `NODE_EXTRA_CA_CERTS=./certs/netfree-ca.pem`
(התעודות יוצאו ממאגר התעודות של Windows). ב-Railway אין סינון — ההגדרה פשוט לא משפיעה שם.

## הרצה

```bash
npm run dev        # פיתוח — http://localhost:3000
npm run build      # בדיקת production build
```

## הערכת RAG

1. כתבו את סט הזהב עם הסוכן: `scripts/eval/golden-set.jsonl`
   (שורה = JSON אחד, ר' [golden-set.example.jsonl](scripts/eval/golden-set.example.jsonl);
   ~40–50 שאלות, 1–2 לכל מסמך, כולל שאלות מלכודת עם `"trap": true`).
2. הריצו: `npm run eval`

רצים אחרי כל רענון PDF ואחרי כל שינוי ב-chunking / embeddings / פרומפט / מודל.
ספי מעבר: recall@5 ≥ 90% · נאמנות ≥ 95% · אפס תשובות מומצאות במלכודות.

## פריסה ל-Railway

1. דחפו את הריפו ל-GitHub וחברו אותו ל-Railway (deploy אוטומטי; region אירופה).
2. הגדירו את משתני הסביבה מ-`.env.local` בממשק Railway.
3. Build: `npm run build` · Start: `npm start` (Railway מזהה Next.js אוטומטית).

## מבנה הקוד

```
src/ai/          גבול מודול ה-AI (אפיון 5.1): provider, embedder, פרומפט, כלים, אחזור
src/app/api/chat צינור הצ'אט: rate-limit → חלון הזזה+סיכום → streamText + search_knowledge
src/components/  ממשק הצ'אט (RTL, נגישות, ציטוטי מקור)
scripts/ingest   קליטת PDF → קטעים+metadata → embeddings → pgvector
scripts/eval     הערכת RAG דו-שכבתית (recall@k + LLM-judge)
supabase/        סכמת מסד הנתונים
knowledge/       קובצי ה-PDF של הסוכנות (לא נכנסים ל-git)
```
