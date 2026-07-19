import { embedder } from "./embedder";
import { getSupabase } from "@/lib/supabase";
import { config } from "@/lib/config";

export const INSURANCE_DOMAINS = ["רכב", "דירה", "בריאות", "חיים", "נסיעות", "עסק", "כללי"] as const;

export interface RetrievedChunk {
  id: string;
  document_title: string;
  file_name: string;
  page: number | null;
  section_title: string | null;
  domain: string | null;
  content: string;
  similarity: number;
}

/**
 * אחזור קטעים ממאגר הידע: embedding לשאילתה + חיפוש דמיון ב-pgvector.
 */
export async function searchKnowledge(
  query: string,
  options?: { domain?: string; matchCount?: number },
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embedder.embedQuery(query);
  const { data, error } = await getSupabase().rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_count: options?.matchCount ?? config.rag.matchCount,
    filter_domain: options?.domain ?? null,
  });
  if (error) throw new Error(`match_chunks failed: ${error.message}`);
  const chunks = (data ?? []) as RetrievedChunk[];
  return chunks.filter((c) => c.similarity >= config.rag.minSimilarity);
}
