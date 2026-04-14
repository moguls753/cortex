# Embedding - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Embedding |
| Phase | 2 |
| Date | 2026-03-03 |
| Status | Draft |

## Objective

The Embedding feature integrates with a locally-hosted Ollama instance running the qwen3-embedding model to generate 4096-dimensional vector embeddings for every entry in the system. These embeddings enable semantic search across the knowledge base, allowing users and AI tools to find entries by meaning rather than exact keyword matches. The feature includes startup verification, on-demand embedding generation during the capture flow, and a background retry mechanism to ensure no entry is permanently left without an embedding.

## User Stories & Acceptance Criteria

**US-1: As a system, I want to generate 4096-dimensional embeddings for any text input so that entries are semantically searchable.**

- AC-1.1: Given a text input, the system calls Ollama's `/api/embed` endpoint with model `qwen3-embedding` and returns a 4096-dimensional float array.
- AC-1.2: Embeddings are generated correctly for English text.
- AC-1.3: Embeddings are generated correctly for German text.
- AC-1.4: Embeddings are generated correctly for mixed English/German text.

**US-2: As a system, I want Ollama connectivity verified on startup so that embedding failures are caught early.**

- AC-2.1: On startup, the system calls Ollama's `/api/tags` endpoint to verify connectivity.
- AC-2.2: If `qwen3-embedding` is not present in the model list returned by `/api/tags`, the system pulls it automatically by calling `ollama pull qwen3-embedding` (via Ollama's `/api/pull` endpoint).
- AC-2.3: If Ollama is unreachable on startup, the system logs a warning but does NOT crash. The application continues to start, and entries will be stored without embeddings until Ollama becomes available.

**US-3: As a system, I want entries with failed embeddings to be retried so that no entry is permanently unsearchable.**

- AC-3.1: If embedding generation fails for any reason (Ollama unreachable, model error, timeout), the entry is stored in the database with `embedding: null`.
- AC-3.2: A cron job runs every 15 minutes and queries all entries where `embedding IS NULL`.
- AC-3.3: For each entry with a null embedding, the cron job generates the embedding and updates the entry's `embedding` column in the database.
- AC-3.4: If a retry fails, the error is logged with context (entry ID, error message) and the entry is left with `embedding: null` for the next retry cycle.

## Constraints

- **Technical:** The embedding model is fixed to `qwen3-embedding`, which produces 4096-dimensional vectors. The database column is `vector(4096)` and cannot accept other dimensionalities.
- **Technical:** Ollama runs as a separate Docker container accessible at the URL configured via `OLLAMA_URL` (default: `http://ollama:11434`). The `ollama_url` settings table key overrides this value.
- **Technical:** The `/api/embed` endpoint accepts a single string input. The system must concatenate the entry's `name` and `content` fields into a single string for embedding.
- **Operational:** The first call to Ollama after model pull may be slow as the model loads into memory. The system should use a generous timeout (30 seconds) for embedding requests.
- **Operational:** The embedding retry cron should process entries sequentially (one at a time) to avoid overwhelming Ollama with concurrent requests.
- **Business:** Embeddings are used exclusively for cosine similarity search. The HNSW index is configured with `vector_cosine_ops`.

## Edge Cases

- **Very short text (single word):** Ollama should still return a valid 4096-dimensional embedding. The system should not reject short inputs.
- **Very long text (> 8192 tokens):** qwen3-embedding has a context window limit. If the input exceeds the model's maximum, the system should truncate the text to fit within the limit before sending to Ollama. Truncation should happen at a word boundary.
- **Ollama temporarily unreachable during normal operation:** The entry is stored with `embedding: null`. The 15-minute retry cron will pick it up. No user-facing error beyond the Telegram confirmation omitting semantic searchability.
- **Ollama model deleted between startup and embedding request:** The system receives an error from Ollama. It should log the error and attempt to re-pull the model on the next retry cycle (by checking `/api/tags` and pulling if missing).
- **Empty string input:** If both `name` and `content` are empty (or content is null and name is empty), the system should skip embedding generation and log a warning. The entry is stored with `embedding: null`.
- **Text with special characters, emojis, or non-Latin scripts:** qwen3-embedding is a multilingual model. The system passes text as-is without stripping special characters. Ollama handles tokenization.
- **Multiple entries queued for retry at the same time:** The cron job processes entries sequentially, oldest first (by `created_at`), to ensure consistent ordering and avoid overloading Ollama.
- **Ollama returns a vector with wrong dimensionality:** The system should validate that the returned array has exactly 4096 elements before storing. If not, log an error and treat it as a failed embedding.

## Non-Goals

- **Embedding model switching at runtime:** The model is fixed to `qwen3-embedding`. Changing the model would require re-embedding all existing entries. This is listed as a future possibility in the architecture but is not part of this feature.
- **Batch embedding of multiple entries in one API call:** Each entry is embedded individually. Ollama's `/api/embed` endpoint supports single inputs, and batching adds complexity without meaningful benefit at the expected volume.
- **Caching embeddings for identical text:** If two entries have identical text, each gets its own embedding generated independently. Deduplication is not worth the complexity.
- **Using embeddings for anything other than cosine similarity search:** Embeddings are not used for clustering, dimensionality reduction, visualization, or any other purpose.
- **Re-embedding entries when content is edited:** When an entry's content changes, the embedding is regenerated as part of the update flow. However, proactive re-embedding of all entries (e.g., after a model change) is out of scope.

## Open Questions

(None)
