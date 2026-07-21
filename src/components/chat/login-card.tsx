"use client";

import { useEffect, useRef, useState } from "react";
import { LockKeyhole, MailCheck, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * כרטיס התחברות בתוך הצ'אט (FR-3, FR-4, אפיון 12):
 * שלב א' — ת"ז + אימייל; שלב ב' — קוד בן 6 ספרות שנשלח למייל.
 * נפתח מכפתור הכותרת או אוטומטית כשהמודל קורא ל-request_login.
 */

const RESEND_COOLDOWN_SEC = 60;

type Step = "details" | "code" | "done";

async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

export function LoginCard({ onSuccess }: { onSuccess: (firstName: string) => void }) {
  const [step, setStep] = useState<Step>("details");
  const [idNumber, setIdNumber] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { status, data } = await postJson("/api/auth/start", { idNumber, email });
      if (status === 200 && data.ok) {
        setPendingId(String(data.pendingId ?? ""));
        setInfo(String(data.message ?? ""));
        setCode("");
        setResendIn(RESEND_COOLDOWN_SEC);
        setStep("code");
      } else {
        setError(String(data.error ?? "משהו השתבש. נסו שוב."));
      }
    } catch {
      setError("משהו השתבש. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { status, data } = await postJson("/api/auth/verify", { pendingId, code });
      if (status === 200 && data.ok) {
        setStep("done");
        onSuccess(String(data.firstName ?? ""));
      } else if (data.expired) {
        setError(String(data.error ?? "הקוד פג תוקף — התחילו מחדש."));
        setStep("details");
      } else {
        setError(String(data.error ?? "הקוד שגוי. נסו שוב."));
      }
    } catch {
      setError("משהו השתבש. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (busy || resendIn > 0) return;
    setBusy(true);
    setError("");
    try {
      const { status, data } = await postJson("/api/auth/resend", { pendingId });
      if (status === 200 && data.ok) {
        setInfo(String(data.message ?? ""));
        setResendIn(RESEND_COOLDOWN_SEC);
      } else if (data.expired) {
        setError(String(data.error ?? "הבקשה פגה — התחילו מחדש."));
        setStep("details");
      } else {
        setError(String(data.error ?? "משהו השתבש. נסו שוב."));
      }
    } catch {
      setError("משהו השתבש. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="flex w-full justify-start">
        <div className="flex items-center gap-2 rounded-2xl rounded-tr-md border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 shadow-sm">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
          התחברתם בהצלחה! עכשיו אפשר לשאול גם על הביטוחים האישיים שלכם.
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full justify-start">
      <div className="w-full max-w-sm rounded-2xl rounded-tr-md border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LockKeyhole className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight">הזדהות מהירה</p>
            <p className="text-xs text-muted-foreground">
              {step === "details" ? "כדי לשאול על הביטוחים שלכם" : "הזינו את הקוד שנשלח למייל"}
            </p>
          </div>
        </div>

        {step === "details" ? (
          <form className="flex flex-col gap-2" onSubmit={submitDetails}>
            <Input
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              placeholder="מספר תעודת זהות"
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              className="text-right placeholder:text-right"
              maxLength={12}
              required
              aria-label="מספר תעודת זהות"
            />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="כתובת אימייל"
              autoComplete="email"
              dir="ltr"
              className="text-right placeholder:text-right"
              required
              aria-label="כתובת אימייל"
            />
            <Button type="submit" disabled={busy || !idNumber.trim() || !email.trim()}>
              {busy ? "בודקים…" : "שלחו לי קוד למייל"}
            </Button>
          </form>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={submitCode}>
            {info && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <MailCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {info}
              </p>
            )}
            <Input
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="● ● ● ● ● ●"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              className="text-center text-lg tracking-[0.5em]"
              maxLength={6}
              required
              aria-label="קוד בן 6 ספרות"
            />
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? "מאמתים…" : "אימות והתחברות"}
            </Button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                onClick={resendCode}
                disabled={busy || resendIn > 0}
              >
                {resendIn > 0 ? `שליחה חוזרת בעוד ${resendIn} שניות` : "שלחו קוד חדש"}
              </button>
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setStep("details");
                  setError("");
                }}
              >
                חזרה לפרטים
              </button>
            </div>
          </form>
        )}

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
