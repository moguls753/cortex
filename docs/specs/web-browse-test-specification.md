# Web Browse - Test Specification

| Field | Value |
|-------|-------|
| Feature | Web Browse |
| Phase | 2 |
| Date | 2026-03-05 |
| Derives From | `web-browse-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|-------------------|
| AC-1.1: Five categories shown as filter tabs/buttons | TS-1.1 |
| AC-1.2: Clicking a category shows only entries in that category | TS-1.2 |
| AC-1.3: "All" option is the default view | TS-1.1, TS-1.3 |
| AC-1.4: Soft-deleted entries not shown | TS-1.4 |
| AC-1.5: Results ordered by updated_at descending | TS-1.5 |
| AC-2.1: Search bar accepts natural language queries | TS-2.1 |
| AC-2.2: Query embedded and compared via cosine similarity | TS-2.1 |
| AC-2.3: Only results with similarity >= 0.5 shown | TS-2.2 |
| AC-2.4: Results ranked by similarity (scores not displayed) | TS-2.1 |
| AC-2.5: Search combined with category filter | TS-2.3 |
| AC-3.1: Text search fallback when semantic search has no results | TS-3.1 |
| AC-3.2: Text search matches name and content fields | TS-3.2 |
| AC-3.3: Text search is case-insensitive | TS-3.3 |
| AC-3.4: Explicit text search toggle | TS-3.4 |
| AC-4.1: Tags shown as clickable filter pills | TS-4.1 |
| AC-4.2: Clicking a tag shows only entries with that tag | TS-4.2 |
| AC-4.3: Tag + category + search combined (AND logic) | TS-4.3 |
| AC-4.4: Tag list dynamically shows only tags in current filtered set | TS-4.4 |
| Constraint: Server-rendered HTML via Hono | TS-5.1 |
| Constraint: Semantic search requires Ollama; fallback to text if down | TS-5.4 |
| Constraint: Entries without embeddings excluded from semantic, included in text/browse | TS-5.3, TS-5.6 |
| Constraint: Cosine similarity threshold applied at DB level | TS-2.2 |
| Constraint: Requires authentication | TS-5.2 |
| Constraint: Filter state in URL query parameters | TS-5.5 |
| RQ-1: Fallback notice shown | TS-3.5 |
| RQ-2: Query params + page reload | TS-5.5 |
| RQ-3: Single tag selection + deselect | TS-4.5, TS-4.6 |
| RQ-4: Max 10 tags, "show more" collapse | TS-6.7 |
| EC-1: No results message | TS-6.1 |
| EC-2: Long query truncated to 500 chars | TS-6.2 |
| EC-3: German semantic search works | TS-6.3 |
| EC-4: Empty database empty state | TS-6.4 |
| EC-5: Entries with no tags excluded when tag filter active | TS-6.5 |
| EC-6: Entries with no embedding excluded from semantic only | TS-5.3, TS-5.6 |
| EC-7: All filters combined use AND logic | TS-4.3 |
| EC-8: Category with zero entries shows empty result | TS-6.6 |

## Test Scenarios

### Group 1: Category Browsing (US-1)

#### TS-1.1: Browse page shows all category filters with "All" as default

```
Scenario: Browse page shows all category filters with "All" as default
  Given the user is authenticated
  And entries exist across multiple categories
  When the user loads the browse page
  Then five category filter options are displayed: People, Projects, Tasks, Ideas, Reference
  And an "All" option is displayed
  And the "All" option is selected by default
  And entries from all categories are shown
```

**Traces to:** AC-1.1, AC-1.3

---

#### TS-1.2: Filtering by category shows only matching entries

```
Scenario: Filtering by category shows only matching entries
  Given the user is authenticated
  And 3 entries exist with category "tasks"
  And 2 entries exist with category "ideas"
  When the user filters by category "tasks"
  Then only the 3 task entries are displayed
  And no idea entries are shown
```

**Traces to:** AC-1.2

---

#### TS-1.3: "All" category shows entries across all categories

```
Scenario: "All" category shows entries across all categories
  Given the user is authenticated
  And entries exist in categories "people", "projects", and "tasks"
  When the user selects the "All" category filter
  Then entries from all three categories are displayed
```

**Traces to:** AC-1.3

---

#### TS-1.4: Soft-deleted entries are excluded from browse results

```
Scenario: Soft-deleted entries are excluded from browse results
  Given the user is authenticated
  And 3 active entries and 2 soft-deleted entries exist
  When the user loads the browse page
  Then only the 3 active entries are displayed
  And the soft-deleted entries are not shown
```

**Traces to:** AC-1.4

---

#### TS-1.5: Results ordered by updated_at descending

```
Scenario: Results ordered by updated_at descending
  Given the user is authenticated
  And entry "A" was updated 1 hour ago
  And entry "B" was updated 3 hours ago
  And entry "C" was updated 2 hours ago
  When the user loads the browse page
  Then the entries are displayed in order: A, C, B
```

**Traces to:** AC-1.5

---

### Group 2: Semantic Search (US-2)

#### TS-2.1: Semantic search returns results ranked by similarity

```
Scenario: Semantic search returns results ranked by similarity
  Given the user is authenticated
  And entries exist with embeddings
  When the user searches for "career development plans"
  Then results are returned ranked by similarity (highest first)
  And similarity scores are not displayed to the user
```

**Traces to:** AC-2.1, AC-2.2, AC-2.4

---

#### TS-2.2: Semantic search excludes results below similarity threshold

```
Scenario: Semantic search excludes results below similarity threshold
  Given the user is authenticated
  And entry "A" has similarity 0.7 to the query
  And entry "B" has similarity 0.3 to the query
  When the user searches for a query
  Then entry "A" is included in results
  And entry "B" is excluded from results
```

**Traces to:** AC-2.3, C-4

---

#### TS-2.3: Semantic search combined with category filter

```
Scenario: Semantic search combined with category filter
  Given the user is authenticated
  And a "projects" entry exists with high similarity to "budget planning"
  And an "ideas" entry exists with high similarity to "budget planning"
  When the user searches for "budget planning" with category filter "projects"
  Then only the "projects" entry is included in results
  And the "ideas" entry is excluded
```

**Traces to:** AC-2.5

---

#### TS-2.4: Semantic search results override default sort order

```
Scenario: Semantic search results override default sort order
  Given the user is authenticated
  And entry "Old" was updated 5 days ago with high similarity to the query
  And entry "New" was updated 1 hour ago with low similarity (but above 0.5) to the query
  When the user performs a semantic search
  Then entry "Old" appears before entry "New" (sorted by similarity, not recency)
```

**Traces to:** AC-2.4, AC-1.5 (override)

---

### Group 3: Text Search (US-3)

#### TS-3.1: Text search runs as fallback when semantic search has no results

```
Scenario: Text search runs as fallback when semantic search has no results
  Given the user is authenticated
  And no entry embeddings have similarity >= 0.5 to the query
  And an entry exists with "quarterly budget" in the content field
  When the user searches for "quarterly budget"
  Then the entry with matching content is returned via text search
```

**Traces to:** AC-3.1

---

#### TS-3.2: Text search matches against name and content fields

```
Scenario: Text search matches against name and content fields
  Given the user is authenticated
  And entry "A" has name "Weekly standup notes"
  And entry "B" has content containing "standup meeting agenda"
  And entry "C" has neither "standup" in name nor content
  When the user performs a text search for "standup"
  Then entries "A" and "B" are returned
  And entry "C" is not returned
```

**Traces to:** AC-3.2

---

#### TS-3.3: Text search is case-insensitive

```
Scenario: Text search is case-insensitive
  Given the user is authenticated
  And an entry exists with name "Project Alpha"
  When the user performs a text search for "project alpha"
  Then the entry is returned
```

**Traces to:** AC-3.3

---

#### TS-3.4: Explicit text search mode bypasses semantic search

```
Scenario: Explicit text search mode bypasses semantic search
  Given the user is authenticated
  And entries exist with embeddings
  When the user activates the text search toggle and searches for "exact phrase"
  Then text search is used directly without attempting semantic search
  And results match against name and content fields
```

**Traces to:** AC-3.4

---

#### TS-3.5: Fallback notice shown when text search replaces semantic search

```
Scenario: Fallback notice shown when text search replaces semantic search
  Given the user is authenticated
  And no entry embeddings have similarity >= 0.5 to the query
  And entries exist matching the query text
  When the user searches for the query
  Then a notice is displayed indicating semantic search found no matches and text results are shown instead
  And the text search results are displayed
```

**Traces to:** AC-3.1, RQ-1

---

### Group 4: Tag Filtering (US-4)

#### TS-4.1: Tags shown as clickable filter pills

```
Scenario: Tags shown as clickable filter pills
  Given the user is authenticated
  And entries exist with tags "work", "personal", "urgent"
  When the user loads the browse page
  Then tags "work", "personal", "urgent" are displayed as clickable filter pills
```

**Traces to:** AC-4.1

---

#### TS-4.2: Clicking a tag shows only entries with that tag

```
Scenario: Clicking a tag shows only entries with that tag
  Given the user is authenticated
  And entry "A" has tag "work"
  And entry "B" has tag "personal"
  And entry "C" has tags "work" and "personal"
  When the user filters by tag "work"
  Then entries "A" and "C" are displayed
  And entry "B" is not displayed
```

**Traces to:** AC-4.2

---

#### TS-4.3: Tag + category + search filters combined with AND logic

```
Scenario: Tag + category + search filters combined with AND logic
  Given the user is authenticated
  And a "tasks" entry with tag "urgent" and content matching "review"
  And a "tasks" entry with tag "urgent" and content not matching "review"
  And an "ideas" entry with tag "urgent" and content matching "review"
  When the user filters by category "tasks", tag "urgent", and searches for "review"
  Then only the "tasks" entry with tag "urgent" and matching "review" is displayed
```

**Traces to:** AC-4.3, EC-7

---

#### TS-4.4: Tag list dynamically reflects current filtered set

```
Scenario: Tag list dynamically reflects current filtered set
  Given the user is authenticated
  And "projects" entries have tags "work" and "client"
  And "tasks" entries have tags "work" and "personal"
  When the user filters by category "projects"
  Then only tags "work" and "client" are shown in the tag filter
  And tag "personal" is not shown
```

**Traces to:** AC-4.4

---

#### TS-4.5: Clicking a different tag switches the selection (single tag)

```
Scenario: Clicking a different tag switches the selection
  Given the user is authenticated
  And the browse page is loaded with tag "work" selected
  When the user clicks tag "personal"
  Then entries with tag "personal" are displayed
  And entries with only tag "work" (not "personal") are no longer displayed
  And the "personal" tag appears selected
  And the "work" tag appears deselected
```

**Traces to:** RQ-3

---

#### TS-4.6: Clicking the active tag deselects it (clears tag filter)

```
Scenario: Clicking the active tag deselects it
  Given the user is authenticated
  And the browse page is loaded with tag "work" selected
  When the user clicks the currently selected tag "work"
  Then the tag filter is cleared
  And all entries (regardless of tags) are displayed
  And no tag appears selected
```

**Traces to:** RQ-3

---

### Group 5: Constraints

#### TS-5.1: Browse page returns server-rendered HTML

```
Scenario: Browse page returns server-rendered HTML
  Given the user is authenticated
  When the user loads the browse page
  Then the response content-type is HTML
  And the response body contains the browse page content as rendered HTML
```

**Traces to:** C-1

---

#### TS-5.2: Unauthenticated browse request redirected to login

```
Scenario: Unauthenticated browse request redirected to login
  Given the user is not authenticated
  When the user requests the browse page
  Then the user is redirected to /login
```

**Traces to:** C-5

---

#### TS-5.3: Entries without embeddings included in category browsing

```
Scenario: Entries without embeddings included in category browsing
  Given the user is authenticated
  And entry "A" has an embedding
  And entry "B" has no embedding (embedding IS NULL)
  When the user loads the browse page without a search query
  Then both entries "A" and "B" are displayed
```

**Traces to:** C-3, EC-6

---

#### TS-5.6: Entries without embeddings excluded from semantic search

```
Scenario: Entries without embeddings excluded from semantic search
  Given the user is authenticated
  And entry "A" has an embedding and high similarity to the query
  And entry "B" has no embedding (embedding IS NULL) but its content matches the query text
  When the user performs a semantic search
  Then entry "A" appears in the results
  And entry "B" is excluded from the semantic results
```

**Traces to:** C-3, EC-6

---

#### TS-5.4: Ollama unavailable falls back to text search with notice

```
Scenario: Ollama unavailable falls back to text search with notice
  Given the user is authenticated
  And the Ollama embedding service is unavailable
  And entries exist matching the query text
  When the user searches for a query
  Then text search results are displayed
  And a notice is shown indicating that semantic search is unavailable
```

**Traces to:** C-2

---

#### TS-5.5: Filter state reflected in URL query parameters

```
Scenario: Filter state reflected in URL query parameters
  Given the user is authenticated
  When the user filters by category "projects", tag "work", and searches for "budget"
  Then the URL contains query parameters for category, tag, and search query
  And reloading the page with those parameters preserves the filter state
```

**Traces to:** C-6, RQ-2

---

### Group 6: Edge Cases

#### TS-6.1: Search with no results shows "no results" message

```
Scenario: Search with no results shows "no results" message
  Given the user is authenticated
  And no entries match the search query (neither semantic nor text)
  When the user searches for a query with no matches
  Then a "No results found" message is displayed
  And a suggestion to try different terms or broaden the search is shown
```

**Traces to:** EC-1

---

#### TS-6.2: Very long search query truncated to 500 characters

```
Scenario: Very long search query truncated to 500 characters
  Given the user is authenticated
  When the user submits a search query longer than 500 characters
  Then the query is truncated to 500 characters before processing
  And search still executes with the truncated query
```

**Traces to:** EC-2

---

#### TS-6.3: German language search works

```
Scenario: German language search works
  Given the user is authenticated
  And an entry exists with German content "Projektbesprechung morgen"
  When the user searches for "Projektbesprechung"
  Then the entry is found (via semantic or text search)
```

**Traces to:** EC-3

---

#### TS-6.4: Empty database shows empty state message

```
Scenario: Empty database shows empty state message
  Given the user is authenticated
  And no entries exist in the database
  When the user loads the browse page
  Then an empty state message is displayed (e.g., "No entries yet. Start capturing thoughts via the dashboard or Telegram.")
```

**Traces to:** EC-4

---

#### TS-6.5: Entries with no tags excluded when specific tag filter active

```
Scenario: Entries with no tags excluded when specific tag filter active
  Given the user is authenticated
  And entry "A" has tag "work"
  And entry "B" has no tags
  When the user filters by tag "work"
  Then entry "A" is displayed
  And entry "B" is not displayed
```

**Traces to:** EC-5

---

#### TS-6.6: Category with zero entries shows empty result

```
Scenario: Category with zero entries shows empty result
  Given the user is authenticated
  And no entries exist with category "people"
  When the user filters by category "people"
  Then an empty result message is displayed
```

**Traces to:** EC-8

---

#### TS-6.7: Max 10 tags displayed with "show more" collapse

```
Scenario: Max 10 tags displayed with "show more" collapse
  Given the user is authenticated
  And entries exist with 15 distinct tags
  When the user loads the browse page
  Then 10 tags are initially visible
  And a "show more" control is displayed
  And activating "show more" reveals the remaining 5 tags
```

**Traces to:** RQ-4

---

## Traceability Summary

All acceptance criteria (AC-1.1 through AC-4.4), all testable constraints, all edge cases (EC-1 through EC-8), and all resolved questions (RQ-1 through RQ-4) have at least one corresponding test scenario.

**Total scenarios:** 33

## Orphan Check

No orphan scenarios. Every scenario traces to at least one spec requirement.
