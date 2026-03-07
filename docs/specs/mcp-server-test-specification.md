# MCP Server - Test Specification

| Field | Value |
|-------|-------|
| Feature | MCP Server |
| Phase | 2 |
| Date | 2026-03-07 |
| Status | Draft |
| Source | `mcp-server-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|-----------------|------------------|
| AC-1.1: search_brain accepts query + optional limit | TS-1.1 |
| AC-1.2: Embeds query, cosine similarity | TS-1.1, TS-1.2 |
| AC-1.3: Similarity >= 0.5 threshold | TS-1.2 |
| AC-1.4: Ranked by similarity desc | TS-1.1 |
| AC-1.5: Default limit 10, max 50, clamp | TS-1.3, TS-1.4 |
| AC-1.6: Result shape (id, category, name, content truncated, tags, similarity, created_at) | TS-1.1 |
| AC-1.7: Excludes soft-deleted entries | TS-1.5 |
| EC-1.1: Empty query | TS-1.6 |
| EC-1.2: Ollama unavailable | TS-1.7 |
| EC-1.3: No matches above threshold | TS-1.8 |
| EC-1.4: Empty database | TS-1.9 |
| EC-1.5: Limit 0 or negative | TS-1.10 |
| AC-2.1: add_thought accepts text | TS-2.1 |
| AC-2.2: Context-aware classification pipeline | TS-2.1 |
| AC-2.3: Embedding generated | TS-2.1 |
| AC-2.4: Stored with source 'mcp', source_type 'text' | TS-2.1 |
| AC-2.5: Returns id, category, name, confidence, tags | TS-2.1 |
| EC-2.1: Empty text | TS-2.2 |
| EC-2.2: Claude API down | TS-2.3 |
| EC-2.3: Claude returns malformed JSON | TS-2.4 |
| EC-2.4: Ollama down during add_thought | TS-2.5 |
| AC-3.1: list_recent accepts days + category | TS-3.1 |
| AC-3.2: Default days is 7 | TS-3.1 |
| AC-3.3: Category filter (valid categories only) | TS-3.2, TS-3.3 |
| AC-3.4: Ordered by created_at desc | TS-3.1 |
| AC-3.5: Result shape (id, category, name, tags, created_at, updated_at) | TS-3.1 |
| AC-3.6: Excludes soft-deleted | TS-3.4 |
| AC-4.1: get_entry accepts id (UUID) | TS-4.1 |
| AC-4.2: Returns full entry | TS-4.1 |
| AC-4.3: Entry not found | TS-4.2 |
| AC-4.4: Entry is soft-deleted | TS-4.3 |
| EC-4.1: Invalid UUID format | TS-4.4 |
| AC-5.1: update_entry accepts partial fields | TS-5.1 |
| AC-5.2: Only provided fields updated | TS-5.1 |
| AC-5.3: Re-embed on content/name change | TS-5.2, TS-5.2b |
| AC-5.4: Category change preserves fields if none provided | TS-5.3 |
| AC-5.5: Returns updated entry with all fields | TS-5.1 |
| AC-5.6: Entry not found | TS-5.4 |
| AC-5.7: Soft-deleted entry | TS-5.5 |
| EC-5.1: Invalid UUID | TS-5.6 |
| EC-5.2: Invalid category | TS-5.7 |
| EC-5.3: Only tags/fields change — no re-embed | TS-5.8 |
| EC-5.4: Empty update (only id) | TS-5.9 |
| EC-5.5: Ollama down on re-embed | TS-5.10 |
| AC-6.1: delete_entry accepts id | TS-6.1 |
| AC-6.2: Soft delete (sets deleted_at) | TS-6.1 |
| AC-6.3: Returns "Entry deleted" | TS-6.1 |
| AC-6.4: Entry not found | TS-6.2 |
| AC-6.5: Already soft-deleted | TS-6.3 |
| EC-6.1: Invalid UUID | TS-6.4 |
| EC-6.2: Entry just created | TS-6.5 |
| AC-7.1: brain_stats accepts no params | TS-7.1 |
| AC-7.2: Returns all stat fields | TS-7.1 |
| AC-7.3: Excludes soft-deleted from stats | TS-7.2 |
| EC-7.1: Empty database | TS-7.3 |
| AC-8.1: Separate entrypoint (src/mcp.ts) | TS-8.1 |
| AC-8.2: Invoked via docker exec (deployment concern) | TS-8.1 (implicit — entrypoint exists) |
| AC-8.3: Registers all 7 tools | TS-8.2 |
| EC-8.1: No DB connection — tool returns error | TS-8.3 |
| AC-9.1: HTTP endpoint at /mcp | TS-9.1 |
| AC-9.2: Streamable HTTP transport | TS-9.1 |
| AC-9.3: Requires session authentication | TS-9.2 |
| AC-9.4: Unauthenticated returns 401 | TS-9.3 |
| EC-9.1: Expired session cookie | TS-9.4 |
| EC-9.2: No session cookie | TS-9.3 |
| C-1: No DB internals exposed | TS-10.1 |
| C-4: Tools capability only | TS-10.2 |
| C-5: Snake_case tool names | TS-10.3 |

## Test Scenarios

### Group 1: search_brain

**TS-1.1: Search with matching entries**
- Given entries exist in the brain with embeddings
- When `search_brain` is called with `{ query: "machine learning" }`
- Then results are returned as an array
- And each result includes `id`, `category`, `name`, `content`, `tags`, `similarity`, `created_at`
- And `content` is truncated to at most 500 characters
- And results are ordered by `similarity` descending
- And the default number of results is at most 10

**TS-1.2: Results below similarity threshold are excluded**
- Given entries exist but none have embeddings similar to the query (all cosine similarity < 0.5)
- When `search_brain` is called with `{ query: "completely unrelated topic" }`
- Then an empty results array is returned

**TS-1.3: Custom limit is respected**
- Given more than 3 matching entries exist
- When `search_brain` is called with `{ query: "test", limit: 3 }`
- Then at most 3 results are returned

**TS-1.4: Limit above 50 is clamped**
- Given matching entries exist
- When `search_brain` is called with `{ query: "test", limit: 100 }`
- Then at most 50 results are returned

**TS-1.5: Soft-deleted entries are excluded from search**
- Given a matching entry exists but has been soft-deleted
- When `search_brain` is called with a query matching the deleted entry
- Then the soft-deleted entry does not appear in results

**TS-1.6: Empty query returns error**
- Given the MCP server is running
- When `search_brain` is called with `{ query: "" }`
- Then an error is returned: "Query cannot be empty"
- And when called with `{ query: "   " }` (whitespace only)
- Then an error is returned: "Query cannot be empty"

**TS-1.7: Ollama unavailable returns error**
- Given Ollama is unreachable
- When `search_brain` is called with `{ query: "test" }`
- Then an error is returned: "Embedding service unavailable"

**TS-1.8: No matches above threshold returns empty array**
- Given entries exist but their embeddings are not similar to the query
- When `search_brain` is called with `{ query: "very specific niche topic" }`
- Then an empty results array is returned (not an error)

**TS-1.9: Empty database returns empty array**
- Given no entries exist in the database
- When `search_brain` is called with `{ query: "anything" }`
- Then an empty results array is returned (not an error)

**TS-1.10: Zero or negative limit uses default**
- Given matching entries exist
- When `search_brain` is called with `{ query: "test", limit: 0 }`
- Then the default limit of 10 is used
- And when called with `{ query: "test", limit: -5 }`
- Then the default limit of 10 is used

### Group 2: add_thought

**TS-2.1: Capture a thought successfully**
- Given the classification and embedding services are available
- When `add_thought` is called with `{ text: "Met with Sarah about the Q3 roadmap" }`
- Then the entry is stored in the database with `source: 'mcp'` and `source_type: 'text'`
- And the classification pipeline is invoked with context (last 5 recent + top 3 similar)
- And an embedding is generated for the text
- And the response includes `id` (UUID), `category`, `name`, `confidence`, `tags`

**TS-2.2: Empty text returns error**
- Given the MCP server is running
- When `add_thought` is called with `{ text: "" }`
- Then an error is returned: "Text cannot be empty"

**TS-2.3: Claude API unavailable stores entry unclassified**
- Given Ollama is available but the LLM API is unreachable
- When `add_thought` is called with `{ text: "Some thought" }`
- Then the entry is stored with `category: null`, `confidence: null`, `fields: {}`
- And an embedding is still generated
- And the response includes `category: null` and `confidence: null`

**TS-2.4: Claude returns malformed JSON stores entry unclassified**
- Given Ollama is available but the LLM returns invalid JSON
- When `add_thought` is called with `{ text: "Some thought" }`
- Then the entry is stored with `category: null`, `confidence: null`, `fields: {}`
- And the response includes `category: null` and `confidence: null`

**TS-2.5: Ollama unavailable stores entry without embedding**
- Given the LLM API is available but Ollama is unreachable
- When `add_thought` is called with `{ text: "Some thought" }`
- Then the entry is stored with `embedding: null`
- And classification proceeds normally
- And the response includes the classified `category`, `name`, `confidence`, `tags`

### Group 3: list_recent

**TS-3.1: List recent entries with defaults**
- Given entries exist from the last 7 days
- When `list_recent` is called with `{}`
- Then entries from the last 7 days are returned
- And each entry includes `id`, `category`, `name`, `tags`, `created_at`, `updated_at`
- And results are ordered by `created_at` descending

**TS-3.2: Filter by category**
- Given entries exist across multiple categories
- When `list_recent` is called with `{ category: "tasks" }`
- Then only entries with category "tasks" are returned

**TS-3.3: Invalid category returns error**
- Given the MCP server is running
- When `list_recent` is called with `{ category: "invalid_category" }`
- Then an error is returned: "Invalid category"

**TS-3.4: Soft-deleted entries are excluded from listing**
- Given a recent entry exists but has been soft-deleted
- When `list_recent` is called
- Then the soft-deleted entry does not appear in results

**TS-3.5: Custom days parameter**
- Given entries exist from 3 days ago and 10 days ago
- When `list_recent` is called with `{ days: 5 }`
- Then only entries from the last 5 days are returned

### Group 4: get_entry

**TS-4.1: Read an entry in full**
- Given an entry exists with known content
- When `get_entry` is called with `{ id: "<entry-uuid>" }`
- Then the full entry is returned including `id`, `category`, `name`, `content`, `fields`, `tags`, `confidence`, `source`, `source_type`, `created_at`, `updated_at`

**TS-4.2: Entry not found**
- Given no entry exists with the given UUID
- When `get_entry` is called with `{ id: "<nonexistent-uuid>" }`
- Then an error is returned: "Entry not found"

**TS-4.3: Soft-deleted entry returns specific error**
- Given an entry exists but has been soft-deleted
- When `get_entry` is called with the entry's UUID
- Then an error is returned: "Entry has been deleted"

**TS-4.4: Invalid UUID format returns error**
- Given the MCP server is running
- When `get_entry` is called with `{ id: "not-a-uuid" }`
- Then an error is returned: "Invalid entry ID"

### Group 5: update_entry

**TS-5.1: Partial update changes only provided fields**
- Given an entry exists with name "Old Name" and content "Old content"
- When `update_entry` is called with `{ id: "<uuid>", name: "New Name" }`
- Then the entry's name is "New Name"
- And the entry's content remains "Old content"
- And the response includes all entry fields (`id`, `category`, `name`, `content`, `fields`, `tags`, `confidence`, `source`, `source_type`, `created_at`, `updated_at`)

**TS-5.2: Content change triggers re-embedding**
- Given an entry exists with content "Old content"
- When `update_entry` is called with `{ id: "<uuid>", content: "New content" }`
- Then the embedding is re-generated for the new content

**TS-5.2b: Name change triggers re-embedding**
- Given an entry exists with name "Old Name"
- When `update_entry` is called with `{ id: "<uuid>", name: "New Name" }` (no content change)
- Then the embedding is re-generated using the updated name

**TS-5.3: Category change without fields preserves existing fields**
- Given an entry exists with category "tasks" and fields `{ status: "pending", priority: "high" }`
- When `update_entry` is called with `{ id: "<uuid>", category: "ideas" }` (no `fields` provided)
- Then the category is updated to "ideas"
- And the existing fields are preserved as-is

**TS-5.4: Update nonexistent entry returns error**
- Given no entry exists with the given UUID
- When `update_entry` is called with `{ id: "<nonexistent-uuid>", name: "New Name" }`
- Then an error is returned: "Entry not found"

**TS-5.5: Update soft-deleted entry returns error**
- Given an entry exists but has been soft-deleted
- When `update_entry` is called with `{ id: "<uuid>", name: "New Name" }`
- Then an error is returned: "Entry has been deleted"
- And the entry is not modified

**TS-5.6: Invalid UUID returns error**
- Given the MCP server is running
- When `update_entry` is called with `{ id: "not-a-uuid", name: "Test" }`
- Then an error is returned: "Invalid entry ID"

**TS-5.7: Invalid category returns error**
- Given an entry exists
- When `update_entry` is called with `{ id: "<uuid>", category: "invalid" }`
- Then an error is returned: "Invalid category"

**TS-5.8: Tags-only change does not re-embed**
- Given an entry exists with an embedding
- When `update_entry` is called with `{ id: "<uuid>", tags: ["new-tag"] }`
- Then the tags are updated
- And the embedding is NOT re-generated

**TS-5.9: Empty update returns entry unchanged**
- Given an entry exists
- When `update_entry` is called with `{ id: "<uuid>" }` (no optional fields)
- Then no changes are made
- And the entry is returned as-is

**TS-5.10: Ollama unavailable during re-embed**
- Given an entry exists and Ollama is unreachable
- When `update_entry` is called with `{ id: "<uuid>", content: "New content" }`
- Then the content is updated
- And the embedding is set to null

### Group 6: delete_entry

**TS-6.1: Soft delete an entry**
- Given an active entry exists
- When `delete_entry` is called with `{ id: "<uuid>" }`
- Then the entry's `deleted_at` is set to the current timestamp
- And the response is "Entry deleted"

**TS-6.2: Delete nonexistent entry returns error**
- Given no entry exists with the given UUID
- When `delete_entry` is called with `{ id: "<nonexistent-uuid>" }`
- Then an error is returned: "Entry not found"

**TS-6.3: Delete already-deleted entry returns error**
- Given an entry exists but has already been soft-deleted
- When `delete_entry` is called with the entry's UUID
- Then an error is returned: "Entry is already deleted"

**TS-6.4: Invalid UUID returns error**
- Given the MCP server is running
- When `delete_entry` is called with `{ id: "not-a-uuid" }`
- Then an error is returned: "Invalid entry ID"

**TS-6.5: Delete just-created entry works normally**
- Given an entry was just created (within the same second)
- When `delete_entry` is called with the entry's UUID
- Then the entry is soft-deleted successfully
- And the response is "Entry deleted"

### Group 7: brain_stats

**TS-7.1: Statistics with populated database**
- Given the database contains entries across multiple categories, including tasks with `status: "pending"` and projects with `status: "active"` updated more than 5 days ago
- When `brain_stats` is called with `{}`
- Then the response includes:
  - `total_entries`: count of active entries
  - `by_category`: counts per category (all 5 categories present, including zeros)
  - `entries_this_week`: count of entries created in the current calendar week
  - `open_tasks`: count of tasks with `status: "pending"`
  - `stalled_projects`: count of active projects not updated in 5+ days
  - `recent_activity`: array of 7 objects with `date` and `count`

**TS-7.2: Soft-deleted entries excluded from all stats**
- Given entries exist and some are soft-deleted
- When `brain_stats` is called
- Then soft-deleted entries are not counted in `total_entries`, `by_category`, `entries_this_week`, `open_tasks`, `stalled_projects`, or `recent_activity`

**TS-7.3: Empty database returns all zeros**
- Given no entries exist in the database
- When `brain_stats` is called
- Then `total_entries` is 0
- And all categories in `by_category` have count 0
- And `entries_this_week` is 0
- And `open_tasks` is 0
- And `stalled_projects` is 0
- And `recent_activity` has 7 entries each with `count: 0`

### Group 8: Stdio Transport

**TS-8.1: Separate entrypoint exists**
- Given the project is built
- When the stdio entrypoint module is loaded
- Then it creates an MCP server configured for stdio transport

**TS-8.2: All 7 tools are registered**
- Given the MCP server is initialized
- When the registered tools are inspected
- Then exactly 7 tools are registered: `search_brain`, `add_thought`, `list_recent`, `get_entry`, `update_entry`, `delete_entry`, `brain_stats`
- And each tool has a description and input schema

**TS-8.3: Database unavailable returns tool-level error**
- Given the database is unreachable
- When any MCP tool is called
- Then the tool returns an error (not a server crash)
- And the MCP server process remains running

### Group 9: HTTP Transport

**TS-9.1: MCP endpoint available at /mcp**
- Given the Hono web server is running
- When a valid authenticated MCP request is sent to `/mcp`
- Then the server responds using Streamable HTTP transport

**TS-9.2: Authenticated request succeeds**
- Given a user has a valid session cookie
- When an MCP request is sent to `/mcp` with the session cookie
- Then the request is processed normally

**TS-9.3: Unauthenticated request returns 401**
- Given no session cookie is included in the request
- When an MCP request is sent to `/mcp`
- Then the response is HTTP 401 Unauthorized

**TS-9.4: Expired session cookie returns 401**
- Given a user has an expired session cookie
- When an MCP request is sent to `/mcp` with the expired cookie
- Then the response is HTTP 401 Unauthorized

### Group 10: Constraints

**TS-10.1: Error messages do not expose database internals**
- Given various error conditions (not found, invalid input, service unavailable)
- When MCP tools return errors
- Then error messages are user-facing strings
- And no SQL, table names, column names, or internal database IDs appear in error messages

**TS-10.2: Server implements tools capability only**
- Given the MCP server is initialized
- When the server capabilities are inspected
- Then only the `tools` capability is advertised
- And no `resources`, `prompts`, or `sampling` capabilities are present

**TS-10.3: Tool names follow snake_case convention**
- Given the MCP server is initialized
- When the registered tool names are inspected
- Then all tool names are snake_case: `search_brain`, `add_thought`, `list_recent`, `get_entry`, `update_entry`, `delete_entry`, `brain_stats`

## Edge Case Scenarios

All edge cases from the behavioral specification are covered inline within their respective tool groups:

- **search_brain:** TS-1.6 (empty query), TS-1.7 (Ollama down), TS-1.8/TS-1.9 (no results), TS-1.10 (invalid limit)
- **add_thought:** TS-2.2 (empty text), TS-2.3 (Claude down), TS-2.4 (malformed JSON), TS-2.5 (Ollama down)
- **get_entry:** TS-4.4 (invalid UUID)
- **update_entry:** TS-5.2b (name re-embed), TS-5.6 (invalid UUID), TS-5.7 (invalid category), TS-5.8 (no re-embed), TS-5.9 (empty update), TS-5.10 (Ollama down)
- **delete_entry:** TS-6.4 (invalid UUID), TS-6.5 (just created)
- **brain_stats:** TS-7.3 (empty database)
- **Transport:** TS-8.3 (DB unavailable), TS-9.3/TS-9.4 (auth failures)

## Traceability

All 44 acceptance criteria (AC-1.1 through AC-9.4) are mapped to at least one test scenario. All edge cases from the specification are covered. All relevant constraints are verified. Non-goals are enforced by the absence of corresponding capabilities (TS-10.2 verifies tools-only).

**Total: 53 test scenarios** across 10 groups.
