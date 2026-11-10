"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * הודעת ניתוק אחרי שעתיים של חוסר שימוש: נפתחת ב-warnAt, סופרת דקה אחורה,
 * ובתום הדקה מנתקת. "ביטול ניתוק" מבקש מהשרת session חדש.
 * הזמנים הם חותמות מקומיות (חושבו מזמנים יחסיים מהשרת), ולכן הדיאלוג
 * חוזר מיד במצבו הנכון גם אחרי רענון באמצע הדקה.
 */
export function SessionExpiryDialog({
  warnAt,
  expiresAt,
  onExtend,
  onExpired,
  onLogout,
}: {
  warnAt: number;
  expiresAt: number;
  /** מבקש הארכה; true = הצליח */
  onExtend: () => Promise<boolean>;
  onExpired: () => void;
  onLogout: () => void;
}) {
  const [now, setNow] = useState(0);
  const [extending, setExtending] = useState(false);
  const [failed, setFailed] = useState(false);

  // רפרנסים כדי שה-interval לא יתאפס בכל רינדור של ההורה
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    // טאב ברקע מאט טיימרים — מחשבים מחדש ברגע שחוזרים אליו
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const expired = now >= expiresAt;
  useEffect(() => {
    if (expired) onExpiredRef.current();
  }, [expired]);

  if (now < warnAt || expired) return null;

  const secondsLeft = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");

  async function handleExtend() {
    setExtending(true);
    setFailed(false);
    const ok = await onExtend();
    // הצלחה: ההורה מחליף את הזמנים והדיאלוג נעלם. כישלון: מציגים שגיאה והספירה ממשיכה
    if (!ok) {
      setFailed(true);
      setExtending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-expiry-title"
        aria-describedby="session-expiry-desc"
        className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" aria-hidden />
          <h2 id="session-expiry-title" className="font-semibold">
            ההתחברות שלכם עומדת להסתיים
          </h2>
        </div>
        <p id="session-expiry-desc" className="mt-3 text-sm text-muted-foreground">
          מטעמי אבטחה תנותקו בעוד{" "}
          <span className="font-semibold tabular-nums text-foreground" dir="ltr">
            {mm}:{ss}
          </span>
          . רוצים להמשיך להיות מחוברים?
        </p>
        {failed && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            לא הצלחנו להאריך את ההתחברות. נסו שוב.
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <Button onClick={handleExtend} disabled={extending} autoFocus className="flex-1">
            ביטול ניתוק — להישאר מחוברים
          </Button>
          <Button variant="outline" onClick={onLogout} disabled={extending} className="flex-1">
            התנתקות
          </Button>
        </div>
      </div>
    </div>
  );
}
