import { createHash } from "crypto";
import OpenAI from "openai";

// Lazy — OpenAI constructor throws if apiKey is missing, which breaks
// `next build` when embeddings aren't in use. Instantiate on first call.
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set — required for embedding generation",
    );
  }
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/**
 * Concatenate non-null text fields into a single embedding string.
 * Filters out null/undefined/empty values before joining.
 */
export function buildEmbeddingText(fields: (string | null | undefined)[]): string {
  return fields
    .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    .join(" ");
}

/**
 * Compute a SHA-256 hash of the text for change detection.
 */
export function computeContentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Generate an embedding vector via OpenAI text-embedding-3-small.
 * Returns a float array of 1536 dimensions.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Format a number[] embedding as a pgvector literal string.
 * Example: [0.1, 0.2, ...] → '[0.1,0.2,...]'
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
