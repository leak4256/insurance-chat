/**
 * טעינת משתני הסביבה **לפני** כל מודול שקורא אותם.
 *
 * למה מודול נפרד ולא שתי שורות ב-`run-eval.ts`: ה-import-ים מורמים מעל כל
 * הקוד בקובץ (גם אחרי התרגום ל-CJS), ולכן `loadEnv()` שנכתב בגוף הסקריפט רץ
 * **אחרי** ש-`src/lib/config.ts` כבר נטען וקרא `process.env` — ואז
 * `config.chatModel` נופל לברירת המחדל בקוד (`anthropic/...`) במקום לערך
 * שב-`.env.local`. ההרצה הראשונה של ה-eval (06.11.2026) נפלה בדיוק על זה:
 * "Missing required environment variable: ANTHROPIC_API_KEY".
 *
 * סדר ה-import-ים *בין* מודולים כן נשמר, ולכן `import "./load-env"` כ-import
 * הראשון מבטיח שהסביבה נטענת לפני כל השאר.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();
