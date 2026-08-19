# סביבה ותפעול — ארכיון

> ארכיון. נקרא כשמשהו בסביבה נשבר, או כשמריצים ingest/eval/dev בפעם הראשונה בסשן.
> שלוש השורות הקריטיות נמצאות גם בתדריך.

---

## NetFree — סינון TLS על המכונה הזו

Node חייב:
```
NODE_EXTRA_CA_CERTS=./certs/netfree-ca.pem
```

מחווט דרך `cross-env` בסקריפטי ה-npm: `dev`, `build`, `ingest`, `eval` — **אבל לא ב-`start`**.

**תופעת לוואי:** ה-CLI של shadcn לא שמיש → הרכיבים הוטמעו ידנית בפרויקט.

### ⚠️ worktrees לא ניתנים לאימות חי (18.08.2026)

git worktrees תחת `.claude/worktrees/*` **לא** מקבלים את `certs/netfree-ca.pem` ולא `.env.local` תקין.
התוצאה מטעה: `npm run dev` עולה בהצלחה וה-UI נטען יפה — אבל **כל** קריאה למודל נופלת:

```
Warning: Ignoring extra certs from `./certs/netfree-ca.pem`, load failed: No such process
Error [AI_RetryError]: unable to get local issuer certificate
  url: 'https://api.anthropic.com/v1/messages'   model: 'claude-haiku-4-5'
```

שימו לב שהמודל נפתר ל-`claude-haiku-4-5` מול Anthropic (הארגון ללא קרדיט) במקום למודל Google של לאה —
כלומר ה-env של ה-worktree שונה מסביבת העבודה האמיתית.

**מסקנה: אימות חי של הצ'אט חייב לרוץ על שרת הפיתוח של לאה ב-:3000, לא מתוך worktree.**
מתוך worktree אפשר לאמת רק typecheck/lint/build ורינדור UI.

---

## מגבלות המכונה

- **אין python.** כללי deny ב-`~/.claude/settings.json` חוסמים `Bash(python *)` ו-`Bash(python3 *)`. לעיבוד קבצים — node + חבילת npm בתוך ה-scratchpad, **לא בפרויקט**.
- **אי אפשר לקרוא קבצי סביבה.** כללי deny חוסמים Read/Edit/Bash על `*.env*`, `*.pem`, `*.key`, `*secret*`, `*credential*`.
  → אבחון בעיות env **רק** דרך סקריפט node שמדפיס **נוכחות** מפתח ואורך, לעולם לא ערך. (התבנית: `scratchpad/envcheck.mjs`)
  → קלוד **לא יכול לערוך** את `.env.local`. כל תוספת מפתח היא משימה של לאה.
- Windows 11 / PowerShell ראשי; כלי Bash זמין ל-POSIX.

---

## הרצת שרת פיתוח

**דרך `launch.json`, לא `npm run dev` ידני.**

`.claude/launch.json` מכיל:
- `insurance-chat` — פורט 3000
- `phase2` — autoPort (נוסף כי סשן אחר החזיק את 3000)

השרת טוען `.env.local` ומקבל את ה-CA של NetFree.

---

## משתני סביבה

| משתנה | מצב |
|---|---|
| `MAKE_WEBHOOK_URL` | ✅ קיים (אורך 58, `https://hook.`) |
| `MAKE_WEBHOOK_SECRET` | ✅ קיים (אורך 40) |
| `SESSION_SECRET` | ✅ נוסף (היעדרו גרם ל-503 ב-auth/start) |
| `ADMIN_PASSWORD` | ✅ נוסף |
| `RESEND_API_KEY` (+`RESEND_FROM`) | ❌ **חסר** — בלעדיו ה-OTP מודפס ללוג השרת (dev בלבד; **בפרודקשן זורק שגיאה**) |
| `APP_URL` | נדרש בפרודקשן |
| Supabase / Voyage / OpenAI / Google | ✅ מוגדרים |

**באג שתוקן:** ל-`SUPABASE_URL` הייתה סיומת `/rest/v1/` → "Invalid path" מ-`match_chunks`. חייב להיות **origin בלבד**.

---

## Supabase

הסכמה חיה ו-`match_chunks` עובד (אומת).

⚠️ **`supabase/schema-phase2.sql` — האם הורץ ב-SQL Editor?** עד שיורץ, ingest ורשימת האדמין נכשלים. (היה חסם פתוח; לאמת מול לאה.)

---

## Ingest

`scripts/ingest.ts` — בדיקת שפיות עברית, רענון פר-מסמך, ליבה משותפת ב-`src/lib/ingest.ts`.

⚠️ **`ingest.ts` קולט רק קבצי `*.pdf`.** קובץ ה-TXT לבדיקה בתיקיית `knowledge/` לא נאסף.

---

## Eval

`npm run eval` — recall@5 + שופט Sonnet, ספים לפי המפרט.

⚠️ **החסם: `scripts/eval/golden-set.jsonl` לא קיים.** הסקריפט בנוי ומוכן ומחכה לקלט הזה. ה-eval מעולם לא רץ.

---

## Git

⚠️ **הכל לא מחויב.** ב-git יש רק את commit הסקאפולד של create-next-app. כל העבודה משלב 1 ושלב 2 יושבת כשינויים לא מחויבים. (סומן ללאה 19.07, עדיין פתוח.)

יש גם 5 worktrees תחת `.claude/worktrees/` מסשנים מקבילים של 02.08.

---

## מסלול הקבלה המוסכם לשלב 1

```
ingest → בדיקת עשן ידנית ל-RAG (תשובה + שורת "מקור:")
       → כתיבת golden set (~20-30 שאלות + מלכודות לפי הכללים החדשים)
       → npm run eval מול הספים
       → בדיקות guardrail ידניות
       → build
```
