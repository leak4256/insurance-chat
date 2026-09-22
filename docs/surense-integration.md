# Surense — ארכיון ממצאים טכניים

> ארכיון. נקרא **רק** כשעובדים על אינטגרציית Surense/Make.
> מצב עדכני וחסם פעיל נמצאים בתדריך (קובץ הזיכרון), לא כאן.

---

## 1. איך ניגשים ל-Surense (מאומת)

**אין גישה ישירה ל-API.** תמיכת Surense בכתב (20.07.2026): ה-API נגיש **רק** דרך מודולי Make/Zapier.
החיבור = אימייל+סיסמה+2FA של סוכן Surense בתוך חלון החיבור של Make.
ציטוט: "לא ניתן להתחבר עם client id, client secret, auth אחר".

פורטל המפתחים (developer.surense.com) + כפתור Authorize = **מבוי סתום**. שגיאה בצד Surense, לא ניתנת לתיקון.

### הארכיטקטורה בפועל
```
השרת שלנו → Make custom webhook (header: x-make-apikey)
           → Router לפי action → מודול Surense → Webhook Response
```

- אפליקציית Surense המאומתת ב-Make: 44 מודולים.
- קוד: `src/lib/surense.ts` — POST `{action, ...}` ל-`MAKE_WEBHOOK_URL`, header `x-make-apikey: MAKE_WEBHOOK_SECRET`.
- actions: `search_customers{idNumber,email}` / `get_customer{customerId}` / `portfolio{customerId}`.
- אימות כפול: הסינון בתרחיש Make + אימות חוזר מקומי (timing-safe) על idNumber+email.

### מגבלות Make (חינם)
1,000 פעולות/חודש, מקסימום 2 תרחישים פעילים → תכנון = **תרחיש אחד**: Custom Webhook → Router על `action` → מודול → Webhook Response.
עם ~350 לקוחות, כל תכנון של "קריאה פר לקוח פר התחברות" כמעט בוודאות לא נכנס בחינם → לתקצב Make Core (~$9/חודש) מול תקרת ה-$50.

חשבון Make נפתח תחת האימייל של **הסוכנת** (התשתית/חיוב שלה; אין ריבוי משתמשים בחינם; לאה משתפת התחברות; הסוכנת מספקת קוד 2FA פעם אחת בזמן החיבור).

---

## 2. Scopes — איך משיגים אותם (נפתר 28.07.2026)

**אל תנחשו שמות scope.** scope שגוי שובר את יצירת החיבור.

**מקור האמת:** `GET /reports/providers` עובד תחת `global:user`, וכל provider נושא שדה **`requiredPermission`** — אלה בדיוק מחרוזות ה-scope. לא צריך יותר לנחש ולא צריך פנייה לתמיכה.

**הנוהל להוספת scope** (זה מה שעבד):
בתוך Make → פתחי מודול Surense → ליד Connection לחצי **Add** (חיבור **חדש**, לא Edit) → **"Show advanced settings"** → מופיע שדה Scopes → הוסיפי את ה-scope → שמרי → חלון התחברות Surense → ואז בחרי מחדש את החיבור החדש בכל מודול Surense.

לא עובד: פורטל המפתחים (מציע רק `openid`/`profile`/`global:export`), ולא "Reauthorize" (מציג רק אימייל+סיסמה, בלי שדה scope).

**Scopes ידועים** (13 providers הוחזרו; הרלוונטיים):
| provider | UUID | requiredPermission |
|---|---|---|
| מוצרים בניהול | `bd04e37d-f6e1-4563-b2f4-58816480cf31` | `reports:managed_savings` |
| מוצרים טרום טיפול | `552967b9-9a1b-490b-9455-c7afef8dd992` | `reports:trom_products` |
| חיובי מסלקה | — | `reports:swiftness` |
| ימי הולדת | — | `global:user` |

"מוצרים בניהול" = "פירוט כל מוצרי החסכון והביטוח המצויים בניהול בעל החשבון, לפי פרודוקציה מסלקה ופרודוקציה פרט, לרבות צבירה, הפקדות, פרמיות, מספרי סוכן" — פירוט פר-פוליסה לכל הלקוחות בקריאה אחת.

"מוצרים טרום טיפול" params מתועדים: `companies` int[], `startMonth`/`endMonth` בפורמט YYYY-MM, `includesCancelled` bool.

**Scopes שכבר מוגדרים בחיבור:** `global:user`, `reports:managed_savings`.

---

## 3. איך בודקים endpoint (הנוהל היחיד שתקף)

⚠️ **PowerShell/curl חסרי טעם כאן.** טוקן שמנוהל ע"י Make לא ניתן לחילוץ מה-UI, וטוקן שנוצר ב-Swagger של הפורטל נושא scopes שגויים.

**הדרך היחידה:** הרצת המודול `Surense 30 — Make an API call` מתוך התרחיש "Integration Webhooks":
מצב Edit על התרחיש → קליק ימני על המודול → **"Run this module only"** → Body type = Raw.

---

## 4. מפת Endpoints — מה נבדק ומה יצא

### עובד ✅
| Endpoint | תוצאה |
|---|---|
| `GET /products/types` | מילון סוגי מוצר: code/description/shortDescription/group. למשל 2="קרן פנסיה ותיקה" group "פנסיה", 15="אבדן כושר עבודה" |
| `POST /products/search` | **קטלוג מוצרים גלובלי** (אחרי `global:user`). לא אחזקות לקוח |
| `GET /customers/fields` | מילון שדות הלקוח |
| `GET /reports/providers` | רשימת providers + `requiredPermission` |
| `GET /swiftness/accounts/list` | חשבון פעיל אחד, `id`=`dbac178f-c206-4bca-9e3c-1d09d06428cd`, accountName "רחל טיירי" |
| `POST /documents/search` | `{filters:[{field:"customerId",operator:"equals",value:...}]}` |
| `POST /documents/urls` | `{documents:[{docId,inline:false,shorten:true}]}` → URL הורדה עובד |

### חסום / לא קיים ❌
| Endpoint | תוצאה | מסקנה |
|---|---|---|
| `GET /products/fields` | 405 | — |
| `GET /customers/{id}/products` | **405 Method Not Allowed** | **הנתיב קיים אך לא מתועד!** |
| `POST /customers/{id}/products` (02.08.2026) | 400 `Request body is missing or could not be read` | שגיאת Spring: הגוף לא הגיע. כנראה Body type לא הוגדר Raw+JSON. **לא נוסה שוב עם גוף תקין** |
| `POST /customers/{id}/products/search` | 405 | — |
| `/customer-products/search`, `/customer-products/fields`, `/gridviews/customer-products` | 404 | לא לנסות שוב |
| `POST /products/search` + filter על `customerId`/`customer` | 500 | השדה לא קיים על הישות |
| `POST /swiftness/e9100/download` | 400 המשתמש אינו מורשה | **אסור בכל מקרה — ראו §6** |
| `POST /customers/{id}/reports/search` | 400 unauthorized | חסר scope |
| `POST /customers/{customerId}/reports` | דורש `customers:update` (כתיבה) | |

### לא קיים במפרט
`/customers/{id}/portfolio` — לא קיים. קטגוריית Product כולה = `GET /products/types` + `POST /products/search`, שניהם קטלוג גלובלי בלבד.
`/customers/sources` = מילון מקורות ליד, לא רלוונטי.

**המפרט הגולמי לא ניתן להורדה:** `developer.surense.com/openapi.json` → 404, `api.surense.com/api/v1/v3/api-docs` → 401. התיעוד הציבורי של Surense **מוכח כחלקי**.

---

## 5. איפה הנתונים נמצאים בפועל

### `get_customer` → `tromStats` — זה מה שהצ'אט משתמש בו היום ✅
סיכום מסלקה פנסיונית: `kayamHaim`/`Briut`/`Siudi`/`MahalotKashot` (booleans) + `premiaHaim`, `tzviraPensia`/`Hishtalmut`/`Gemel` (צבירות), `premia`, `kitzbaHazuyaKolelHafkadot`, `kisuiHadPaamiSheerim`.

`summarizeHoldings()` ב-`surense.ts` מייצר תת-קבוצה ממוזערת עם תוויות עברית.
⚠️ **תוויות הכיסויים בעברית הן ניחוש מושכל — חייבות אימות מול הסוכנת.**

קיים גם `productiaStats.*` (קטגוריות נוספות שאין ב-tromStats): `statsTzviraAlternativiim`, `statsTzviraNihulTikim`, `statsTzviraHisahonFinansi`.

### `portfolio` — **לא פוליסות**
`List customer portfolio history` מחזיר היסטוריית סנכרון חודשית דלילה (misparMislaka/validityMonth/production, רובה nulls + הדים של webhook). המודול נשאר בתרחיש אבל **לא בשימוש**.

### שמות שדות מאומתים (מבדיקה חיה)
`customer = {id, idNumber, email, fullName, firstName, lastName, tromStats, …60+}`
(**לא** email1/firstName כמו שהתיעוד רמז; firstName נגזר אצלנו מהמילה הראשונה של fullName)

מטא-דאטה של ייפוי כוח על הלקוח: `hbProxySignDate`, `swiftnessProxySignDate`, `policiesProxySignDate`, שדות `*ProxyInviteDate` מקבילים, `hbDataDate`, `lastE9100DataDate`, `reportDetailType`, `reportPeriod`, `lastProductiaReportAccessDate`, `lastSentConsultingReportTimestamp`.
**אין שום שדה ברמת פוליסה על ישות הלקוח.**

### צורות תגובה
- `get_customer` → אובייקט **חשוף** (בלי עטיפה)
- `search` / `portfolio` → `{"array":[...]}`

---

## 6. 🛑 אסור — הוראת רחלי (28.07.2026)

**"לא להשתמש בחיבור למסלקה הפנסיונית כלל."**

רחלי (הסוכנת, בעלת הרישיון) פסלה את החיבור למסלקה. זה הורג לצמיתות את מסלול E9100/Swiftness.
**לעולם לא להריץ:** `POST /swiftness/e9100/events`, `POST /swiftness/e9100/download`.

הסיבה (עדפות): כל שאילתת מסלקה **מחויבת בתשלום** (תיאור ה-provider "חיובי מסלקה": "העלות שלהן לפי מחירון המסלקה"), וזו פעולה מפוקחת תחת ייפוי כוח.

**היקף האיסור — הובהר:** רחלי אישרה ש**קריאת נתונים שכבר קיימים ב-Surense מותרת**; רק שאילתות מסלקה חדשות אסורות. זה משמר את `tromStats` שהצ'אט הקיים תלוי בו.
היא הוסיפה שכל הנתונים על הקרנות/קופות שפתחה ללקוח **כבר נמצאים ב-Surense ומתרעננים תקופתית**.

---

## 7. הנתונים הפר-פוליסתיים — נמצאו כמסמך, לא כאובייקט API

בכרטיס הלקוח של לאה: **`דוח מסלקה.xls`** — docId `031e3c42-7527-4734-8abd-94a82041190d`, 32KB, **`source: "manual"`** (מישהו העלה ידנית, נוצר 26.05.2026), לצד `הרשאת מסלקה פנסיונית_*.pdf` שנוצר במערכת (17.05.2026).

הקובץ פוענח (BIFF8/OLE2 אמיתי; **אין python במכונה** — נעשה עם node + חבילת `xlsx` שהותקנה בתוך ה-scratchpad, **לא בפרויקט**).

**3 גיליונות:**
1. `כיסויים ביטוחיים` — סוג הכיסוי, שם התוכנית, שם חברה מנהלת/מבטחת, מקבל התשלום, סכום חד פעמי, קצבה חודשית, מס' פוליסה/חשבון
2. `מעקב הפקדות` — פר חודש פר פוליסה: סוג מוצר, שם חברה מנהלת, מספר פוליסה, תאריך ערך, חודש שכר, שם מעסיק, הפקדות עובד/מעסיק/פיצויים
3. **`פרטי המוצרים שלי` — היהלום, 30 עמודות:** שם מוצר, שם חברה מנהלת, מספר פוליסה, סטטוס, סך הכל חיסכון, תחנת משיכה קרובה, חיסכון/קצבה צפויים לגיל פרישה, שיעור דמי ניהול מהפקדות + שנתי מחיסכון צבור, תשואה מתחילת השנה, שארים (בן/בת זוג, הורה נתמך, ילדים), פנסיית נכות, סכומי אכ"ע, מוטבים, סכום ביטוח למקרה מוות, תאריך פתיחת תוכנית, תאריך נכונות נתונים

5 המוצרים של לאה: מגדל ריסק #23365137, מגדל מקפת פנסיה חדשה מקיפה #211953211, הראל קרן השתלמות #71079179, שתי הראל קופת גמל להשקעה #170315834 / #170505758.

**הערכים מצטלבים במדויק מול tromStats** (67,878 פנסיה · 18,347 השתלמות · 28.28 פרמיית חיים · 1,534,229 שארים) — מוכיח ש-tromStats הוא סיכום של השורות האלה, כלומר הקובץ הזה **הוא המקור**.

⚠️ **אבל** המסלול `documents/search → documents/urls` תלוי בקובץ שהועלה **ידנית** → **לא אמין ל-~350 לקוחות.**

---

## 8. הפקת דוחות — נחקר עד הסוף, חסום

### רמת חשבון: `POST /reports`
`{providerId:"bd04e37d…", params:{month:"2026-04"}}` → **200 עם גוף ריק.**
הצורה נכונה (`month` בתוך `params`) וה-scope עובד — השגיאה השתנתה מ"לא מורשה" ל"חסר פרמטר", מה שמוכיח שהחיבור החדש נושא את ה-scopes.
לא הופיע מסמך חדש ב-`POST /documents/search` ממוין לפי createdDate יורד.
`GET /reports/{id}` ו-`POST /reports/{id}/url` דורשים record id שמעולם לא התקבל.
**לא נוסה:** בדיקת `headers`/`statusCode` בתגובה עבור header `location` או 202; ייתכן שהדוח נשלח במייל (ל-Make יש מודול `Send report`).

### רמת לקוח: מודול `Create report` של Make
מציע בדיוק **שני** providers: "טרום טיפול" ו"פרודוקציה" (ממופים 1:1 ל-`tromStats.*` / `productiaStats.*`).
⚠️ **אל תזיני לו UUID מ-`GET /reports/providers`** — אותה רשימה היא ברמת חשבון, עבור `POST /reports`.

**✅ בדיקה מכרעת — קורלציה מושלמת:**
| מצב הלקוח | תוצאה |
|---|---|
| `tromStats` **ריק** (למשל גובני יעל) | `"לא נמצאו מוצרים ללקוח ולכן לא הופק דוח"` — אמיתי, המנגנון עובד |
| `tromStats` **מלא** | **`[500] שגיאה כללית`, בכל פעם** |

הכשל קורה בדיוק ורק כשיש נתונים לדווח → **באג או פיצ'ר מושבת בצד Surense, לא טעות פרמטר אצלנו** (פרמטר שגוי היה נכשל גם על לקוחות ריקים).

**חשוד ראשי:** `Report Enabled = false` — נמצא על כל הלקוחות שנבדקו (`reportPeriod` נעדר).

⚠️ **תיקון של לאה — לא לחזור על הניחוש השגוי הזה:** רשומות גובני האחרות הן **לקוחות אמיתיים** (בני משפחה שלה); הן הופיעו בצילום המסך רק כי סיננה את הטבלה לפי שם משפחה. הסימון `מקור = "לקוח קיים"` הוא משהו שרחלי התחילה ליישם לאחרונה, רוב הלקוחות חסרים אותו, ו**אין לו שום משמעות**.

**לא נוסה כשהסשן נגמר:** `Create report` + טרום טיפול על לאה עם `month=2026-06` (ה-`lastE9100DataDate` שלה), ועם month ריק.

### ✅ דוח "פרודוקציה" (סוג דוח 2) — עובד (22.09.2026)
הרצה ידנית על יהודה (`79b095c1…`, `tromStats` ריק, `productiaStats` עם ביטוח חיים למשכנתא): `success:true` + `reportId`. ה-PDF (3.4K תווים) מכיל **"מגדל ביטוח", "ביטוח חיים משכנתא" ומספר החשבון/פוליסה** — כלומר הפירוט ברמת פוליסה שחסר ב-`productiaStats`. `search_reports` מחזיר אותו עם `reportType.code = 2`, `validityMonth = "2026-07"`.

שני תנאים להצלחה, שנמצאו באותה הרצה (לא מבודדים):
1. **שדות "דוח ישן" חייבים להיות Empty, לא No.** עם No חזר "לא נמצאו מוצרים ללקוח ולכן לא הופק דוח".
2. **"חודש נכונות המידע" הוא פר-לקוח** (עזרת השדה: "ניתן להשיג דרך Get Customer Portfolio History"). עבד עם `2026-07` = `productiaStats.statsValidityMonth`; `2026-04` נכשל (אך יחד עם No). `lastProductiaMonth` (`2026-08`) לא נוסה. הקוד שולח את החודש מרשומת הלקוח (`reportRequestFor` ב-`surense.ts`) — בלי `portfolio`.

**בקוד:** `REPORT_TYPES` {1 טרום טיפול, 2 פרודוקציה}; הבחירה לפי המקור שיש ללקוח (טרום טיפול אם יש נתוני מסלקה, אחרת פרודוקציה). `create_report` נשלח עם `reportType` ו-`month` — **הראוטר ב-Make חייב למפות אותם מגוף ה-webhook** (עד אז הסוג קבוע 1 בתרחיש).

---

## 9. גילוי מה-UI (DevTools על app.surense.com)

מסך המוצרים של הלקוח: route `/customers/{id}/products`.
תצורת הטבלה: `GET https://app.surense.com/api/gridviews/customer-products`
הנתונים: `https://app.surense.com/api/products`

⚠️ שימי לב — זה ה-**API הפנימי של אפליקציית הווב**, לא `api.surense.com/api/v1` הציבורי.

הערה: קוראים רק את ה-Request URL/method/payload — **לעולם לא את ה-headers** (מכילים bearer token).

---

## 10. לידים פתוחים (לפי סדר עדיפות)

1. ~~דוח "פרודוקציה" פר-לקוח~~ — **עובד, ר' §8.** נותר: מיפוי `reportType` + `month` מגוף ה-webhook במסלול `create_report` ב-Make, (נעשה 22.09 — מיפוי ידני `{{5.reportType}}` / `{{5.month}}`). ⚠️ `reportType` חייב להגיע כ**מספר** ב-JSON: המחרוזת "2" נכשלת ב-400 "Request body is missing or could not be read" (אומת: "2" נכשל, 2 הצליח). שדות "דוח ישן": Make מאפס Empty ל-No בכל פתיחה של המודול — הפתרון הקבוע הוא מתג Map דלוק עם שדה ריק. טרום טיפול נשלח **בלי** חודש, כמו שעבד מאז 19.08; לא נבדק עם חודש.
   ~~מסך המוצרים~~ (22.09.2026) — **מבוי סתום סופי**: הבקשה היא `GET app.surense.com/api/products` **בלי query ובלי body**; זהות הלקוח עוברת בכותרת/עוגייה של סשן הדפדפן. זה ה-API הפנימי של הווב (ר' §9), לא נגיש מהחיבור של Make. לא לנסות שוב.
2. **הר הביטוח** — רגיסטר **שונה מהמסלקה**, ולכן מחוץ לאיסור של רחלי (לאמת איתה בכל זאת). ל-Make יש מודול `Download har bituach` מדרגה ראשונה, ועל הלקוח יש `hbProxySignDate`/`hbProxyInviteDate`/`hbDataDate`. צפי: פוליסות ביטוח בלבד (חיים/בריאות/סיעוד/כללי), כנראה לא פנסיה/גמל/השתלמות.
3. `GET /productia/fields` — ניחוש זול; הקידומת `productiaStats.*` והמילה של רחלי "פרודוקציה" מרמזות על ישות `productia`. המוסכמה `GET /{entity}/fields` מאומתת על `customers`.
4. `productCode`/`id` מ-`/products/search` הם מפתחות הצירוף הסבירים לתרגום קודים מספריים לשמות קרנות קריאים — בשילוב מילון `GET /products/types`.

**פנייה לתמיכה נוסחה בעברית** ומכסה 3 נושאים: (א) ה-500 שמתואם עם קיום נתונים, כולל customer id לדוגמה והחודשים שנוסו; (ב) האם `Report Enabled=false` חוסם הפקת דוחות ואיך מדליקים; (ג) הנתיבים הלא-מתועדים `/customers/{id}/products` עם ראיות ה-405/400 וה-`requiredPermission` הנדרש. מומלץ לצרף timestamp מדויק של הרצה כושלת מהיסטוריית Make.

---

## 11. מתח ארכיטקטוני שממתין להכרעה

הדוח ברמת חשבון מחזיר נתוני פוליסות של **כל** הלקוחות בבת אחת → שימוש בו = **שמירת מידע פיננסי אישי at rest**, מה ש**סותר את החלטת האפיון "אין מידע אישי at rest"**.

חלופה משמרת-פרטיות = דוח פר-לקוח בזמן התחברות, אבל זה דורש `customers:update` ועולה הרבה יותר פעולות Make.

עם 350 לקוחות, הדוח היחיד-במטמון הוא כנראה הצורה היחידה שנכנסת בחינם. **צריך להכריע עם לאה ורחלי.**
