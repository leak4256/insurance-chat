import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import type { UIMessage } from "ai";

interface Source {
  document: string;
  page: number | null;
}

/**
 * ציטוטי מקור (FR-6): נגזרים מתוצאות הכלי search_knowledge שבתוך חלקי ההודעה.
 */
export function extractSources(message: UIMessage): Source[] {
  const sources = new Map<string, Source>();
  for (const part of message.parts) {
    if (part.type !== "tool-search_knowledge") continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    const output = part.output as
      | { found: boolean; chunks: { document: string; page: number | null }[] }
      | undefined;
    if (!output?.found) continue;
    for (const chunk of output.chunks) {
      const key = `${chunk.document}#${chunk.page ?? ""}`;
      if (!sources.has(key)) sources.set(key, { document: chunk.document, page: chunk.page });
    }
  }
  return [...sources.values()];
}

export function SourceChips({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="מקורות">
      {sources.map((s) => (
        <Badge key={`${s.document}#${s.page ?? ""}`} variant="outline" className="text-muted-foreground">
          <FileText className="h-3 w-3" aria-hidden />
          {s.document}
          {s.page != null && <span>· עמ&#39; {s.page}</span>}
        </Badge>
      ))}
    </div>
  );
}
