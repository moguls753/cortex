# Entry Visibility — Test Implementation Specification

## Test Framework & Conventions

- **Runner:** Vitest (existing project test runner per `package.json`).
- **Conventions observed across the codebase and to be followed here:**
  - `describe`/`it`/`expect` from `vitest`.
  - Module-level `vi.mock("…")` factories to stub DB, LLM, Ollama, and SMTP seams.
  - **Plain async closures for stable default return values** inside `vi.mock` factories, not `vi.fn().mockResolvedValue(...)`. `vi.restoreAllMocks()` in `afterEach` wipes `mockResolvedValue` from the `vi.fn()` instances created at factory time, so stable defaults should be closures:
    ```ts
    vi.mock("../../src/web/settings-queries.js", () => ({
      getAllSettings: async () => ({}),             // stable — survives restoreAllMocks
      saveAllSettings: vi.fn(),                      // per-test override via mockResolvedValue
    }));
    ```
  - `vi.fn()` only for mocks that tests need to assert `.toHaveBeenCalled()` on or override per-test.
  - `beforeEach`: `vi.clearAllMocks()`. `afterEach`: `vi.restoreAllMocks()`, `vi.useRealTimers()` if timers were faked.
  - Existing helpers in `tests/helpers/`: `test-db.ts` (testcontainers + `pgvector/pgvector:pg16`), `mock-sql.ts`, `mock-ollama.ts`, `mock-telegram.ts`, `mock-llm.ts`, `session.ts`, `env.ts`.
  - Factory-pattern routes: `createEntryRoutes(sql)`, `createDashboardRoutes(sql, broadcaster)`, `createBrowseRoutes(sql)`, `createTrashRoutes(sql)`, `createMcpServer(sql)`, etc. Test apps mount the necessary factories with mock `sql`.
  - UUID regex used across handlers: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
  - Integration tests use `tests/helpers/test-db.ts:setupTestDB()` which spins a fresh pgvector container per file and runs migrations.
- **Assertion library:** Vitest's built-in `expect`.

## Test Structure

### File organization

All scenarios live in either an existing file (extended) or one of two new files. Total new files: 2. Total updated files: 10.

| File | New / Updated | Scenarios |
|---|---|---|
| `tests/unit/classify.test.ts` | Updated | TS-1.1, TS-1.2, TS-1.3, TS-1.4, TS-1.5, TS-1.6, TS-1.7, TS-1.8 |
| `tests/unit/display-tasks.test.ts` | Updated | TS-2.1 |
| `tests/unit/display-calendar.test.ts` | Updated | TS-2.3 |
| `tests/unit/telegram-bot.test.ts` | Updated | TS-3.1, TS-3.2, TS-3.3, TS-3.4, TS-3.5, TS-3.6, TS-3.7, TS-3.8, TS-8.4, TS-8.5 |
| `tests/unit/web-dashboard.test.ts` | Updated | TS-4.1, TS-4.9 |
| `tests/unit/web-browse.test.ts` | Updated | TS-4.2 |
| `tests/unit/web-trash.test.ts` | Updated | TS-4.3 |
| `tests/unit/web-entry.test.ts` | Updated | TS-4.4, TS-4.5, TS-4.6, TS-4.7, TS-4.8, TS-8.2, TS-8.3 |
| `tests/unit/mcp-server.test.ts` | Updated | TS-5.1, TS-5.2, TS-5.3, TS-5.4, TS-5.5, TS-5.6, TS-5.7, TS-5.8 |
| `tests/unit/entry-visibility-wiring.test.ts` | **New** | TS-7.4 |
| `tests/integration/db-notify-integration.test.ts` | Updated | TS-6.1, TS-6.2, TS-6.3, TS-6.4 |
| `tests/integration/entry-visibility-integration.test.ts` | **New** | TS-2.2, TS-7.1, TS-7.2, TS-7.3, TS-8.1 |

### Test grouping

Each updated file adds a new `describe` block named `"entry visibility"` (or a subgroup per TS group) that groups the new scenarios. Scenario IDs appear as `// TS-X.Y` leading comments on each `it` block, matching the existing codebase style (see `tests/unit/web-auth.test.ts` for the exact pattern).

### Naming conventions

Test names describe observable behavior, not implementation:

- `it("stores visibility as returned when LLM provides a valid value at high confidence")`
- `it("forces visibility to 'private' when confidence is below threshold")`
- `it("renders the shared icon on browse entries with visibility='shared'")`
- `it("updates visibility via UPDATE without invoking the LLM")`

## Test Scenario Mapping

### Group 1 — LLM classification pipeline (`tests/unit/classify.test.ts`)

| TS | Test function |
|---|---|
| TS-1.1 | `it("stores visibility='shared' when LLM returns 'shared' at high confidence")` |
| TS-1.2 | `it("stores visibility='private' when LLM returns 'private' at high confidence")` |
| TS-1.3 | `it("forces visibility to 'private' when confidence is below threshold (LLM said 'shared')")` |
| TS-1.4 | `it("keeps visibility='private' when LLM returned 'private' at low confidence")` |
| TS-1.5 | `it("defaults visibility to 'private' when LLM omits the key at high confidence")` |
| TS-1.6 | `it("defaults visibility to 'private' when LLM returns an invalid string")` |
| TS-1.7 | `it("stores visibility='private' with category=null when classification throws")` |
| TS-1.8 | `it("prompts/classify.md documents the visibility heuristic and enum values")` |

**Setup (Given):**

- Top-of-file `vi.mock` factories with **plain async closures** for stable defaults (per the convention above):
  ```ts
  vi.mock("../../src/llm/index.js", () => ({
    createLLMProvider: vi.fn(),                   // per-test override
  }));
  vi.mock("../../src/llm/config.js", () => ({
    getLLMConfig: async () => ({
      provider: "anthropic",
      apiKeys: { anthropic: "test-key" },
      model: "test-model",
      baseUrl: null,
    }),
  }));
  vi.mock("../../src/embed.js", () => ({
    generateEmbedding: async () => null,          // default: no embedding in unit tests
    embedEntry: vi.fn(),
    prepareEmbeddingInput: (e: any) => e.name,
  }));
  vi.mock("../../src/config.js", () => ({
    resolveConfigValue: async (key: string) => {  // stable default
      if (key === "output_language") return null;
      if (key === "confidence_threshold") return "0.6";
      return null;
    },
  }));
  ```
- For each scenario, override `createLLMProvider` per-test via `vi.mocked(createLLMProvider).mockReturnValue({ chat: async () => JSON.stringify(llmResponse) })` with `llmResponse` assembled per the scenario's Given.
- Import `classifyText` from `../../src/classify.js` after the mocks.

**Action (When):** `await classifyText(input, { sql: {} as Sql })`.

**Assertion (Then):**

- TS-1.1 / TS-1.2: `expect(result?.visibility).toBe("shared" | "private")`.

  Note: `classifyText` currently returns a plain result (not DB-written). The assertion is on the function's return value. Downstream DB write is already covered by existing pipeline tests; the visibility fail-safe happens at the caller (Telegram handler, MCP handler) because the fail-safe depends on the threshold, which is resolved at the caller today. **Phase 5 decision:** the fail-safe MAY be moved into `classifyText` itself (cleaner) OR kept at the caller (minimal refactor). Either way, Group 1 tests assert the fail-safe's observable effect on the result returned by `classifyText` — i.e., when `classifyText` is given a confidence_threshold context or when the caller applies the fail-safe, the downstream `visibility` value is `'private'`. The test author may need to adapt per Phase 5's implementation choice; the behavioral assertion (what gets stored/returned at the boundary) stays the same.

- TS-1.3 / TS-1.4: Either `classifyText` or a wrapper in the test harness applies the fail-safe. Assert `result.visibility === "private"`.
- TS-1.5: LLM response JSON omits `"visibility"`. Assert `result.visibility === "private"`.
- TS-1.6: LLM response includes `"visibility":"public"`. Assert `result.visibility === "private"`.
- TS-1.7: `createLLMProvider().chat` throws. Assert `result.category === null`, `result.visibility === "private"` — matches the existing unclassified-entry path already tested in `classify.test.ts`, extended with the visibility assertion.
- TS-1.8: `await fs.readFile("prompts/classify.md", "utf-8")` and assert:
  - `content.includes("visibility")`
  - `content.match(/\b"private"\b/)` and `content.match(/\b"shared"\b/)` both non-null
  - The section heading `"Enum-valued fields — English only"` is present and the `visibility` line is documented under it.

**Failure guarantee:**

All 8 tests fail on current `main` because:
- `validateClassificationResponse` in `src/classify.ts` has no `visibility` parsing (TS-1.1 through TS-1.6).
- `classifyText` return type has no `visibility` field (TypeScript compile error on the assertion).
- `prompts/classify.md` has no `visibility` section (TS-1.8).

---

### Group 2 — Kitchen display filter

#### `tests/unit/display-tasks.test.ts`

| TS | Test function |
|---|---|
| TS-2.1 | `it("returns only shared tasks when entries mix private and shared")` |

**Setup (Given):** Existing file uses a test DB via testcontainers (`getDisplayTasks` is raw SQL). Insert three entries via `sql.unsafe(...)`: task A shared pending, task B private pending, task C shared done within 24h.

**Action (When):** `await getDisplayTasks(sql, 10)`.

**Assertion (Then):**
```ts
const names = result.map((r) => r.name);
expect(names).toContain("Task A");
expect(names).toContain("Task C");
expect(names).not.toContain("Task B");
```

#### `tests/unit/display-calendar.test.ts`

| TS | Test function |
|---|---|
| TS-2.3 | `it("does not filter calendar events based on Cortex entry visibility")` |

**Setup (Given):** Same mocking pattern already in the file: `vi.spyOn(globalThis, "fetch")` on Google Calendar API. Mock the response to return one event.

**Action (When):** `await getDisplayEvents(sql, "Europe/Berlin", undefined)` with a mock `sql` that would return no rows for an `entries`-table query (but `getDisplayEvents` doesn't read entries; this test guards against future coupling).

**Assertion (Then):** `result.today.length === 1` — the event is returned regardless of any entry visibility state. The test is a regression guard for NG-5.

#### `tests/integration/entry-visibility-integration.test.ts`

| TS | Test function |
|---|---|
| TS-2.2 | `it("kitchen display render excludes private tasks from the PNG task list")` |

**Setup (Given):** `setupTestDB()` spins up a pgvector container and runs migrations. Insert one shared task and one private task via the post-migration `sql` client. Seed settings to enable display and set optional token.

**Action (When):** `await app.request("/api/kitchen.png?token=...")`.

**Assertion (Then):** `expect(res.status).toBe(200)`. Decode the PNG via `pngjs` or parse the render's intermediate DisplayData structure (whichever is simpler). The private task's name must not appear in any rendered text row.

**Alternative:** If PNG text extraction is too heavy, this scenario can assert at a seam: call `getDisplayTasks(sql, 10)` from the integration test (with a real DB) and assert the result list — but that collapses to TS-2.1 semantically. The distinguishing value of TS-2.2 is the full-stack render, so keep PNG decoding and parse either the render's input data or do a minimal text extraction. `renderKitchenDisplay` returns a Buffer; Phase 4 can inspect the `KitchenData` object that feeds the renderer if PNG parsing is fragile — this is acceptable because the end-to-end behavior is still covered via the data boundary.

---

### Group 3 — Telegram correction loop (`tests/unit/telegram-bot.test.ts`)

| TS | Test function |
|---|---|
| TS-3.1 | `it("includes the 👁 glyph and no toggle on confident shared replies")` |
| TS-3.2 | `it("includes no glyph and no toggle on confident private replies")` |
| TS-3.3 | `it("emits 5 category buttons + 1 'Make shared' toggle on low-confidence replies when LLM returned 'shared'")` |
| TS-3.4 | `it("emits 5 category buttons + 1 'Make shared' toggle on low-confidence replies when LLM returned 'private'")` |
| TS-3.5 | `it("toggle button label is the inverse of the stored visibility")` |
| TS-3.6 | `it("visibility toggle tap updates the DB via UPDATE without calling the LLM")` |
| TS-3.7 | `it("visibility toggle tap edits the original reply to reflect the new state")` |
| TS-3.8 | `it("voice capture reply follows the same visibility-format rules as text")` |
| TS-8.4 | `it("/fix command re-classifies and the fail-safe still flips low-confidence results to private")` |
| TS-8.5 | `it("private entry with create_calendar_event=true still creates a calendar event")` |

**Setup (Given):**

- Module mocks (plain async closures for stability, `vi.fn()` for assertion hooks):
  ```ts
  vi.mock("../../src/classify.js", () => ({
    classifyText: vi.fn(),                         // per-test override
    assembleContext: async () => [],
    isConfident: (c: number, t: number) => c >= t,
    resolveConfidenceThreshold: () => 0.6,
    reclassifyEntry: vi.fn(),
  }));
  vi.mock("../../src/embed.js", () => ({
    embedEntry: vi.fn(),
  }));
  vi.mock("../../src/google-calendar.js", () => ({
    processCalendarEvent: vi.fn(),                 // per-test assertion
    getCalendarNames: async () => [],
    handleEntryCalendarCleanup: vi.fn(),
  }));
  vi.mock("../../src/task-completion.js", () => ({
    detectTaskCompletion: vi.fn(),
    formatCompletionReply: vi.fn(),
    confirmTaskCompletion: vi.fn(),
  }));
  vi.mock("../../src/web/settings-queries.js", () => ({
    getAllSettings: async () => ({ telegram_chat_ids: "[123]" }),
    saveAllSettings: vi.fn(),
  }));
  vi.mock("../../src/config.js", () => ({
    resolveConfigValue: async (key: string) => {
      if (key === "telegram_chat_ids") return "[123]";
      if (key === "confidence_threshold") return "0.6";
      if (key === "output_language") return null;
      if (key === "ui_language") return "en";
      return null;
    },
  }));
  ```
- Mock `sql` from `tests/helpers/mock-sql.ts` — already used in existing telegram tests. Configure the mock to return `[{ id: "test-uuid-1234-1234-1234-123456789012" }]` for the INSERT returning clause.
- Build a mock `ctx` via `tests/helpers/mock-telegram.ts:createMockTelegramCtx(...)`. The helper records `reply` calls with their `text` and `options` args for assertion.

**Action (When):** `await handleTextMessage(ctx, sql)` (for TS-3.1..3.5, TS-8.4, TS-8.5) or `handleVoiceMessage(ctx, sql)` (TS-3.8) or `handleCallbackQuery(ctx, sql)` (TS-3.6, TS-3.7).

**Assertion (Then):**

- TS-3.1: Override `classifyText.mockResolvedValue({ category: "tasks", confidence: 0.9, visibility: "shared", ... })`. Assert `ctx.replies[0].text` contains `"👁"` and `ctx.replies[0].options.reply_markup` is `undefined` (or falsy).
- TS-3.2: Override for `visibility: "private", confidence: 0.85`. Assert text does not contain `"👁"` and `reply_markup` is `undefined`.
- TS-3.3: Override for `visibility: "shared", confidence: 0.45`. Assert `reply_markup.inline_keyboard` has **at least two rows**: row 1 has 5 buttons (category), and a visibility-toggle button exists whose `callback_data` ends with `":shared"`. Text does not contain `"👁"` (stored-private post-fail-safe).
- TS-3.4: Override for `visibility: "private", confidence: 0.45`. Assert reply_markup includes 5 category buttons + toggle; toggle label contains "Make shared"; callback_data ends with `":shared"`.
- TS-3.5: Two sub-tests:
  1. Build a mock entry with stored visibility=`"shared"` via DB stub. Trigger the code path that builds the inline keyboard (call `buildInlineKeyboard(entryId, t, "shared")` if the helper is exported, or exercise via a re-rendered callback-query edit). Assert label contains "Make private" and callback_data ends with `:private`.
  2. Same with stored `"private"`. Assert label "Make shared", callback_data `:shared`.
- TS-3.6: Given an entry with `visibility: "shared"`, dispatch a callback_query with `data = "visibility:<uuid>:private"`. Assert:
  - The mock `sql` recorded an `UPDATE entries SET visibility = 'private' WHERE id = '<uuid>'` (or equivalent parameterized form).
  - `createLLMProvider` was never called during the handler (use `expect(vi.mocked(reclassifyEntry)).not.toHaveBeenCalled()` or spy on `createLLMProvider`).
  - `embedEntry` was not called.
- TS-3.7: After the same tap in TS-3.6, assert `ctx.editMessageText` was called with a new text that does not contain `"👁"` (since new state is `"private"` — wait, that's a private state; no glyph) and a new `reply_markup` whose visibility toggle label contains "Make shared".
  
  *(Correction from TS-3.6: the tap flipped shared → private, so the edited reply reflects private — no glyph, toggle now "Make shared".)*
- TS-3.8: Use `handleVoiceMessage` via `tests/helpers/mock-telegram.ts:createMockVoiceCtx(...)`. Mock `transcribeVoice` (or the underlying `fetch`) to return "transcript". Override `classifyText` for confident shared. Assert `ctx.replies[0].text` contains `"🎤 'transcript'"` AND `"👁"` AND no `reply_markup`.
- TS-8.4: Simulate `/fix this is a personal note`. Mock `reclassifyEntry.mockResolvedValue({ category: "ideas", confidence: 0.4, visibility: "shared", name: "...", fields: {}, tags: [] })` to return low-confidence shared. After the handler runs, assert the `sql` mock recorded an `UPDATE` where the visibility param is `"private"` (fail-safe still fires on the `/fix` path).
  
  **Phase 5 note:** This requires the `/fix` handler to pass the reclassification result through the same fail-safe as the initial classification. If Phase 5 places the fail-safe only in the initial Telegram pipeline, TS-8.4 will require a fail-safe-at-update wrapping.

- TS-8.5: Mock `classifyText.mockResolvedValue({ category: "tasks", confidence: 0.9, visibility: "private", create_calendar_event: true, calendar_date: "2026-05-01", ... })`. After `handleTextMessage`, assert `vi.mocked(processCalendarEvent)` was called exactly once with the classification result. The entry's visibility remains `"private"` per the SQL mock's INSERT params.

**Failure guarantee:** The current `handleTextMessage` does not branch on visibility at all. No glyph, no toggle button, no visibility field in INSERT. All Group-3 tests fail.

---

### Group 4 — Webapp visual indicator and edit form

#### `tests/unit/web-dashboard.test.ts`

| TS | Test function |
|---|---|
| TS-4.1 | `it("renders the shared icon next to dashboard recent entries with visibility='shared'")` |
| TS-4.9 | `it("does not filter dashboard recent entries by visibility")` |

**Setup (Given):** Use the existing `createTestDashboard()` harness. Override the `dashboard-queries.ts` mock to return one shared + one private entry.

**Action (When):** `app.request("/")` with a valid session cookie.

**Assertion (Then):**
- TS-4.1: Response HTML contains the specific Lucide SVG path for the chosen icon (e.g., `data-icon="send"` or the `<path d="...">` snippet from `iconSend` in `src/web/icons.ts`). Use a substring match on a well-known part of the SVG. The icon must appear within the entry-list item for the shared entry.
- TS-4.9: Both entries' names appear in the response (no filtering).

#### `tests/unit/web-browse.test.ts`

| TS | Test function |
|---|---|
| TS-4.2 | `it("renders the shared icon on browse cards with visibility='shared'")` |

**Setup (Given):** `createBrowseRoutes(sql)` harness with mocked `browse-queries.ts` returning one shared entry matching the filter.

**Assertion (Then):** Response HTML contains the shared-icon SVG marker within the browse-card HTML for that entry.

#### `tests/unit/web-trash.test.ts`

| TS | Test function |
|---|---|
| TS-4.3 | `it("renders the shared icon on trash rows with visibility='shared'")` |

**Setup (Given):** Test harness uses the existing `createTrashRoutes` factory (or equivalent). Mock queries to return one soft-deleted shared entry.

**Assertion (Then):** Response HTML contains the icon marker within the trash row for that entry.

#### `tests/unit/web-entry.test.ts`

| TS | Test function |
|---|---|
| TS-4.4 | `it("renders the shared icon on the entry view page for visibility='shared'")` |
| TS-4.5 | `it("renders no visibility icon for visibility='private' entries across view/list surfaces")` |
| TS-4.6 | `it("edit form pre-selects the current visibility in a two-option control")` |
| TS-4.7 | `it("edit POST with visibility='shared' updates the stored row")` |
| TS-4.8 | `it("edit POST with invalid visibility returns 422 and leaves the row unchanged")` |
| TS-8.2 | `it("soft-delete preserves the entry's visibility")` |
| TS-8.3 | `it("restore preserves the entry's visibility")` |

**Setup (Given):** Existing `tests/unit/web-entry.test.ts` harness with `getEntry`, `updateEntry`, `softDeleteEntry`, `restoreEntry` mocked via `entry-queries.ts` factory.

**Action (When):** Per-scenario request.

**Assertion (Then):**
- TS-4.4: GET `/entry/<uuid>` with entry mock returning `visibility: "shared"`. Response HTML contains the icon SVG.
- TS-4.5: Build two entries (shared and private). For the private entry's view (`/entry/<uuid-private>`), assert the icon SVG marker is NOT present. Four sub-assertions inline: browse list rendering, dashboard list rendering, trash list rendering, entry-view page — all checked via their respective routes within the same test or via focused assertions on the entry-view route here, with the other three surfaces covered by inverse assertions in their respective test files (as negative-case companions to TS-4.1, TS-4.2, TS-4.3).

  **Pragmatic approach:** Keep TS-4.5 as a single `web-entry.test.ts` scenario asserting absence on the entry-view page. Add three small inverse assertions in `web-dashboard.test.ts`, `web-browse.test.ts`, and `web-trash.test.ts` under the same TS-4.5 comment. This avoids cross-file imports while preserving the behavioral contract.

- TS-4.6: GET `/entry/<uuid>/edit` for an entry with `visibility: "private"`. Assert response HTML contains a `<input type="radio" name="visibility" value="private" checked>` (or equivalent `<select>`/`<button>` markup showing the current value selected). Match on the markup string `name="visibility"` near `checked`.
- TS-4.7: POST `/entry/<uuid>/edit` with form body including `visibility=shared`. Assert `vi.mocked(updateEntry)` was called with an object whose `visibility === "shared"`. Response is 303 to `/entry/<uuid>`.
- TS-4.8: POST `/entry/<uuid>/edit` with `visibility=public`. Assert `res.status === 422`. Assert `vi.mocked(updateEntry)` was NOT called. Response body contains a visible error message related to visibility.
- TS-8.2: POST `/entry/<uuid>/delete`. Assert `vi.mocked(softDeleteEntry)` was called. Since it's a stubbed function, the test asserts the call shape and does not actually mutate — but the integration counterpart (TS-7.3-adjacent) can verify preservation via real DB if needed. For the unit-level assertion: `softDeleteEntry` is called with only `(sql, id)`, **not with a visibility arg**, guarding against a regression where soft-delete starts silently rewriting visibility.
- TS-8.3: POST `/entry/<uuid>/restore`. Same pattern — `restoreEntry` called with `(sql, id)` only.

#### Note on TS-4.9 already covered

TS-4.9 asserts no-filter behavior on the dashboard. A companion assertion in `web-browse.test.ts` should assert the same for browse. One-line inverse check already satisfies.

---

### Group 5 — MCP tools (`tests/unit/mcp-server.test.ts`)

| TS | Test function |
|---|---|
| TS-5.1 | `it("search_brain payload includes visibility for each result")` |
| TS-5.2 | `it("list_recent payload includes visibility for each entry")` |
| TS-5.3 | `it("get_entry payload includes visibility")` |
| TS-5.4 | `it("add_thought with explicit visibility='private' stores as private even when LLM inferred shared")` |
| TS-5.5 | `it("add_thought with explicit override bypasses the confidence fail-safe")` |
| TS-5.6 | `it("add_thought with invalid visibility returns an error and does not insert")` |
| TS-5.7 | `it("update_entry with only visibility updates just that field")` |
| TS-5.8 | `it("update_entry with invalid visibility returns an error and does not modify the entry")` |

**Setup (Given):** Existing file uses direct handler-function testing (handlers accept `(sql, params)` and return `ToolResult`). Mocks:
```ts
vi.mock("../../src/mcp-queries.js", () => ({
  searchBySimilarity: vi.fn(),
  insertMcpEntry: vi.fn(),
  listRecentEntries: vi.fn(),
  getEntryById: vi.fn(),
  updateEntryFields: vi.fn(),
  softDeleteEntry: vi.fn(),
  getBrainStats: vi.fn(),
}));
vi.mock("../../src/classify.js", () => ({
  classifyText: vi.fn(),
  assembleContext: async () => [],
}));
vi.mock("../../src/embed.js", () => ({
  generateEmbedding: async () => null,
}));
vi.mock("../../src/google-calendar.js", () => ({
  processCalendarEvent: vi.fn(),
  handleEntryCalendarCleanup: vi.fn(),
  getCalendarNames: async () => [],
}));
vi.mock("../../src/task-completion.js", () => ({
  detectTaskCompletion: vi.fn(),
}));
```

**Action (When):** Direct call to the exported handler: `await handleSearchBrain(sql, { query: "x" })`.

**Assertion (Then):**

- TS-5.1: Mock `searchBySimilarity` to return `[{ id, category, name, content, tags, similarity, created_at, visibility: "shared" }]`. Call `handleSearchBrain`. Parse `JSON.parse(result.content[0].text)` and assert each item has `visibility` equal to the stored value.
- TS-5.2: Same pattern for `handleListRecent` / `listRecentEntries`.
- TS-5.3: Same pattern for `handleGetEntry` / `getEntryById`.
- TS-5.4: Mock `classifyText.mockResolvedValue({ ..., visibility: "shared", confidence: 0.9, ... })`. Call `handleAddThought(sql, { text: "...", visibility: "private" })`. Assert `vi.mocked(insertMcpEntry)` was called with `visibility: "private"` in its `data` arg.
- TS-5.5: Same as TS-5.4 but with `classifyText` returning `confidence: 0.45`. Assert `insertMcpEntry` called with `visibility: "shared"` (override wins, fail-safe skipped because the value is explicit).
- TS-5.6: Call `handleAddThought(sql, { text: "...", visibility: "public" })`. Assert:
  - Returned `ToolResult.isError === true`.
  - `vi.mocked(insertMcpEntry).toHaveBeenCalledTimes(0)`.
- TS-5.7: Mock `getEntryById.mockResolvedValue({ id, name: "X", category: "ideas", visibility: "private", ... })`. Call `handleUpdateEntry(sql, { id, visibility: "shared" })`. Mock `updateEntryFields.mockResolvedValue({ id, name: "X", category: "ideas", visibility: "shared", ... })`. Assert:
  - `updateEntryFields` called with updates object `{ visibility: "shared" }` (NOT containing `name` or `category`).
  - Returned payload has `visibility === "shared"`, `name === "X"`, `category === "ideas"`.
- TS-5.8: Call `handleUpdateEntry(sql, { id, name: "Y", visibility: "public" })`. Assert:
  - Returned `ToolResult.isError === true`.
  - `vi.mocked(updateEntryFields).toHaveBeenCalledTimes(0)` — no write happened despite the valid `name` also being submitted.

**Failure guarantee:** The current MCP handlers don't read or write `visibility`. All 8 scenarios fail.

---

### Group 6 — SSE payload (`tests/integration/db-notify-integration.test.ts`)

| TS | Test function |
|---|---|
| TS-6.1 | `it("entry:created NOTIFY payload includes visibility")` |
| TS-6.2 | `it("entry:updated NOTIFY payload includes visibility")` |
| TS-6.3 | `it("entry:deleted NOTIFY payload carries only id")` |
| TS-6.4 | `it("visibility-only UPDATE fires an entry:updated event")` |

**Setup (Given):** Existing file's pattern — open a second `sql` connection, call `sql.listen("entries_changed", (payload) => ...)` to capture events. `setupTestDB()` runs migrations so the trigger is in place.

**Action (When):**
- TS-6.1: `INSERT INTO entries (name, category, source, visibility) VALUES ('x', 'tasks', 'telegram', 'shared')`.
- TS-6.2: Given an existing entry, `UPDATE entries SET category = 'ideas' WHERE id = ...` (any non-visibility field change).
- TS-6.3: `UPDATE entries SET deleted_at = NOW() WHERE id = ...`.
- TS-6.4: Given an existing entry with `visibility='private'`, `UPDATE entries SET visibility = 'shared' WHERE id = ...`.

**Assertion (Then):** Wait for the listener to receive the payload (use a `Promise<any>` that resolves in the listener callback; `await Promise.race([received, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 3000))])` for robustness). Parse as JSON and assert:

- TS-6.1: `payload.type === "entry:created"`, `payload.data.visibility === "shared"`.
- TS-6.2: `payload.type === "entry:updated"`, `payload.data.visibility === "private"` (the unchanged stored value).
- TS-6.3: `payload.type === "entry:deleted"`, `payload.data === { id: <uuid> }`. Assert `"visibility" in payload.data === false`.
- TS-6.4: A single payload of `type === "entry:updated"` is received. `payload.data.visibility === "shared"`.

**Failure guarantee:** The trigger in `src/db/index.ts` currently does not include `visibility` in the payload `jsonb_build_object`; all four fail once the trigger spec is updated. (TS-6.4 additionally fails because the current skip condition ignores visibility changes.)

---

### Group 7 — DB schema and shared constants

#### `tests/integration/entry-visibility-integration.test.ts`

| TS | Test function |
|---|---|
| TS-7.1 | `it("entries.visibility column exists with NOT NULL DEFAULT 'private' and CHECK constraint")` |
| TS-7.2 | `it("raw INSERT with invalid visibility value is rejected by Postgres")` |
| TS-7.3 | `it("new rows default to visibility='private' when not specified")` |

**Setup (Given):** Standard `setupTestDB()` pgvector container.

**Action (When):**
- TS-7.1: `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='entries' AND column_name='visibility'`. Then `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='entries'::regclass` and search for a check matching visibility.
- TS-7.2: `await sql.unsafe("INSERT INTO entries (name, category, source, visibility) VALUES ('x', 'tasks', 'telegram', 'public') RETURNING id")` — expect rejection.
- TS-7.3: `INSERT INTO entries (name, category, source) VALUES ('x', 'tasks', 'telegram') RETURNING visibility`.

**Assertion (Then):**
- TS-7.1: Column row returned, `data_type === "text"`, `is_nullable === "NO"`, `column_default` matches `'private'` pattern. At least one CHECK constraint on the table whose definition contains `visibility` and both `'private'` and `'shared'`.
- TS-7.2: The call throws; catch the error and assert the Postgres error code is `23514` (check_violation).
- TS-7.3: The RETURNING row has `visibility === "private"`.

#### `tests/unit/entry-visibility-wiring.test.ts`

| TS | Test function |
|---|---|
| TS-7.4 | `it("src/web/shared.ts exports VISIBILITY_VALUES and Visibility type")` |

**Setup (Given):** Import `* as shared` from `../../src/web/shared.js`.

**Action (When):** Inspect `shared.VISIBILITY_VALUES`.

**Assertion (Then):** 
- `Array.isArray(shared.VISIBILITY_VALUES)` is true.
- `[...shared.VISIBILITY_VALUES]` equals `["private", "shared"]`.
- The array is a `const` tuple (TS compile-time check via assignment to a union-typed variable; runtime check: attempting to `push` throws in strict mode OR verify via `Object.isFrozen(VISIBILITY_VALUES)`, depending on implementation).
- Type-only export (`Visibility`) — verified via a type assertion line that triggers compile error if the type is missing or wrong: `const _v: Visibility = "private";` at the top of the file is enough to enforce at compile time. Runtime test can stop at the array check.

---

### Group 8 — Edge cases & non-goal guards

#### `tests/integration/entry-visibility-integration.test.ts`

| TS | Test function |
|---|---|
| TS-8.1 | `it("concurrent webapp edit and Telegram toggle resolve to last-writer-wins")` |

**Setup (Given):** Seed one entry with `visibility='private'`.

**Action (When):** Fire two UPDATEs in sequence (not truly concurrent, since we're testing standard UPDATE semantics, not locking): first UPDATE sets `visibility='shared'` (representing the webapp edit). Second UPDATE sets `visibility='private'` (representing the Telegram toggle, arriving after). Both commit.

**Assertion (Then):** Final stored visibility is `'private'`. Sequential UPDATE semantics guarantee this; the test exists to document and guard the expectation.

*Note:* This test does not attempt to induce a race at the DB level — the behavioral contract is last-writer-wins under standard UPDATE semantics, not a locking guarantee. If Phase 5 were to introduce any kind of optimistic lock or CAS, this test would need revision, but the current spec explicitly disclaims such mechanisms (EC-12).

#### TS-8.2, TS-8.3, TS-8.4, TS-8.5

Covered in Group 3 (Telegram) and Group 4 (web-entry) sections above. See per-scenario mappings there.

---

## Fixtures & Test Data

### Existing helpers used as-is

- `tests/helpers/test-db.ts:setupTestDB()` — pgvector container + migrations. Used by every integration test in this feature.
- `tests/helpers/mock-sql.ts:createMockSql(...)` — query-recording mock SQL. Used in Group 3, 4, 5 unit tests.
- `tests/helpers/mock-telegram.ts:createMockTelegramCtx(...)` / `createMockVoiceCtx(...)` — ctx builders for Telegram handler tests (Group 3).
- `tests/helpers/mock-ollama.ts:createOllamaRouter()` — already used where Ollama fetches happen.
- `tests/helpers/session.ts:TEST_SECRET, signForTest, cookieHeaderFor` — used for session cookies in webapp tests (Group 4).

### New helper additions

**None required.** All setup composes from existing helpers plus scenario-specific inline mocks.

### Test data conventions

- **UUIDs in mocks:** use the deterministic value `"00000000-0000-0000-0000-000000000001"` (and increment the trailing digits for multi-entry scenarios) so tests are grepable.
- **Entry rows:** inline object literals with explicit fields — no shared factory, matching the codebase style.
- **Entries seeded in integration tests:** insert via `sql.unsafe(...)` directly, or via `insertMcpEntry(sql, {...})` when the goal is to exercise the full insert path. For visibility-specific tests, raw `sql.unsafe` with explicit `visibility` value is clearest.

### Setup/teardown

- **Unit tests:** `beforeEach`: `vi.clearAllMocks()`. `afterEach`: `vi.restoreAllMocks()`, `vi.useRealTimers()`. No shared state between tests.
- **Integration tests:** `beforeAll`: `await setupTestDB()`. `afterAll`: container teardown. `beforeEach`: `TRUNCATE entries RESTART IDENTITY CASCADE` where needed for isolation.

## Alignment Check

**Full alignment.** All 49 test scenarios from the test specification are mapped to a test function with setup, action, and assertion defined.

Per-group:
- Group 1: 8 scenarios → 8 new functions in `classify.test.ts`.
- Group 2: 3 scenarios → 1 in `display-tasks.test.ts`, 1 in `display-calendar.test.ts`, 1 in `entry-visibility-integration.test.ts` (new file).
- Group 3: 10 scenarios (8 from Group 3 + 2 Group-8 crossovers) → 10 new functions in `telegram-bot.test.ts`.
- Group 4: 9 scenarios → spread across `web-dashboard.test.ts` (2), `web-browse.test.ts` (1), `web-trash.test.ts` (1), `web-entry.test.ts` (5).
- Group 5: 8 scenarios → 8 new functions in `mcp-server.test.ts`.
- Group 6: 4 scenarios → 4 new functions in `db-notify-integration.test.ts`.
- Group 7: 4 scenarios → 3 in `entry-visibility-integration.test.ts`, 1 in `entry-visibility-wiring.test.ts` (new file).
- Group 8: 5 scenarios → 1 in `entry-visibility-integration.test.ts`, 4 covered by Group-3 and Group-4 mappings above.

**Total new/updated test functions:** 49 (one per TS).

**Initial failure guarantee.** Every new test fails on current `main` because:

1. The `visibility` column does not exist (integration tests hit Postgres schema errors immediately).
2. `validateClassificationResponse` in `src/classify.ts` does not parse a `visibility` field.
3. `prompts/classify.md` does not document visibility.
4. `src/web/shared.ts` does not export `VISIBILITY_VALUES` or a `Visibility` type.
5. `src/display/task-data.ts:getDisplayTasks` does not filter by visibility.
6. `src/telegram.ts` does not emit the `👁` glyph or visibility toggle button, does not handle `visibility:...` callback_data.
7. `src/web/entry.ts` edit form has no visibility control.
8. `src/web/{dashboard,browse,trash}.ts` do not render the shared icon.
9. `src/mcp-tools.ts` handlers do not accept or return `visibility`.
10. `src/db/index.ts` trigger does not include `visibility` in the NOTIFY payload, and skips visibility-only UPDATE events.

**Design concerns:** Two items that Phase 4/5 should be aware of, already flagged inline:

- **Fail-safe placement (Group 1).** The confidence-threshold fail-safe (AC-1.4) historically lives at the caller (Telegram handler's `isConfident` check). Moving it into `classifyText` itself is cleaner but a Phase-5 refactor call. The tests assert the **observable effect** — what gets stored — so they will pass under either implementation choice.
- **Low-confidence reply state (Group 3, TS-3.3/3.4).** The test spec resolves the ambiguity in favor of "reply reflects stored (post-fail-safe) value." Phase 5 must implement accordingly: on a low-confidence reply, the reply text and glyph reflect the stored-private value, even though the LLM's raw output may have been "shared."

Neither concern blocks Phase 4.

## Handoff prompt for Phase 4

```
Implement the failing tests for the entry-visibility feature per the test-implementation spec.

References:
- Behavioral specification: docs/specs/entry-visibility-specification.md
- Test specification:       docs/specs/entry-visibility-test-specification.md
- Test implementation spec: docs/specs/entry-visibility-test-implementation-specification.md

Constraint: every new test MUST FAIL when first run. The feature code does not yet exist
(no `visibility` column, no `VISIBILITY_VALUES` export, no visibility parsing in classify,
no toggle button in telegram.ts, no icon in webapp lists, no `visibility` in MCP tool
payloads, no trigger-payload extension). A test that passes against current main is
wrong — check your assertions.

Do NOT modify test files in any way that bypasses this. Do not add `.skip()` or `.todo()`.

Stack: Node.js + TypeScript (ESM), Vitest.
Test framework conventions:
  - `vi.mock("…")` factories at module top.
  - Plain async closures for stable default return values (NOT `vi.fn().mockResolvedValue(...)` for stable defaults — `vi.restoreAllMocks()` wipes those).
  - `vi.fn()` only for mocks that tests need to spy on or override per-test.
  - Existing helpers: `tests/helpers/test-db.ts`, `mock-sql.ts`, `mock-telegram.ts`, `mock-ollama.ts`, `session.ts`, `env.ts`. Do not create new helpers unless the test-impl spec calls for it.
  - Integration tests use `setupTestDB()` (pgvector/pgvector:pg16 via testcontainers).

After implementing:
  1. Run `npm run test:unit` and confirm the full unit suite increases by exactly the new-test count and that every new test FAILS.
  2. Run `npm run test:integration` and confirm the new integration tests FAIL while pre-existing integration tests remain GREEN (787/787 unit + 169/169 integration pre-existing must still pass).
  3. If any pre-existing test regresses, stop and investigate; do NOT adjust assertions to make it pass.
```
