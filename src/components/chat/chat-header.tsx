import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, MessageCircleQuestion, ShieldCheck } from "lucide-react";

/**
 * כותרת הצ'אט (FR-10): כל עוד המשתמש לא מזוהה — כפתור התחברות עם כיתוב מזמין;
 * אחרי הזדהות — תג "מחובר/ת" + ניתוק. אפשר לכבות עם NEXT_PUBLIC_AUTH_ENABLED=false.
 */
const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED !== "false";

export interface AuthState {
  authenticated: boolean;
  firstName?: string;
}

export function ChatHeader({
  auth,
  onLoginClick,
  onLogout,
}: {
  auth: AuthState;
  onLoginClick?: () => void;
  onLogout?: () => void;
}) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MessageCircleQuestion className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">העוזר הדיגיטלי של הסוכנות</h1>
            <p className="text-xs text-muted-foreground">שאלות על ביטוח, בפשטות ובעברית</p>
          </div>
        </div>
        {!AUTH_ENABLED ? (
          <Badge variant="secondary">שאלות כלליות</Badge>
        ) : auth.authenticated ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              {auth.firstName ? `מחובר/ת · ${auth.firstName}` : "מחובר/ת"}
            </Badge>
            <Button variant="ghost" size="sm" onClick={onLogout} aria-label="ניתוק">
              <LogOut aria-hidden />
              ניתוק
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={onLoginClick}>
            <LogIn aria-hidden />
            התחברו כדי לשאול על הביטוחים שלכם
          </Button>
        )}
      </div>
    </header>
  );
}
