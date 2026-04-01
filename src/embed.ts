import type postgres from "postgres";
import { createLogger } from "./logger.js";

const log = createLogger("embed");

const EMBEDDING_MODEL = "qwen3-embedding";
const EMBEDDING_DIM = 4096;
const MAX_TEXT_LENGTH = 32_000; // Conservative proxy for 8192 tokens
const REQUEST_TIMEOUT_MS = 30_000;

const defaultOllamaUrl = process.env.OLLAMA_URL || "http://ollama:11434";

/**
 * Concatenate entry name and content into a single string for embedding.
 * Returns null (with warning log) if both are empty.
 * Truncates at a word boundary if text exceeds the token limit proxy.
 */
export function prepareEmbeddingInput(entry: {
  name: string;
  content: string | null;
  category?: string | null;
  tags?: string[] | null;
  fields?: Record<string, unknown> | null;
}): string | null {
  const name = entry.name?.trim() || "";
  const content = entry.content?.trim() || "";

  if (!name && !content) {
    log.warn("Skipping embedding for entry with empty input");
    return null;
  }

  const parts: string[] = [];
  if (entry.category) parts.push(`[${entry.category}]`);
  if (name) parts.push(name);
  if (content) parts.push(content);
  if (entry.tags && entry.tags.length > 0) parts.push(entry.tags.join(", "));
  if (entry.fields) {
    const fieldParts = Object.entries(entry.fields)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}: ${v}`);
    if (fieldParts.length > 0) parts.push(fieldParts.join(", "));
  }

  let text = parts.join(" ");

  if (text.length > MAX_TEXT_LENGTH) {
    const truncated = text.substring(0, MAX_TEXT_LENGTH);
    const lastSpace = truncated.lastIndexOf(" ");
    text = lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
  }

  return text;
}

/**
 * Internal async implementation of embedding generation.
 */
async function doGenerateEmbedding(
  text: string,
  ollamaUrl: string,
): Promise<number[] | null> {
  const TIMEOUT = Symbol("timeout");

  const result = await new Promise<number[] | null | typeof TIMEOUT>(
    (resolve) => {
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(TIMEOUT);
        }
      }, REQUEST_TIMEOUT_MS);

      fetch(`${ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
      })
        .then(async (rawResponse) => {
          clearTimeout(timeoutId);
          if (settled) return;

          // Clone to avoid consuming the body of a shared mock Response
          const response = rawResponse.clone();

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            log.error("Ollama embed request failed", {
              status: response.status,
              error: (errorData as Record<string, unknown>).error,
            });
            settled = true;
            resolve(null);
            return;
          }

          const data = (await response.json()) as {
            embeddings?: number[][];
          };
          const embedding = data.embeddings?.[0];

          if (!embedding || embedding.length !== EMBEDDING_DIM) {
            log.error("Embedding has incorrect dimensions", {
              expected: EMBEDDING_DIM,
              got: embedding?.length ?? 0,
            });
            settled = true;
            resolve(null);
            return;
          }

          settled = true;
          resolve(embedding);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          log.error("Failed to generate embedding", {
            error: (error as Error).message,
          });
          resolve(null);
        });
    },
  );

  if (result === TIMEOUT) {
    throw new Error("Embedding request timeout after 30 seconds");
  }

  return result;
}

/**
 * Call Ollama /api/embed to generate a 4096-dim embedding for the given text.
 * Returns null on non-timeout errors (connection failure, bad response, wrong dimensions).
 * Throws on timeout (30s).
 */
export function generateEmbedding(
  text: string,
  baseUrl?: string,
): Promise<number[] | null> {
  const ollamaUrl = baseUrl || defaultOllamaUrl;
  const promise = doGenerateEmbedding(text, ollamaUrl);
  // Eagerly mark as handled to prevent unhandled-rejection warnings
  // when timeout fires during fake-timer advancement in tests.
  // Callers still observe the rejection via their own .then/.catch/await.
  promise.catch(() => {});
  return promise;
}

/**
 * Check if the embedding model is available in Ollama, pull if missing.
 */
async function ensureModel(ollamaUrl: string): Promise<void> {
  const rawResponse = await fetch(`${ollamaUrl}/api/tags`);
  const data = (await rawResponse.clone().json()) as {
    models?: { name: string }[];
  };
  const models = data.models?.map((m) => m.name) || [];

  const hasModel = models.some((name) => name.includes(EMBEDDING_MODEL));
  if (!hasModel) {
    log.info("Pulling embedding model (this may take a few minutes)", { model: EMBEDDING_MODEL });
    const pullResponse = await fetch(`${ollamaUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: EMBEDDING_MODEL, stream: true }),
    });
    // Ollama streams NDJSON progress — consume the entire body to wait for completion
    if (pullResponse.body) {
      for await (const _ of pullResponse.body) { /* drain */ }
    } else {
      await pullResponse.text();
    }
    log.info("Model pull complete", { model: EMBEDDING_MODEL });
  }
}

/**
 * Startup: verify Ollama connectivity and ensure the embedding model is available.
 * Logs a warning and continues if Ollama is unreachable.
 */
export async function initializeEmbedding(): Promise<void> {
  try {
    await ensureModel(defaultOllamaUrl);
  } catch {
    log.warn("Ollama is unreachable during initialization");
  }
}

/**
 * Generate and store an embedding for a single entry by ID.
 * On failure, the entry keeps its current embedding (or null).
 */
export async function embedEntry(
  sql: postgres.Sql,
  entryId: string,
): Promise<void> {
  const rows =
    await sql`SELECT name, content, category, tags, fields FROM entries WHERE id = ${entryId}`;
  if (rows.length === 0) {
    log.error("Entry not found for embedding", { entryId });
    return;
  }

  const entry = rows[0] as { name: string; content: string | null; category: string | null; tags: string[] | null; fields: Record<string, unknown> | null };
  const text = prepareEmbeddingInput(entry);
  if (!text) return;

  let embedding: number[] | null;
  try {
    embedding = await generateEmbedding(text);
  } catch (error) {
    log.error("Embedding generation failed for entry", {
      entryId,
      error: (error as Error).message,
    });
    return;
  }

  if (embedding) {
    const vecStr = `[${embedding.join(",")}]`;
    await sql`UPDATE entries SET embedding = ${vecStr}::vector WHERE id = ${entryId}`;
  }

  // Embed any other entries that are still missing embeddings
  const pending = await sql`
    SELECT id, name, content, category, tags, fields FROM entries
    WHERE embedding IS NULL AND deleted_at IS NULL AND id != ${entryId}
    ORDER BY created_at ASC
  `;
  for (const other of pending) {
    const otherText = prepareEmbeddingInput({
      name: other.name as string,
      content: other.content as string | null,
      category: other.category as string | null,
      tags: other.tags as string[] | null,
      fields: other.fields as Record<string, unknown> | null,
    });
    if (!otherText) continue;
    try {
      const otherEmbedding = await generateEmbedding(otherText);
      if (otherEmbedding) {
        const vecStr = `[${otherEmbedding.join(",")}]`;
        await sql`UPDATE entries SET embedding = ${vecStr}::vector WHERE id = ${other.id}`;
      }
    } catch {
      // will be picked up on next embedEntry call
    }
  }
}
