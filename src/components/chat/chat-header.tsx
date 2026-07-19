import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogIn, MessageCircleQuestion } from "lucide-react";

/**
 * כותרת הצ'אט. כפתור ההתחברות (FR-10) מופעל בדגל סביבה — יידלק בשלב 2
 * כשכרטיס ההתחברות בתוך הצ'אט ייבנה. עד אז הכפתור לא מוצג.
 */
const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

export function ChatHeader({ onLoginClick }: { onLoginClick?: () => void }) {
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
        {AUTH_ENABLED ? (
          <Button variant="outline" size="sm" onClick={onLoginClick}>
            <LogIn aria-hidden />
            התחברו כדי לשאול על הביטוחים שלכם
          </Button>
        ) : (
          <Badge variant="secondary">שאלות כלליות</Badge>
        )}
      </div>
    </header>
  );
}
