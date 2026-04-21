# Entry Visibility — Test Specification

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|---|---|
| AC-1.1 LLM JSON output includes `visibility` key with `"private"`/`"shared"` | TS-1.1, TS-1.2 |
| AC-1.2 Prompt documents visibility heuristic | TS-1.8 |
| AC-1.3 Valid visibility + confidence ≥ threshold stored as-is | TS-1.1, TS-1.2 |
| AC-1.4 Confidence < threshold → forced `'private'` | TS-1.3, TS-1.4 |
| AC-1.5 Invalid LLM value → stored `'private'` | TS-1.6 |
| AC-1.6 LLM omits `visibility` field → stored `'private'` | TS-1.5 |
| AC-1.7 Classification failure → stored `'private'`, category `null` | TS-1.7 |
| AC-2.1 `getDisplayTasks` filters `visibility = 'shared'` | TS-2.1, TS-2.2 |
| AC-2.2 Forward constraint for future display queries | Documented only — no present code path |
| AC-2.3 Calendar events unaffected by visibility filter | TS-2.3 |
| AC-3.1 Telegram toggle updates DB via pure UPDATE, no LLM call | TS-3.6 |
| AC-3.2 Bot edits original reply to reflect new state | TS-3.7 |
| AC-3.3 Toggle appears only on low-confidence replies | TS-3.3, TS-3.4, TS-3.5 |
| AC-3.4 Confident shared reply has `👁` glyph, no toggle | TS-3.1 |
| AC-3.5 Confident private reply has no glyph, no toggle | TS-3.2 |
| AC-3.6 Toggle callback_data format `visibility:<uuid>:<target>` | TS-3.6 |
| AC-4.1 List views render shared icon on shared entries | TS-4.1, TS-4.2, TS-4.3 |
| AC-4.2 Entry view page renders shared icon on shared entries | TS-4.4 |
| AC-4.3 Edit form two-option visibility control pre-selected | TS-4.6 |
| AC-4.4 Edit POST validates visibility; invalid → 422 | TS-4.7, TS-4.8 |
| AC-4.5 Webapp does not filter by visibility | TS-4.9 |
| AC-5.1 Read tools include `visibility` in response | TS-5.1, TS-5.2, TS-5.3 |
| AC-5.2 `add_thought` optional visibility override bypasses fail-safe | TS-5.4, TS-5.5 |
| AC-5.3 `add_thought` invalid visibility → error, entry not stored | TS-5.6 |
| AC-5.4 `update_entry` accepts visibility | TS-5.7 |
| AC-5.5 `update_entry` invalid visibility → error | TS-5.8 |
| AC-5.6 `delete_entry`, `brain_stats` unchanged | Implicit quality gate via existing 53 MCP tests |
| AC-6.1 SSE `entry:created`/`entry:updated` include `visibility` | TS-6.1, TS-6.2 |
| AC-6.2 SSE `entry:deleted` unchanged | TS-6.3 |
| AC-6.3 Visibility-only UPDATE fires `entry:updated` | TS-6.4 |
| T-1 Column NOT NULL DEFAULT 'private' with CHECK | TS-7.1 |
| T-2 Existing rows default to `'private'` via column default | TS-7.3 |
| T-3 CHECK constraint enforced at DB level | TS-7.2 |
| T-4 Reuse existing `confidence_threshold` (no new setting) | TS-1.3, TS-1.4 (implicit — same threshold setting) |
| T-5 Drizzle schema declaration matches migration | TS-7.1 (via schema import + runtime introspection) |
| T-6 Shared constants in `src/web/shared.ts` | TS-7.4 |
| EC-1 LLM `visibility: null` or omitted → private | TS-1.5 |
| EC-2 LLM returns non-enum string → private | TS-1.6 |
| EC-3 Low confidence + LLM "shared" → private | TS-1.3 |
| EC-4 Low confidence + LLM "private" → private | TS-1.4 |
| EC-5 Classification fails → private + category null | TS-1.7 |
| EC-6 Webapp edit overrides stored value | TS-4.7 |
| EC-7 Telegram toggle tap flips via UPDATE | TS-3.6 |
| EC-8 Webapp edit with empty visibility → 422 | TS-4.8 |
| EC-9 MCP add_thought explicit private + LLM shared → stored private | TS-5.4 |
| EC-10 MCP add_thought invalid visibility → error | TS-5.6 |
| EC-11 MCP update_entry with only visibility updates only that | TS-5.7 |
| EC-12 Concurrent webapp + Telegram edit → last write wins | TS-8.1 |
| EC-13 Soft-delete preserves visibility | TS-8.2 |
| EC-14 User corrects visibility; next display render reflects it | Subsumed by TS-2.2 + TS-4.7 |
| EC-15 Voice capture follows text-reply format | TS-3.8 |
| EC-16 `/fix` re-classifies, fail-safe still applies | TS-8.4 |
| EC-17 LLM omits visibility with high confidence → still private | TS-1.5 |
| NG-5 Google Calendar not gated by visibility | TS-8.5 |
| NG-8 Only two visibility values enforced | TS-7.2 (CHECK rejects) |
| NG-11 No toggle on confident replies | TS-3.1, TS-3.2 (actively assert absence) |

## Test Scenarios

### Group 1 — LLM classification pipeline

**TS-1.1: LLM returns `visibility = "shared"` with high confidence → stored as `'shared'`**

```
Given the LLM is mocked to return a valid classification JSON with
  category="tasks", confidence=0.90, visibility="shared"
  And the confidence_threshold setting is 0.6
When classifyText(input) is called with a representative input
Then the returned result has visibility = "shared"
  And any entry written to the DB downstream carries visibility = "shared"
```

**TS-1.2: LLM returns `visibility = "private"` with high confidence → stored as `'private'`**

```
Given the LLM is mocked to return a valid classification JSON with
  category="ideas", confidence=0.85, visibility="private"
  And the confidence_threshold setting is 0.6
When classifyText(input) is called
Then the returned result has visibility = "private"
```

**TS-1.3: LLM returns `"shared"` but confidence is below threshold → forced `'private'`**

```
Given the LLM is mocked to return a valid classification JSON with
  category="tasks", confidence=0.45, visibility="shared"
  And the confidence_threshold setting is 0.6
When the entry is stored via the Telegram text-handler pipeline (classify + insert)
Then the stored row has visibility = "private"
  And the LLM's returned "shared" is overridden by the fail-safe
```

**TS-1.4: LLM returns `"private"` with confidence below threshold → stored `'private'` (consistent)**

```
Given the LLM is mocked to return visibility="private", confidence=0.45
  And the confidence_threshold setting is 0.6
When the entry is stored via the Telegram text-handler pipeline
Then the stored row has visibility = "private"
```

**TS-1.5: LLM omits `visibility` from its JSON response → stored `'private'`**

```
Given the LLM is mocked to return a valid classification JSON that does NOT include a visibility key
  And confidence = 0.90 (above threshold)
When classifyText(input) is invoked and the result is inserted
Then the stored row has visibility = "private"
  (The missing-field fail-safe applies regardless of confidence.)
```

**TS-1.6: LLM returns an invalid visibility value → stored `'private'`**

```
Given the LLM is mocked to return visibility="public" (not in {"private","shared"})
  And confidence = 0.90
When classifyText(input) is invoked and the result is inserted
Then the stored row has visibility = "private"
  (The invalid-value fail-safe applies regardless of confidence.)
```

**TS-1.7: Classification fails entirely → stored `'private'` with `category = null`**

```
Given the LLM provider throws on chat()
When the Telegram text-handler stores the resulting unclassified entry
Then the stored row has category = null
  And the stored row has visibility = "private"
  And confidence = null
```

**TS-1.8: Classification prompt documents the visibility heuristic**

```
Given a static read of prompts/classify.md
Then the prompt contains the literal token "visibility"
  And the prompt enumerates "private" and "shared" as the allowed values
  And the prompt's "Enum-valued fields — English only" section includes "visibility"
```

### Group 2 — Kitchen display filter

**TS-2.1: `getDisplayTasks` returns only rows with `visibility = 'shared'`**

```
Given the entries table contains:
  - a task A with visibility="shared", status="pending"
  - a task B with visibility="private", status="pending"
  - a task C with visibility="shared", status="done" (done within 24h)
When getDisplayTasks(sql, 10) is called
Then the returned list contains tasks A and C
  And the returned list does NOT contain task B
```

**TS-2.2: Private task does not leak into display even when otherwise-eligible**

```
Given a task with visibility="private", status="pending", due_date in the near future
When the kitchen display PNG is rendered via GET /api/kitchen.png (authenticated)
Then the rendered task list does not include that task's name
```

**TS-2.3: Calendar events on the kitchen display are unaffected by entry visibility**

```
Given a private Cortex entry with create_calendar_event=true has been captured,
  and the corresponding Google Calendar event exists on the configured calendar
  (the calendar is read from Google, not from the entries table)
When getDisplayEvents(sql, timezone, ...) is called
Then the returned today/tomorrow lists include that event
  (Visibility filtering does not apply to calendar events — see NG-5.)
```

### Group 3 — Telegram correction loop

**TS-3.1: Confident shared reply includes the `👁` glyph and no inline toggle**

```
Given the LLM returns visibility="shared", confidence=0.90 (≥ threshold)
When the Telegram text-handler sends its reply
Then the reply text contains the "👁" character
  And the reply's reply_markup contains NO inline keyboard with a visibility toggle button
```

**TS-3.2: Confident private reply has no glyph and no inline toggle**

```
Given the LLM returns visibility="private", confidence=0.85 (≥ threshold)
When the Telegram text-handler sends its reply
Then the reply text does NOT contain the "👁" character
  And the reply's reply_markup is absent (no inline buttons)
```

**TS-3.3: Low-confidence reply (LLM returned "shared") includes 5 category buttons + "Make shared" toggle, no glyph**

```
Given the LLM returns visibility="shared", confidence=0.45 (< threshold)
  And the confidence fail-safe flips stored visibility to "private" (per AC-1.4)
When the Telegram text-handler sends its reply
Then the reply text does NOT contain "👁" (reply reflects stored = private)
  And the reply's reply_markup includes 5 category correction buttons
  And the reply's reply_markup includes 1 visibility toggle button
  And the toggle button's label contains "Make shared" (flipping from stored private toward shared)
  And the toggle's callback_data ends with ":shared"
```

**TS-3.4: Low-confidence reply (LLM returned "private") includes 5 category buttons + "Make shared" toggle, no glyph**

```
Given the LLM returns visibility="private", confidence=0.45 (< threshold)
When the Telegram text-handler sends its reply
Then the reply text does not contain "👁"
  And the reply's reply_markup includes 5 category correction buttons
  And the reply's reply_markup includes 1 visibility toggle button
  And the toggle button's label contains "Make shared"
  And the toggle's callback_data ends with ":shared"
  (The initial storage state for any low-confidence reply is "private" — either because
   the LLM returned "private" or the fail-safe forced it. The toggle always offers
   the only escape path.)
```

**TS-3.5: Toggle button label is the inverse of the stored visibility (asserted in both directions)**

```
Given an entry is displayed in an inline keyboard and the entry's stored visibility is "shared"
  (This state is reachable after a toggle tap on a previously private low-confidence entry,
   or via a future code path that emits a toggle when storage is shared.)
When the reply's inline keyboard is rendered
Then the visibility toggle button's label contains "Make private"
  And the toggle's callback_data ends with ":private"

Given an entry is displayed in an inline keyboard and the entry's stored visibility is "private"
When the reply's inline keyboard is rendered
Then the visibility toggle button's label contains "Make shared"
  And the toggle's callback_data ends with ":shared"
```

**TS-3.6: Visibility toggle tap updates DB via direct UPDATE, no LLM call**

```
Given an entry exists with visibility="shared"
  And the LLM provider is instrumented to record every chat() call
When a Telegram callback_query arrives with data = "visibility:<entry-uuid>:private"
Then the entry's stored visibility becomes "private"
  And the LLM provider recorded zero chat() calls during the handler
  And zero embedding generation calls were made during the handler
```

**TS-3.7: Visibility toggle tap edits the original reply to reflect the new state**

```
Given an entry exists with visibility="shared" and the user sees a reply with "👁" glyph
  and a "Make private" toggle
When the user taps the toggle (callback_data = "visibility:<uuid>:private")
Then the bot calls editMessageText on the original reply
  And the edited text does not contain "👁"
  And the inline keyboard's visibility toggle label now reflects "Make shared"
    (or the keyboard is rewritten so the button's target is now "shared")
```

**TS-3.8: Voice capture reply follows the same visibility-format rules as text**

```
Given the LLM returns visibility="shared", confidence=0.90 for a transcribed voice message
When the Telegram voice-handler sends its reply
Then the reply text contains "🎤 '<transcript>'"
  And the reply text contains "👁"
  And the reply has no inline visibility toggle button (confident case)
```

### Group 4 — Webapp visual indicator and edit form

**TS-4.1: Dashboard recent-entries block renders the shared icon on `visibility = 'shared'` entries**

```
Given an authenticated user
  And the entries table contains one entry with visibility="shared" in the last 7 days
When GET / is requested
Then the response HTML contains the shared-icon SVG (Lucide send or equivalent)
  within the recent-entries list item for that entry
```

**TS-4.2: Browse page renders the shared icon on `visibility = 'shared'` entries**

```
Given an authenticated user
  And the entries table contains a shared entry matching a browse filter
When GET /browse is requested
Then the response HTML contains the shared-icon SVG within the card for that entry
```

**TS-4.3: Trash page renders the shared icon on soft-deleted `visibility = 'shared'` entries**

```
Given an authenticated user
  And a soft-deleted entry with visibility="shared"
When GET /trash is requested
Then the response HTML contains the shared-icon SVG within the row for that entry
```

**TS-4.4: Entry view page renders the shared icon when `visibility = 'shared'`**

```
Given an authenticated user
  And an entry with visibility="shared"
When GET /entry/<uuid> is requested
Then the response HTML contains the shared-icon SVG next to the category badge
```

**TS-4.5: Private entries render no visibility icon anywhere**

```
Given an authenticated user
  And an entry with visibility="private"
When GET /, GET /browse, GET /trash (after soft-delete), and GET /entry/<uuid> are each requested
Then none of the responses contain the shared-icon SVG for that entry
  (checked by absence of the specific SVG path markup within the entry's rendered block)
```

**TS-4.6: Edit form shows a two-option visibility control with the current value pre-selected**

```
Given an authenticated user
  And an entry with visibility="private"
When GET /entry/<uuid>/edit is requested
Then the response HTML contains a form control (radio or select) named "visibility"
  with options "private" and "shared"
  And the "private" option is marked selected
```

**TS-4.7: Edit POST with valid visibility value updates the stored row**

```
Given an authenticated user
  And an entry with visibility="private"
When POST /entry/<uuid>/edit is submitted with name, category, and visibility="shared"
Then the response redirects (303) to /entry/<uuid>
  And the entry's stored visibility becomes "shared"
```

**TS-4.8: Edit POST with invalid visibility returns 422 and does not modify the entry**

```
Given an authenticated user
  And an entry with visibility="private"
When POST /entry/<uuid>/edit is submitted with name, category, and visibility="public" (invalid)
Then the response status is 422
  And the rendered form contains an error message
  And the entry's stored visibility is still "private" (unchanged)
```

**TS-4.9: Webapp does not filter list views by visibility**

```
Given an authenticated user
  And the entries table contains one private entry and one shared entry, both in the last 7 days
When GET /, GET /browse, and GET /trash are requested
Then both entries appear in each response where they would otherwise be eligible
  (private entry is NOT filtered out)
```

### Group 5 — MCP tool exposure

**TS-5.1: `search_brain` includes `visibility` in each result**

```
Given an entry with visibility="shared" matches a semantic query
When handleSearchBrain(sql, { query: "..." }) is called
Then the returned payload's entries each include a `visibility` field
  And the value matches the stored entry's visibility
```

**TS-5.2: `list_recent` includes `visibility` in each result**

```
Given entries with mixed visibility values exist in the last 7 days
When handleListRecent(sql, { days: 7 }) is called
Then each returned entry object has a `visibility` field set to its stored value
```

**TS-5.3: `get_entry` includes `visibility` in the response**

```
Given an entry exists with visibility="private"
When handleGetEntry(sql, { id: "<uuid>" }) is called
Then the returned payload has `visibility` equal to "private"
```

**TS-5.4: `add_thought` with explicit `visibility = "private"` stores as private regardless of LLM inference**

```
Given the LLM is mocked to return visibility="shared", confidence=0.90
When handleAddThought(sql, { text: "...", visibility: "private" }) is called
Then the stored entry has visibility = "private"
  (Explicit override wins; LLM's "shared" is discarded.)
```

**TS-5.5: `add_thought` explicit override bypasses the confidence fail-safe**

```
Given the LLM is mocked to return visibility="shared", confidence=0.45 (below threshold)
When handleAddThought(sql, { text: "...", visibility: "shared" }) is called
Then the stored entry has visibility = "shared"
  (Explicit override takes the value as-given; fail-safe does not engage.)
```

**TS-5.6: `add_thought` with an invalid `visibility` value returns an error and does not store the entry**

```
Given a pre-existing row count N in the entries table
When handleAddThought(sql, { text: "...", visibility: "public" }) is called
Then the returned ToolResult.isError is true
  And the entries row count is still N (no new row inserted)
```

**TS-5.7: `update_entry` with a valid visibility value updates only visibility when no other fields are passed**

```
Given an entry exists with visibility="private", name="X", category="ideas"
When handleUpdateEntry(sql, { id: "<uuid>", visibility: "shared" }) is called
Then the returned payload has visibility = "shared"
  And the entry's name is still "X"
  And the entry's category is still "ideas"
```

**TS-5.8: `update_entry` with an invalid visibility returns an error and does not write other fields**

```
Given an entry exists with name="X", visibility="private"
When handleUpdateEntry(sql, { id: "<uuid>", name: "Y", visibility: "public" }) is called
Then the returned ToolResult.isError is true
  And the entry's name is still "X"
  And the entry's visibility is still "private"
```

### Group 6 — SSE payload

**TS-6.1: `entry:created` SSE event includes `visibility`**

```
Given the SSE broadcaster is subscribed
When a new entry is inserted with visibility="shared"
Then the broadcast payload of type "entry:created" has data.visibility = "shared"
```

**TS-6.2: `entry:updated` SSE event includes `visibility`**

```
Given the SSE broadcaster is subscribed
  And an existing entry with visibility="private"
When an UPDATE changes the entry's category (any other field change)
Then the broadcast payload of type "entry:updated" has data.visibility = "private"
```

**TS-6.3: `entry:deleted` SSE event carries only `id`**

```
Given the SSE broadcaster is subscribed
When an entry is soft-deleted
Then the broadcast payload of type "entry:deleted" has data = { id: <uuid> }
  And data does NOT include visibility, name, category, or confidence
```

**TS-6.4: Visibility-only UPDATE triggers an `entry:updated` event**

```
Given an existing entry with visibility="private"
  And the SSE broadcaster is subscribed
When an UPDATE sets visibility="shared" and changes no other field
Then a broadcast of type "entry:updated" is emitted
  And the payload's data.visibility = "shared"
```

### Group 7 — Database schema and shared constants

**TS-7.1: The entries table has a `visibility` column with the expected constraints**

```
Given the migrations have run
When a Postgres information_schema query reads the `visibility` column definition on `entries`
Then the column exists
  And the data_type is "text"
  And is_nullable is "NO"
  And the column_default is "'private'::text"
  And a CHECK constraint exists on `entries` that matches "visibility IN ('private', 'shared')" semantics
```

**TS-7.2: The CHECK constraint rejects an invalid value at the database level**

```
Given the migrations have run
When a raw SQL INSERT sets visibility = 'public' (bypassing application validation)
Then the INSERT fails with a Postgres check_violation error
```

**TS-7.3: Pre-existing rows gain `visibility = 'private'` via the column default**

```
Given a fresh test database
  And a row is inserted via the post-migration pipeline without specifying visibility
When the row is queried back
Then the row's visibility is "private"
```

**TS-7.4: `src/web/shared.ts` exports `VISIBILITY_VALUES` and a `Visibility` type**

```
Given a static import of src/web/shared.ts
Then the module exports a constant named VISIBILITY_VALUES
  And VISIBILITY_VALUES is the array ["private", "shared"] (readonly)
  And the module exports a type alias Visibility equal to "private" | "shared"
```

### Group 8 — Edge cases and non-goal guards

**TS-8.1: Concurrent webapp edit and Telegram toggle → last write wins**

```
Given an entry with visibility="private"
When a webapp edit POST is in flight setting visibility="shared"
  And a Telegram toggle callback sets visibility="private" after the webapp's commit
Then the final stored visibility is "private"
  (Standard Postgres UPDATE semantics — whichever commits last wins.)
```

**TS-8.2: Soft-delete preserves the entry's visibility**

```
Given an entry with visibility="shared"
When the entry is soft-deleted via POST /entry/<uuid>/delete
Then the stored row has deleted_at set
  And the row's visibility is still "shared" (unchanged)
```

**TS-8.3: Restoring a soft-deleted entry preserves its visibility**

```
Given a soft-deleted entry with visibility="private"
When POST /entry/<uuid>/restore is issued
Then the row's deleted_at is NULL
  And the row's visibility is still "private"
```

**TS-8.4: `/fix` command re-classifies; visibility fail-safe still applies**

```
Given the most recent Telegram entry exists with visibility="shared", confidence=0.8
  And the user sends "/fix this is a personal note"
  And the LLM's re-classification returns visibility="private", confidence=0.4 (below threshold)
When the /fix handler processes the command
Then the stored entry's visibility is "private"
  (Fail-safe engaged on the re-classification path, same as the initial path.)
```

**TS-8.5: Google Calendar event is still created for a private entry (NG-5 guard)**

```
Given the LLM returns create_calendar_event=true, calendar_date="YYYY-MM-DD", visibility="private", confidence=0.9
  And Google Calendar is configured
When the Telegram text-handler processes the entry
Then processCalendarEvent is called with that classification result
  And the stored entry has visibility="private"
  (Calendar creation is orthogonal to visibility; the entry stays private but the event still lands on the configured calendar.)
```

## Edge Case Scenarios

All edge cases (EC-1 through EC-17) are mapped inline above in the coverage matrix. The scenarios that test them are listed alongside. EC-14 (user correction propagates to next display render) is subsumed by TS-2.2 (private task never on display) composed with TS-4.7 (edit persists the new value) — the display's render-time DB read observes the post-edit value.

## Traceability

Every AC in the behavioral specification has at least one test scenario. AC-2.2 (forward constraint on future display queries) and AC-5.6 (`delete_entry`/`brain_stats` unchanged) are satisfied as documentation-only or implicit-quality-gate items and are noted as such in the coverage matrix.

Every edge case EC-1 through EC-17 has a mapped scenario.

Every non-goal that merits active guarding (NG-5, NG-8, NG-11) has an assertion.

Scenario count: **49** (TS-1.1 through TS-8.5).

Per-group totals: Group 1 (LLM pipeline) 8, Group 2 (display) 3, Group 3 (Telegram) 8, Group 4 (webapp) 9, Group 5 (MCP) 8, Group 6 (SSE) 4, Group 7 (DB + constants) 4, Group 8 (edge cases + non-goal guards) 5.

No orphan scenarios.
