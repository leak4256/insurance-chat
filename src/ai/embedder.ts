/**
 * ממשק Embedder (אפיון 5.1): שאר הקוד תלוי בממשק בלבד.
 * החלפת ספק embeddings מחייבת אינדוקס מחדש של המסמכים.
 */
export interface Embedder {
  /** מזהה המודל — נשמר עם הקטעים כדי לזהות אי-התאמה באינדקס */
  readonly model: string;
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
/** Voyage מגביל עד 128 טקסטים לבקשה */
const VOYAGE_BATCH_LIMIT = 128;
/**
 * ניסיונות חוזרים על כשל רשת או שגיאה חולפת (429/5xx).
 * נדרש כי מאחורי סינון ה-TLS של NetFree החיבור הראשון מתהליך קר נתקע
 * ונופל ב-UND_ERR_CONNECT_TIMEOUT, והניסיון הבא מצליח מיד.
 */
const VOYAGE_MAX_ATTEMPTS = 3;
const VOYAGE_RETRY_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= VOYAGE_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(VOYAGE_URL, init);
      if (res.status !== 429 && res.status < 500) return res;
      lastError = new Error(`Voyage embeddings failed (${res.status}): ${await res.text()}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < VOYAGE_MAX_ATTEMPTS) await sleep(VOYAGE_RETRY_DELAY_MS * attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

class VoyageEmbedder implements Embedder {
  readonly model = process.env.EMBEDDING_MODEL ?? "voyage-3.5-lite";
  readonly dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1024);

  private async call(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) throw new Error("Missing required environment variable: VOYAGE_API_KEY");

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += VOYAGE_BATCH_LIMIT) {
      const batch = texts.slice(i, i + VOYAGE_BATCH_LIMIT);
      const res = await fetchWithRetry({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: batch,
          input_type: inputType,
          output_dimension: this.dimensions,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Voyage embeddings failed (${res.status}): ${body}`);
      }
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      results.push(...sorted.map((d) => d.embedding));
    }
    return results;
  }

  embedDocuments(texts: string[]) {
    return this.call(texts, "document");
  }

  async embedQuery(text: string) {
    const [embedding] = await this.call([text], "query");
    return embedding;
  }
}

export const embedder: Embedder = new VoyageEmbedder();
