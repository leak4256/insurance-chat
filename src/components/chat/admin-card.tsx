"use client";

import { useState } from "react";
import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * מצב מנהל (בדיקות): כניסה בקוד למייל מורשה, ואז בחירת לקוח מ-Surense לפי
 * ת"ז + אימייל. אחרי הבחירה הצ'אט עובד כאילו הלקוח עצמו התחבר.
 * מנהל שכבר מחובר נכנס ישר לשלב בחירת הלקוח (החלפת לקוח).
 */

type Step = "email" | "code" | "customer";

async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

const ltrInput = "text-right placeholder:text-right";

export function AdminCard({
  alreadyAdmin,
  onAdminLogin,
  onSelected,
  onCancel,
}: {
  alreadyAdmin: boolean;
  onAdminLogin: () => void;
  onSelected: (firstName: string, fullName: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>(alreadyAdmin ? "customer" : "email");
  const [adminEmail, setAdminEmail] = useState("");
  const [code, setCode] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch {
      setError("משהו השתבש. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { status, data } = await postJson("/api/admin-chat/start", { email: adminEmail });
      if (status !== 200 || !data.ok) return setError(String(data.error ?? "משהו השתבש."));
      setPendingId(String(data.pendingId ?? ""));
      setInfo(String(data.message ?? ""));
      setCode("");
      setStep("code");
    });
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { status, data } = await postJson("/api/admin-chat/verify", { pendingId, code });
      if (status === 200 && data.ok) {
        onAdminLogin();
        setStep("customer");
        return;
      }
      setError(String(data.error ?? "הקוד שגוי."));
      if (data.expired) setStep("email");
    });
  };

  const submitCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { status, data } = await postJson("/api/admin-chat/select", {
        idNumber,
        email: customerEmail,
      });
      if (status === 200 && data.ok) {
        onSelected(String(data.firstName ?? ""), String(data.fullName ?? ""));
        return;
      }
      setError(String(data.error ?? "הלקוח לא נמצא."));
      if (data.expired) setStep("email");
    });
  };

  const subtitle =
    step === "email"
      ? "כניסה למצב בדיקות — קוד יישלח למייל"
      : step === "code"
        ? "הזינו את הקוד שנשלח למייל"
        : "בחרו לקוח מ-Surense";

  return (
    <div className="flex w-full justify-start">
      <div className="w-full max-w-sm rounded-2xl rounded-tr-md border border-amber-300 bg-amber-50/60 p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-800">
            <UserCog className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight">מצב מנהל</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        {step === "email" && (
          <form className="flex flex-col gap-2" onSubmit={submitEmail}>
            <Input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="אימייל מנהל"
              autoComplete="email"
              dir="ltr"
              className={ltrInput}
              required
              aria-label="אימייל מנהל"
            />
            <Button type="submit" disabled={busy || !adminEmail.trim()}>
              {busy ? "שולחים…" : "שלחו קוד"}
            </Button>
          </form>
        )}

        {step === "code" && (
          <form className="flex flex-col gap-2" onSubmit={submitCode}>
            {info && <p className="text-xs text-muted-foreground">{info}</p>}
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="● ● ● ● ● ●"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              className="text-center text-lg tracking-[0.5em]"
              maxLength={6}
              required
              autoFocus
              aria-label="קוד בן 6 ספרות"
            />
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? "מאמתים…" : "כניסה"}
            </Button>
          </form>
        )}

        {step === "customer" && (
          <form className="flex flex-col gap-2" onSubmit={submitCustomer}>
            <Input
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              placeholder="ת״ז הלקוח"
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              className={ltrInput}
              maxLength={12}
              required
              autoFocus
              aria-label="מספר תעודת זהות של הלקוח"
            />
            <Input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="אימייל הלקוח (כפי שמופיע ב-Surense)"
              autoComplete="off"
              dir="ltr"
              className={ltrInput}
              required
              aria-label="אימייל הלקוח"
            />
            <Button type="submit" disabled={busy || !idNumber.trim() || !customerEmail.trim()}>
              {busy ? "מחפשים ב-Surense…" : "צפייה כלקוח"}
            </Button>
          </form>
        )}

        <div className="mt-2 flex items-start justify-between gap-2">
          {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
          <button
            type="button"
            className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={onCancel}
          >
            סגירה
          </button>
        </div>
      </div>
    </div>
  );
}
