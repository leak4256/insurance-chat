import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { parseAllowedUrl } from "@/lib/web-sources";

export const metadata: Metadata = { title: "מסמך מקור" };

/**
 * דף צפייה במסמך מקור.
 *
 * הקישור בתשובה מצביע לכאן ולא ישירות ל-PDF, כי דפדפן שמוגדר (או ברירת מחדל
 * שלו) להוריד קובצי PDF יוריד גם קובץ שמוגש `inline`. מסמך שמוטמע בתוך דף
 * כן מוצג. ה-PDF עצמו מגיע מ-`/api/source`, שם נאכפת רשימת ההיתר.
 */
export default async function SourcePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await searchParams).url;
  const target = typeof raw === "string" ? parseAllowedUrl(raw) : null;

  if (!target) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-muted-foreground">
          המסמך הזה אינו זמין לצפייה. אפשר לחזור לצ&#39;אט ולשאול שוב.
        </p>
      </main>
    );
  }

  const file = `/api/source?url=${encodeURIComponent(target.toString())}`;

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm">
        <span className="truncate text-muted-foreground">{target.hostname}</span>
        <a
          href={target.toString()}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="flex shrink-0 items-center gap-1 underline hover:no-underline"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          פתיחה באתר המקורי
        </a>
      </header>

      <iframe src={file} title="מסמך מקור" className="w-full flex-1 border-0" />

      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
        אם המסמך אינו מוצג כאן (למשל בטלפון) —{" "}
        <a href={file} target="_blank" rel="noopener noreferrer" className="underline">
          פתחו אותו ישירות
        </a>
        .
      </p>
    </main>
  );
}
