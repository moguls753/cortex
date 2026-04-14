# Classification - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Classification |
| Phase | 2 |
| Date | 2026-03-03 |
| Status | Draft |

## Objective

The Classification feature integrates with a configurable LLM provider (Anthropic, OpenAI, or any OpenAI-compatible endpoint such as LM Studio or Ollama chat) to automatically categorize every incoming thought into exactly one of five categories (people, projects, tasks, ideas, reference), extract structured metadata, and assign a confidence score. Classification is context-aware: before classifying, the system retrieves recent and semantically similar entries to help the LLM make consistent naming and categorization decisions. A configurable confidence threshold separates high-confidence results from uncertain ones that need human review. When classification fails, entries are stored without a category and retried automatically, ensuring no thought is ever lost.

## User Stories & Acceptance Criteria

**US-1: As a system, I want to classify any text input into exactly one of 5 categories using the configured LLM so that entries are automatically organized.**

- AC-1.1: Given text input, the system sends it to the configured LLM provider (determined by `llm_provider` setting: `anthropic` or `openai-compatible`) using the model specified in `llm_model` setting, with the classification prompt defined in `prompts/classify.md`.
- AC-1.2: The LLM returns valid JSON with the following fields: `category` (one of `people`, `projects`, `tasks`, `ideas`, `reference`), `name` (string, max 6 words), `confidence` (float, 0.0 to 1.0), `fields` (object, category-specific structured data), `tags` (array of lowercase strings), `create_calendar_event` (boolean), `calendar_date` (string in `YYYY-MM-DD` format, or null).
- AC-1.3: The system validates the JSON response against the expected schema. Validation checks: `category` is one of the five allowed values, `confidence` is a number between 0.0 and 1.0, `fields` is an object, `tags` is an array of strings, `create_calendar_event` is a boolean, `calendar_date` is either null or a valid date string.
- AC-1.4: If the LLM returns invalid JSON (parse error) or the parsed JSON fails schema validation, classification is treated as failed. The entry is stored with `category: null` and `confidence: null`.

**US-2: As a system, I want classification to be context-aware so that naming and categorization are consistent with existing entries.**

- AC-2.1: Before classifying, the system fetches the last 5 entries (ordered by `created_at` descending, excluding soft-deleted entries) from the database.
- AC-2.2: Before classifying, the system generates an embedding for the input text and performs a cosine similarity search to find the top 3 most similar entries (similarity threshold >= 0.5, excluding soft-deleted entries).
- AC-2.3: Context entries (from both recent and similar queries, deduplicated by ID) are formatted and injected into the classification prompt as the `{context_entries}` placeholder.
- AC-2.4: Each context entry in the prompt includes the entry's `name`, `category`, and a snippet of `content` (first 200 characters, or full content if shorter).

**US-3: As a system, I want a configurable confidence threshold so that uncertain classifications are flagged for review.**

- AC-3.1: The confidence threshold defaults to `0.6`.
- AC-3.2: The threshold is configurable via the `confidence_threshold` key in the `settings` table. The value is read at classification time (not cached at startup).
- AC-3.3: Entries with `confidence >= threshold` are considered "confident" and filed without further user intervention.
- AC-3.4: Entries with `confidence < threshold` are considered "uncertain" and flagged for review. In Telegram, this means showing inline category buttons for quick correction. On the dashboard, these entries are visually distinguished.

**US-4: As a system, I want classification failures to degrade gracefully so that no thought is lost.**

- AC-4.1: If the LLM API returns an error (timeout, rate limit 429, server error 5xx, network error), the entry is stored with `category: null` and `confidence: null`. The raw input text is preserved in the `content` field.
- AC-4.2: Entries with `category: null` are displayed on the web dashboard with an "unclassified" label, visually distinct from categorized entries.
- AC-4.3: A cron job runs periodically and retries classification for all entries where `category IS NULL` and `deleted_at IS NULL`. Successfully classified entries are updated with the returned category, name, fields, tags, and confidence.
- AC-4.4: Classification errors are logged with structured context: API response code, error message, entry ID, and the input text length.

## Constraints

- **Technical:** Classification uses the LLM provider abstraction (`src/llm/`). Two implementations: Anthropic SDK (`@anthropic-ai/sdk`) and OpenAI-compatible SDK (`openai` — covers LM Studio, Ollama chat, OpenAI, etc.). The provider is determined by the `llm_provider` setting.
- **Technical:** The classification prompt is stored in `prompts/classify.md` and loaded at runtime. Changes to the prompt file take effect on the next classification request without requiring a restart.
- **Technical:** The LLM's response must be pure JSON with no markdown fencing, no explanatory text, and no trailing content. The prompt explicitly instructs "Return ONLY valid JSON. No explanation. No markdown."
- **Technical:** The `create_calendar_event` and `calendar_date` fields from the LLM's response are ephemeral. They are used to trigger Google Calendar event creation (if configured) but are NOT stored in the database.
- **Operational:** LLM API rate limits apply. The system should respect rate limit headers and implement exponential backoff on 429 responses during retry cron runs.
- **Business:** Classification always produces exactly one category. Multi-category classification is not supported.
- **Business:** The five categories (people, projects, tasks, ideas, reference) are fixed and not user-configurable.

## Edge Cases

- **Confidence exactly at threshold (0.6):** An entry with `confidence` equal to the threshold (e.g., exactly 0.6 when threshold is 0.6) is treated as "confident" (greater-than-or-equal comparison).
- **LLM returns a category not in the allowed list:** Schema validation catches this. The entry is treated as a classification failure and stored with `category: null`.
- **LLM returns malformed JSON (truncated response):** JSON parsing fails. The entry is stored with `category: null` and the error is logged with the raw response body for debugging.
- **LLM API rate limit (429 response):** The entry is stored with `category: null`. The retry cron will attempt classification again. During cron retries, the system implements exponential backoff if it encounters consecutive 429 responses.
- **Very short input ("Hi"):** The system still sends it to the LLM for classification. The LLM should return a category (likely `reference` or `ideas`) with an appropriately low confidence score.
- **Very long input (thousands of words):** The system sends the full text to the LLM. If the input exceeds the model's context window, the API returns an error. The system should truncate the `content` portion of the prompt (preserving the classification instructions and context entries) to fit within the model's token limit.
- **Input in German:** The classification prompt is in English, but the LLM can classify German input and return English category names and tags. The `name` field may be in the input language.
- **Input with no clear category:** The LLM should still return a classification with a low confidence score (below threshold). The entry is flagged for user review.
- **Context entries are empty (brand new system with no entries):** The `{context_entries}` placeholder is replaced with a note like "No existing entries yet." Classification proceeds without context. This is the normal state on first use.
- **Duplicate context entries (same entry appears in both recent and similar results):** Context entries are deduplicated by entry ID before formatting. Each entry appears at most once in the prompt.
- **LLM returns confidence as a string instead of a number:** Schema validation catches type mismatches. If the value is a numeric string (e.g., "0.85"), the system coerces it to a number. If it is not numeric, classification is treated as failed.
- **Settings table has `confidence_threshold` set to an invalid value (e.g., negative or > 1.0):** The system clamps the threshold to the valid range [0.0, 1.0] and logs a warning.

## Non-Goals

- **Using embedding-only models for classification:** Ollama's embedding models (e.g., qwen3-embedding) are not used for classification. Classification requires a chat/instruct LLM via the provider abstraction.
- **Storing the raw LLM API response:** Only the parsed and validated fields are stored. The raw API response is not persisted, though it may be logged at debug level for troubleshooting.
- **Re-classifying entries automatically when the prompt changes:** Editing the classification prompt does not trigger re-classification of existing entries. Only new entries and entries with `category: null` go through classification.
- **Classifying into multiple categories:** Every entry gets exactly one category. An entry about a person working on a project is classified into whichever category the LLM deems most relevant, following the decision tree (person-first, then project, then task, then idea, then reference).
- **Custom categories beyond the five defined ones:** The category list is hardcoded. Users cannot add, remove, or rename categories.
- **Automatic re-classification when entry content is edited:** If a user edits an entry's content in the webapp, the existing category is preserved. The user can manually change the category or use the "AI Suggest" button, but the system does not automatically re-classify.

## Open Questions

(None)
