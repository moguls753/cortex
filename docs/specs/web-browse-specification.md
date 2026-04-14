# Web Browse - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Web Browse |
| Phase | 4 |
| Date | 2026-03-03 |
| Status | Draft |

## Objective

Allow browsing, filtering, and searching entries by category, tags, semantic meaning, and text. The browse page is the primary way to explore the knowledge base beyond the dashboard's recent entries view.

## User Stories & Acceptance Criteria

### US-1: As a user, I want to browse entries filtered by category.

- **AC-1.1:** The browse page (`GET /browse`) shows all five categories (People, Projects, Tasks, Ideas, Reference) as filter tabs or buttons.
- **AC-1.2:** Clicking a category shows only entries in that category.
- **AC-1.3:** An "All" option shows entries across all categories (this is the default view).
- **AC-1.4:** Soft-deleted entries (where `deleted_at` is not null) are NOT shown.
- **AC-1.5:** Results are ordered by `updated_at` descending (most recently updated first).

### US-2: As a user, I want semantic search to find entries by meaning.

- **AC-2.1:** A search bar at the top of the browse page accepts natural language queries (e.g., "what do I know about career changes").
- **AC-2.2:** The query is embedded using Ollama (qwen3-embedding) and compared against entry embeddings via cosine similarity in pgvector.
- **AC-2.3:** Only results with similarity >= 0.5 are shown (entries below this threshold are excluded).
- **AC-2.4:** Results are ranked by similarity score (highest first). Similarity scores are not displayed to the user.
- **AC-2.5:** Search can be combined with a category filter (e.g., search "budget" within Projects only).

### US-3: As a user, I want text search as a fallback for exact matches.

- **AC-3.1:** If semantic search returns no results (all similarities below 0.5), text search runs automatically as a fallback.
- **AC-3.2:** Text search matches against the entry `name` and `content` fields.
- **AC-3.3:** Text search is case-insensitive.
- **AC-3.4:** Text search can be explicitly triggered by the user (e.g., via a toggle or a separate input), allowing the user to bypass semantic search when they know the exact words.

### US-4: As a user, I want to filter by tags.

- **AC-4.1:** Tags are shown as clickable filter pills or buttons.
- **AC-4.2:** Clicking a tag shows only entries that have that tag.
- **AC-4.3:** Tag filter can be combined with category filter and search (all filters are additive/AND logic).
- **AC-4.4:** The tag list dynamically shows only tags that exist in the current filtered set (e.g., when filtering by "Projects," only tags used by project entries are shown).

## Constraints

- The browse page is server-rendered HTML via Hono templates. Filter interactions can use either full page reloads with query parameters or lightweight client-side JavaScript for a smoother experience.
- Semantic search requires Ollama to be available. If Ollama is down, the search falls back to text search only (with a notice to the user).
- Entries without embeddings (`embedding IS NULL`) are excluded from semantic search results but are included in text search results and category/tag browsing.
- The cosine similarity threshold of 0.5 is applied at the database query level using pgvector's cosine distance operator.
- The browse page requires authentication (session cookie).
- Filter state (selected category, search query, selected tags) should be reflected in the URL query parameters so the page can be bookmarked or shared.

## Edge Cases

- **Search query that matches nothing:** Show a "No results found" message with a suggestion to try different terms or broaden the search.
- **Very long search query:** Truncate or limit the input to a reasonable length (e.g., 500 characters). Ollama can handle long inputs, but excessively long queries may produce poor embeddings.
- **Search in German:** Semantic search works for German because qwen3-embedding supports multilingual embeddings (EN+DE). Text search also works for German as it is a simple case-insensitive substring match.
- **Empty database (no entries):** Show an empty state message (e.g., "No entries yet. Start capturing thoughts via the dashboard or Telegram.").
- **Entries with no tags:** These entries are shown in the "All" tag view but are excluded when a specific tag filter is active.
- **Entries with no embedding:** These entries appear in category browsing and text search but are excluded from semantic search results. They are not flagged differently on the browse page (they simply do not appear in semantic results).
- **Combining all filters:** When category, tag, and search are all active, the results must satisfy all three conditions (AND logic).
- **Category filter with no entries:** If a category has zero entries, clicking it shows an empty result with a message.

## Non-Goals

- Pagination (for datasets under approximately 1000 entries, all results fit on a single page). Pagination can be added later if needed.
- Saved searches or search bookmarks stored in the database.
- Search history or recent searches.
- Exporting search results (CSV, JSON, etc.).
- Full-text search indexing (PostgreSQL `tsvector`). Simple `ILIKE` matching is sufficient for the current scale.
- Advanced query syntax (boolean operators, field-specific search).
- Sorting options beyond the default `updated_at` descending (semantic search overrides with similarity ranking).

## Resolved Questions

- **Text search fallback notification:** Show a notice (e.g., "No semantic matches found, showing text results instead") so the user understands which search mode produced results.
- **Filter interaction model:** Query parameters + full page reload. Filter state in URL (`?category=Projects&tag=budget&q=search+term`). Consistent with server-rendered approach, bookmarkable.
- **Tag selection:** Single tag only. Clicking another tag switches the filter (not additive). Clicking the currently active tag deselects it (clears the tag filter). Keeps the UI simple; multi-tag can be added later.
- **Tag display limit:** Show up to 10 tags, collapse the rest behind a "show more" control.
