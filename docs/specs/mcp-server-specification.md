# MCP Server - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | MCP Server |
| Phase | 5 |
| Date | 2026-03-03 |
| Status | Draft |

## Objective

Expose the brain to any AI tool via Model Context Protocol. The MCP server provides a fixed set of 7 tools that allow AI tools to search, capture, browse, read, update, delete, and summarize entries in the brain. Two transport modes are supported: stdio for local AI tools (e.g., Claude Code, Cursor) and Streamable HTTP for remote access. The server is implemented using the official `@modelcontextprotocol/sdk` package.

Local access works via `docker exec` into the running container, communicating over stdin/stdout through `src/mcp.ts` as a separate entrypoint. Remote access is handled by the Hono web server at `/mcp` using Streamable HTTP transport, sharing the same port and session authentication as the web dashboard. All tools respect soft delete, never expose database internals beyond UUIDs, and degrade gracefully when dependencies (Ollama, Claude) are unavailable.

## User Stories & Acceptance Criteria

### US-1: Semantic Search

**As an AI tool, I want to search the brain by meaning so I can find relevant context.**

- **AC-1.1:** `search_brain` accepts `{ query: string, limit?: number }`.
- **AC-1.2:** The query is embedded using Ollama (qwen3-embedding, 4096 dimensions) and compared against stored entry embeddings via cosine similarity.
- **AC-1.3:** Only results with similarity >= 0.5 are returned.
- **AC-1.4:** Results are ranked by similarity score, highest first.
- **AC-1.5:** Default limit is 10. Maximum limit is 50. If the caller provides a limit greater than 50, it is clamped to 50.
- **AC-1.6:** Each result includes: `id` (UUID), `category`, `name`, `content` (truncated to 500 characters), `tags`, `similarity` (float), `created_at`.
- **AC-1.7:** Soft-deleted entries (where `deleted_at` is not null) are excluded from results.

### US-2: Thought Capture

**As an AI tool, I want to capture thoughts so they're classified and stored.**

- **AC-2.1:** `add_thought` accepts `{ text: string }`.
- **AC-2.2:** The text goes through the context-aware classification pipeline: the system fetches the last 5 recent entries and the top 3 semantically similar entries as context, then sends the text and context to Claude with the classification prompt. Claude returns structured JSON containing `category`, `name`, `confidence`, `fields`, `tags`.
- **AC-2.3:** An embedding is generated for the text using Ollama (qwen3-embedding, 4096 dimensions).
- **AC-2.4:** The entry is stored in PostgreSQL with `source: 'mcp'`, `source_type: 'text'`, the raw text as `content`, and all fields from the classification response.
- **AC-2.5:** Returns: `id` (UUID), `category`, `name`, `confidence`, `tags`.

### US-3: Browse Recent Entries

**As an AI tool, I want to browse recent entries.**

- **AC-3.1:** `list_recent` accepts `{ days?: number, category?: string }`.
- **AC-3.2:** Default `days` is 7. The query returns entries with `created_at` within the last N days.
- **AC-3.3:** If `category` is specified, only entries matching that category are returned. The category must be one of: `people`, `projects`, `tasks`, `ideas`, `reference`.
- **AC-3.4:** Results are ordered by `created_at` descending (newest first).
- **AC-3.5:** Each entry includes: `id` (UUID), `category`, `name`, `tags`, `created_at`, `updated_at`.
- **AC-3.6:** Soft-deleted entries (where `deleted_at` is not null) are excluded from results.

### US-4: Read a Specific Entry

**As an AI tool, I want to read a specific entry in full.**

- **AC-4.1:** `get_entry` accepts `{ id: string }` where `id` is a UUID.
- **AC-4.2:** Returns the full entry: `id`, `category`, `name`, `content`, `fields`, `tags`, `confidence`, `source`, `source_type`, `created_at`, `updated_at`.
- **AC-4.3:** If the ID does not exist in the database, returns an error message: `"Entry not found"`.
- **AC-4.4:** If the entry has been soft-deleted (`deleted_at` is not null), returns an error message: `"Entry has been deleted"`.

### US-5: Update an Existing Entry

**As an AI tool, I want to update an existing entry.**

- **AC-5.1:** `update_entry` accepts `{ id: string, name?: string, content?: string, category?: string, tags?: string[], fields?: object }`. All fields except `id` are optional.
- **AC-5.2:** Only provided fields are updated (partial update). Fields not included in the request are left unchanged.
- **AC-5.3:** If `content` or `name` changes, the embedding is re-generated using Ollama. The new embedding is computed from the updated content (or name if content is empty).
- **AC-5.4:** If `category` changes, the provided `fields` should be compatible with the new category's schema. If `category` changes but no `fields` are provided, the existing fields are preserved as-is (they may not match the new category schema, but this is the caller's responsibility).
- **AC-5.5:** Returns the updated entry with all fields: `id`, `category`, `name`, `content`, `fields`, `tags`, `confidence`, `source`, `source_type`, `created_at`, `updated_at`.
- **AC-5.6:** If the ID does not exist in the database, returns an error message: `"Entry not found"`.
- **AC-5.7:** If the entry has been soft-deleted (`deleted_at` is not null), returns an error message: `"Entry has been deleted"` and the update is not applied.

### US-6: Delete an Entry

**As an AI tool, I want to delete an entry.**

- **AC-6.1:** `delete_entry` accepts `{ id: string }` where `id` is a UUID.
- **AC-6.2:** Performs a soft delete by setting `deleted_at` to the current timestamp. The entry is not physically removed from the database.
- **AC-6.3:** Returns a confirmation message: `"Entry deleted"`.
- **AC-6.4:** If the ID does not exist in the database, returns an error message: `"Entry not found"`.
- **AC-6.5:** If the entry is already soft-deleted (`deleted_at` is not null), returns: `"Entry is already deleted"`.

### US-7: Brain Statistics

**As an AI tool, I want an overview of what's in the brain.**

- **AC-7.1:** `brain_stats` accepts `{}` (no parameters).
- **AC-7.2:** Returns:
  - `total_entries`: total count of active (non-deleted) entries.
  - `by_category`: an object with counts per category (e.g., `{ "people": 12, "projects": 5, "tasks": 8, "ideas": 15, "reference": 3 }`). Categories with zero entries are included with a count of 0.
  - `entries_this_week`: count of entries created in the current calendar week.
  - `open_tasks`: count of entries where `category` is `tasks` and `fields->>'status'` is `pending`.
  - `stalled_projects`: count of entries where `category` is `projects`, `fields->>'status'` is `active`, and `updated_at` is older than 5 days.
  - `recent_activity`: an array of objects `{ date: string, count: number }` for each of the last 7 days, showing how many entries were created per day.
- **AC-7.3:** Soft-deleted entries (where `deleted_at` is not null) are excluded from all counts and statistics.

### US-8: Stdio Transport

**As a user, I want to access MCP via stdio for local AI tools.**

- **AC-8.1:** `src/mcp.ts` is a separate entrypoint (not part of the main `src/index.ts` startup) that runs the MCP server over stdin/stdout. It is compiled to `dist/mcp.js`.
- **AC-8.2:** The stdio server is invoked via `docker exec -i cortex-app-1 node dist/mcp.js`. AI tools configure this command in their MCP settings (e.g., Claude Code's `mcpServers` configuration).
- **AC-8.3:** The server implements the MCP protocol using the `@modelcontextprotocol/sdk` package. It registers all 7 tools with their input schemas and descriptions.

### US-9: Streamable HTTP Transport

**As a user, I want to access MCP via HTTP for remote AI tools.**

- **AC-9.1:** The Hono web server exposes an MCP endpoint at `/mcp`.
- **AC-9.2:** The endpoint uses Streamable HTTP transport as provided by the `@modelcontextprotocol/sdk` package.
- **AC-9.3:** The endpoint requires session authentication, identical to the webapp's cookie-based auth. Requests must include a valid session cookie.
- **AC-9.4:** Unauthenticated requests to `/mcp` return HTTP 401 Unauthorized.

## Constraints

### Security

- MCP tools must not expose database internals. No raw SQL queries, no internal database IDs beyond UUID, no table names, no column names in error messages. Error messages are user-facing strings.
- All tools respect soft delete. Deleted entries are never returned in search results, listings, or statistics. Only `get_entry` and `delete_entry` explicitly acknowledge deleted entries with a specific error message.
- HTTP transport shares the Hono server (same port, same authentication middleware). No separate server process or port is needed for HTTP MCP.

### Destructive Operations

- `update_entry` and `delete_entry` are destructive operations. The MCP protocol does not include a confirmation step. AI tools calling these tools are responsible for confirming intent with the user if appropriate. Cortex executes the operation immediately upon receiving the tool call.

### Dependencies

- `search_brain` and `add_thought` depend on Ollama for embedding generation. If Ollama is unavailable, these tools return errors rather than partial results.
- `add_thought` depends on Claude API for classification. If Claude is unavailable, the thought is stored with `category: null` and `confidence: null`, and a partial result is returned.
- All tools depend on PostgreSQL. If the database is unreachable, all tools return errors.

### Protocol

- The MCP server implements the tools capability only. It does not implement resources, prompts, or sampling capabilities.
- Tool names use snake_case. Tool descriptions are concise and describe what the tool does, not how to use it.
- All tool inputs and outputs are JSON.

## Edge Cases

### search_brain

- **Empty query (empty string or whitespace only):** Returns an error: `"Query cannot be empty"`.
- **Ollama is down or unreachable:** Returns an error: `"Embedding service unavailable"`. No partial results, no fallback to text search.
- **Query matches no entries above the 0.5 threshold:** Returns an empty results array (not an error).
- **Database has no entries at all:** Returns an empty results array.
- **Limit is 0 or negative:** Treated as the default (10).

### add_thought

- **Empty text (empty string or whitespace only):** Returns an error: `"Text cannot be empty"`.
- **Claude API is down or returns an error:** The entry is stored with `category: null`, `confidence: null`, and `fields: {}`. The embedding is still generated if Ollama is available. Returns a partial result with `category: null` and `confidence: null`.
- **Claude API returns malformed JSON:** Treated the same as Claude being down. Entry stored unclassified.
- **Ollama is down:** The entry is stored with `embedding: null`. Classification proceeds normally. The entry is browsable but not searchable via semantic search until the embedding retry cron processes it.

### get_entry

- **Invalid UUID format (not a valid UUID string):** Returns an error: `"Invalid entry ID"`.
- **Valid UUID but entry does not exist:** Returns an error: `"Entry not found"`.
- **Entry is soft-deleted:** Returns an error: `"Entry has been deleted"`.

### update_entry

- **Invalid UUID format:** Returns an error: `"Invalid entry ID"`.
- **Entry does not exist:** Returns an error: `"Entry not found"`.
- **Entry is soft-deleted:** Returns an error: `"Entry has been deleted"`. The update is not applied.
- **Invalid category value (not one of the 5 valid categories):** Returns an error: `"Invalid category"`.
- **Only `tags` or `fields` change (no `content` or `name` change):** The embedding is NOT re-generated. Only the specified fields are updated.
- **Empty update (no optional fields provided, just the `id`):** No changes are made. Returns the entry as-is.
- **Ollama is down when re-embedding is needed:** The content/name update is applied, but the embedding is set to `null`. The embedding retry cron will regenerate it later.

### delete_entry

- **Invalid UUID format:** Returns an error: `"Invalid entry ID"`.
- **Entry does not exist:** Returns an error: `"Entry not found"`.
- **Entry already soft-deleted:** Returns: `"Entry is already deleted"`.
- **Entry was just created (within the same second):** Deletion works normally. There is no minimum age requirement.

### brain_stats

- **Empty database (no entries at all):** Returns all zeros: `total_entries: 0`, all categories at 0, `entries_this_week: 0`, `open_tasks: 0`, `stalled_projects: 0`, `recent_activity` shows 7 days each with `count: 0`.

### Transport

- **Multiple AI tools calling MCP simultaneously (HTTP transport):** Each request is independent. No shared state between requests. No mutex or locking.
- **HTTP MCP with expired session cookie:** Returns HTTP 401 Unauthorized.
- **HTTP MCP with no session cookie:** Returns HTTP 401 Unauthorized.
- **Stdio MCP with no database connection:** Each tool call returns an error specific to the operation (e.g., `"Database unavailable"`). The MCP server process does not crash.
- **Stdio MCP process is killed mid-request:** The MCP protocol handles disconnection. No cleanup is needed beyond what the OS provides.

## Non-Goals

- **MCP subscriptions or streaming updates.** The server does not push notifications to connected clients. AI tools must poll or re-query for updated data.
- **Batch operations.** There is no tool to update or delete multiple entries in a single call. Each operation targets one entry.
- **File upload via MCP.** The MCP server does not accept file attachments (images, PDFs, etc.).
- **MCP authentication beyond session cookies.** No API key authentication, no token-based auth, no OAuth. HTTP transport uses the same session cookie mechanism as the webapp.
- **Custom tool registration.** The set of 7 tools is fixed. There is no mechanism for AI tools to register additional tools at runtime.
- **MCP resources or prompts capabilities.** The server implements only the tools capability. It does not serve resources (files, data) or prompt templates via MCP.
- **Search by tags or category via `search_brain`.** The `search_brain` tool is semantic only. Filtering by category or tags is done via `list_recent` or by the AI tool post-processing results.
- **Pagination.** Tools return all matching results up to their limit. There is no cursor or offset-based pagination.

## Open Questions

None.
