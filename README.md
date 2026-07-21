# צ'אט AI ללקוחות סוכנות ביטוח — שלבים 1–2

צ'אט בעברית (RTL) לשאלות כלליות על ביטוח, מבוסס RAG על מסמכי ה-PDF של הסוכנות.
מסמך האפיון המלא: [docs/characterization.md](docs/characterization.md) — הוא מקור האמת.

**תכולת שלב 1:** צ'אט זורם בעברית · RAG עם metadata וציטוטי מקור · guardrails ·
סקריפט קליטת PDF · הערכת RAG (golden set + LLM-judge).

**תכולת שלב 2:** הזדהות בתוך הצ'אט (ת"ז + אימייל מול Surense → קוד OTP למייל →
session מסוג httpOnly) · שאלות אישיות עם שליפה חיה מ-Surense (הכלי `get_customer_data`
נרשם למודל רק כשה-session מאומת, וללא פרמטר מזהה) · מסך ניהול לסוכן ב-`/admin`
(העלאת מסמכי PDF/TXT + חיבור OAuth חד-פעמי ל-Surense).

## סטאק

Next.js 16 (App Router) · TypeScript · Tailwind v4 + shadcn/ui · Vercel AI SDK v5 ·
Claude Haiku 4.5 · Supabase pgvector · Voyage voyage-3.5-lite · Railway

> הערה: האפיון נכתב על Next.js 15; הפרויקט הוקם על 16 (ה-stable הנוכחי, אותה ארכיטקטורה).

## הקמה

1. **Supabase:** צרו פרויקט (free tier) → SQL Editor → הריצו את [supabase/schema.sql](supabase/schema.sql)
   ואת [supabase/schema-phase2.sql](supabase/schema-phase2.sql).
2. **מפתחות:** `cp .env.example .env.local` ומלאו: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ו-`AGENT_EMAIL` כשתהיה כתובת).
3. **תלויות:** `npm install`

### משתני סביבה נוספים לשלב 2

| משתנה | תפקיד |
|---|---|
| `SESSION_SECRET` | חתימת cookies של session + OTP. מחרוזת אקראית ≥ 32 תווים (`openssl rand -base64 32`). **חובה** |
| `ADMIN_PASSWORD` | סיסמת מסך הניהול `/admin`. **חובה** |
| `RESEND_API_KEY` | שליחת קודי OTP למייל. בלי מפתח, בפיתוח בלבד, הקוד מודפס ללוג השרת |
| `RESEND_FROM` | כתובת השולח (ברירת מחדל: `onboarding@resend.dev` — לבדיקות בלבד) |
| `MAKE_WEBHOOK_URL` | כתובת ה-Custom Webhook של תרחיש ה-Make שמתווך מול Surense |
| `MAKE_WEBHOOK_SECRET` | ה-API Key שהוגדר על ה-webhook ב-Make (נשלח בכותרת `x-make-apikey`) |
| `APP_URL` | כתובת האפליקציה (ברירת מחדל: `http://localhost:3000`) |

### חיבור Surense — דרך Make.com (רוויזיה 20.07.2026)

תמיכת Surense (בכתב): אין גישה ישירה ל-API עם client id/secret — הדרך היחידה
היא מודולי Surense בתוך Make/Zapier, עם התחברות של הסוכן (מייל+סיסמה+קוד אימות)
בחלון החיבור של Make. לכן תרחיש Make משמש כמתווך: Custom Webhook → Router לפי
`action` → מודול Surense → Webhook Response. שלוש הפעולות (החוזה המלא בהערת
המודול [src/lib/surense.ts](src/lib/surense.ts)):

| `action` | מודול Surense בתרחיש | פרמטרים |
|---|---|---|
| `search_customers` | Search customers | `idNumber`, `email` |
| `get_customer` | Get customer | `customerId` |
| `portfolio` | List customer portfolio history | `customerId` |

בלי `MAKE_WEBHOOK_URL`/`MAKE_WEBHOOK_SECRET` ההזדהות בצ'אט תחזיר "שירות ההזדהות
אינו זמין כרגע" (הצ'אט הכללי ממשיך לעבוד).

> ⚠️ מבנה התשובות של מודולי Make אינו מתועד — הפירוק ב-`surense.ts` סובלני
> (מערך ישיר או עטיפת `data`/`items`/`customers`), אך יש לאמת מול הרצת ניסיון
> אמיתית של התרחיש ולעדכן שם במקום אחד.

## קליטת מסמכי ידע

**מהמסך (שלב 2):** כניסה ל-`/admin` עם `ADMIN_PASSWORD` → העלאת PDF/TXT עם כותרת,
תחום וגרסה. הקובץ המקורי נשמר ב-Supabase Storage (bucket פרטי `knowledge`), והקליטה
זהה לסקריפט: בדיקת שפיות → קטעים → embeddings → החלפת קטעי המסמך.

**מה-CLI:**

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
src/ai/           גבול מודול ה-AI (אפיון 5.1): provider, embedder, פרומפט, כלים, אחזור
src/app/api/chat  צינור הצ'אט: rate-limit → session → חלון הזזה+סיכום → streamText + כלים
src/app/api/auth  הזדהות לקוחות: start (Surense+OTP) / verify / resend / session / logout
src/app/api/admin מסך הניהול: login, overview, העלאת/מחיקת מסמכים, OAuth ל-Surense
src/app/admin     מסך הסוכן (סיסמה → העלאת PDF + חיבור Surense)
src/components/   ממשק הצ'אט (RTL, נגישות, ציטוטי מקור, כרטיס התחברות)
src/lib/          config, session (cookies חתומים), otp, mailer, surense, ingest, supabase
scripts/ingest    קליטת PDF מה-CLI (ליבה משותפת עם המסך ב-src/lib/ingest.ts)
scripts/eval      הערכת RAG דו-שכבתית (recall@k + LLM-judge)
supabase/         סכמות מסד הנתונים (schema.sql + schema-phase2.sql)
knowledge/        קובצי ה-PDF של הסוכנות (לא נכנסים ל-git)
```
