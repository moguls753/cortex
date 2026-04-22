# Browse Filters — Test Implementation Specification

## Test Framework & Conventions

- **Runner:** Vitest (existing project test runner per `package.json`).
- **Assertion library:** Vitest's built-in `expect`.
- **Project conventions followed here** (mirroring the house style already used across cortex test files):
  - `describe`/`it`/`expect` from `vitest`.
  - Module-level `vi.mock("…")` factories to stub DB, embedding, and settings seams.
  - Plain async closures for stable default return values inside `vi.mock` factories — not `vi.fn().mockResolvedValue(...)` — because `vi.restoreAllMocks()` wipes `mockResolvedValue` from factory-created `vi.fn()` instances. Per-test overrides use `vi.fn()`.
  - `beforeEach`: `vi.clearAllMocks()`. `afterEach`: `vi.restoreAllMocks()`.
  - Existing helpers reused: `tests/helpers/test-db.ts` (`startTestDb`, `runMigrations`), `tests/helpers/mock-sql.ts`.
  - Factory-pattern routes: `createDashboardRoutes(sql, broadcaster)`, `createBrowseRoutes(sql)`, `createTrashRoutes(sql)`. Test apps mount the relevant factories with mock `sql` (unit) or real `sql` (integration).
  - HTML assertion style: regex/substring matching on the response body (`expect(html).toMatch(/pattern/)`, `expect(html).toContain("...")`) — no cheerio/jsdom unless a scenario demands it.
  - Response-body reads: `await res.text()` on Hono responses.
  - Session helpers from `tests/helpers/session.ts` for authenticated requests.
- **JSDOM use is limited** to the single scenario (TS-1.12) that requires invoking `document.querySelector` against the parsed HTML. The `jsdom` package is already a transitive dependency via `@types/sanitize-html`; if not directly installed, the scenario can use `linkedom` which ships in the existing tree via Hono testing utilities. Phase 4 confirms the path — if neither is available, the scenario degrades to regex assertion that the `<span data-stat="...">` sits inside the card anchor.

## Test Structure

### File organization

All scenarios live in existing files. No new test files are introduced in this feature — the test scenarios extend the files that already cover browse and dashboard behavior.

| File | New / Updated | Scenarios |
|---|---|---|
| `tests/unit/web-dashboard.test.ts` | Updated | TS-1.1, TS-1.2, TS-1.3, TS-1.4, TS-1.5, TS-1.6, TS-1.9, TS-1.10, TS-1.11, TS-1.12, TS-5.10 |
| `tests/unit/web-browse.test.ts` | Updated | TS-2.16, TS-2.17, TS-2.18, TS-2.19, TS-2.20, TS-2.21, TS-3.1, TS-3.2, TS-3.3, TS-3.4, TS-3.5, TS-3.6, TS-3.7, TS-3.8, TS-3.9, TS-3.10, TS-3.11, TS-3.12, TS-3.13, TS-3.14a, TS-3.14b, TS-3.14c, TS-3.15, TS-3.16, TS-3.17, TS-3.18, TS-3.19, TS-3.20, TS-3.21, TS-3.22, TS-3.23, TS-3.24, TS-3.25, TS-3.26, TS-4.1, TS-4.2, TS-4.3, TS-4.4, TS-4.5, TS-4.6, TS-5.1, TS-5.2, TS-5.3, TS-5.4, TS-5.5, TS-5.6, TS-5.8, TS-5.9 |
| `tests/unit/web-trash.test.ts` | Updated | TS-4.7 |
| `tests/integration/web-dashboard-integration.test.ts` | Updated | TS-1.7, TS-1.8 |
| `tests/integration/web-browse-integration.test.ts` | Updated | TS-2.1, TS-2.2, TS-2.3, TS-2.4, TS-2.5, TS-2.6, TS-2.7, TS-2.8, TS-2.9, TS-2.10, TS-2.11, TS-2.12, TS-2.13, TS-2.14, TS-2.15, TS-2.22, TS-2.23, TS-5.7 |

### Test grouping

Each updated file adds a new `describe` block named `"browse filters"` (or a subgroup per TS group) that groups the new scenarios. Scenario IDs appear as `// TS-X.Y` leading comments on each `it` block, matching the existing cortex pattern.

### Naming conventions

Test names describe observable behavior:

- `it("renders each stat card as an anchor with the expected href")`
- `it("preserves [data-stat] spans inside the new anchor wrappers")`
- `it("returns 400 for unknown since= value")`
- `it("renders a Status: Pending pill with a remove control for status=pending")`
- `it("status picker options adapt to category=tasks")`

## Test Scenario Mapping

### Group 1 — Dashboard stat cards (`tests/unit/web-dashboard.test.ts`)

| TS | Test function |
|---|---|
| TS-1.1 | `it("renders each stat card as an <a> element wrapping icon + number + label")` |
| TS-1.2 | `it("preserves [data-stat] spans inside the anchor wrappers")` |
| TS-1.3 | `it("entries-week card href is /browse?since=week")` |
| TS-1.4 | `it("entries-total card href is /browse")` |
| TS-1.5 | `it("open-tasks card href is /browse?category=tasks&status=pending")` |
| TS-1.6 | `it("stalled card href is /browse?category=projects&status=active&stale_days=5")` |
| TS-1.9 | `it("renders hover:border-primary and hover:bg-secondary on each stat card anchor")` |
| TS-1.10 | `it("stat card anchors are focus-targets (no tabindex=-1 override)")` |
| TS-1.11 | `it("renders stat cards as anchors even when counts are zero")` |
| TS-1.12 | `it("[data-stat] selectors resolve to a single element inside the anchor wrapper")` |
| TS-5.10 | `it("does not wrap the digest panel, capture form, or service-status block in new anchors")` |

**Setup (Given):**

- Extend the existing `vi.mock` stack already present in `tests/unit/web-dashboard.test.ts`:
  - `vi.mock("../../src/web/dashboard-queries.js", () => ({
      getRecentEntries: vi.fn().mockResolvedValue([]),
      getDashboardStats: vi.fn().mockResolvedValue({
        entriesThisWeek: 0, totalEntries: 0, openTasks: 0, stalledProjects: 0,
      }),
      getLatestDigest: async () => null,
      insertEntry: vi.fn(),
    }))` — already present, reuse.
  - Service-check and SSE-broadcaster mocks — already present.
- Per-test override of `getDashboardStats` to seed specific counts (e.g., 3/14/7/0 for TS-1.1 baseline).
- `createTestDashboard()` helper — already present.
- Authenticated request: `await app.request("/", { headers: { cookie: sessionCookie } })` followed by `await res.text()`.

**Action (When):** Issue `GET /` with an authenticated cookie; read the HTML body.

**Assertion (Then):**

- **TS-1.1** — parse the four stat cards by their `data-stat` attribute. Assert each is contained within an `<a …>` tag via regex:
  ```ts
  for (const key of ["entries-week", "entries-total", "open-tasks", "stalled"]) {
    const pattern = new RegExp(
      `<a\\b[^>]*href="[^"]*"[^>]*>\\s*[\\s\\S]*?data-stat="${key}"`,
    );
    expect(html).toMatch(pattern);
  }
  ```
- **TS-1.2** — assert `[data-stat="X"]` appears exactly once per key (defends against accidental duplication during the anchor wrap):
  ```ts
  const count = (s: string, sub: string) => (s.match(new RegExp(sub, "g")) || []).length;
  for (const key of KEYS) {
    expect(count(html, `data-stat="${key}"`)).toBe(1);
  }
  ```
- **TS-1.3 – TS-1.6** — extract each card's anchor `href` using a regex and assert exact equality with the destination URL. Helper:
  ```ts
  function hrefForStat(html: string, key: string): string | null {
    const re = new RegExp(
      `<a\\b[^>]*href="([^"]+)"[^>]*>[\\s\\S]*?data-stat="${key}"`,
    );
    return html.match(re)?.[1] ?? null;
  }
  expect(hrefForStat(html, "entries-week")).toBe("/browse?since=week");
  // … similar for the other three
  ```
- **TS-1.9** — assert the anchor's class list contains `hover:border-primary` and `hover:bg-secondary`:
  ```ts
  const re = new RegExp(
    `<a\\b[^>]*class="[^"]*hover:border-primary[^"]*hover:bg-secondary[^"]*"[^>]*>[\\s\\S]*?data-stat="${key}"`,
  );
  ```
  (Order-insensitive via a second check if needed.)
- **TS-1.10** — negate-match `tabindex="-1"` on each stat card anchor:
  ```ts
  expect(html).not.toMatch(/data-stat="entries-week"[\s\S]*?tabindex="-1"/);
  ```
  And positively assert that each card anchor has a defined `href` (already covered by TS-1.3..6).
- **TS-1.11** — override `getDashboardStats` to return all zeros; assert the anchors and hrefs still render (same assertions as TS-1.1 and TS-1.3..6).
- **TS-1.12** — load the response HTML into JSDOM (or `linkedom`); invoke `doc.querySelectorAll("[data-stat]")`; assert four elements are returned; for each, assert `closest("a[href]")` is non-null.
  
  Fallback if JSDOM is unavailable in this test env: regex-assert that every `data-stat="..."` appears strictly after a `<a href=...>` and before its closing `</a>` on the same card.
- **TS-5.10** — positive and negative regex checks:
  - Positive: the dashboard still contains `<form id="capture-form">` (capture area unchanged) and `data-digest` (digest panel unchanged).
  - Negative: the capture form, digest panel, and service-status blocks are not themselves wrapped in new `<a>` tags introduced by this feature. Specifically assert that `<form id="capture-form">` does not have an enclosing `<a>` parent in the response.

**Failure guarantee:** All tests fail on current `main` because `renderStats` in `src/web/dashboard.ts` currently renders `<div>` elements, not anchors. TS-1.12 fails because no anchor wraps the `[data-stat]` span today.

---

### Group 2 — New query params (`tests/integration/web-browse-integration.test.ts`)

Integration tests because the new filter predicates (`date_trunc`, JSONB extract, `interval`) require real PostgreSQL. Semantic/text search scenarios also need real pgvector.

| TS | Test function |
|---|---|
| TS-2.1 | `it("since=today returns only entries created today")` |
| TS-2.2 | `it("since=week returns only entries created this week")` |
| TS-2.3 | `it("since=month returns only entries created this month")` |
| TS-2.4 | `it("status=pending returns only entries with fields.status='pending'")` |
| TS-2.5 | `it("status=done returns only entries with fields.status='done'")` |
| TS-2.6 | `it("status=active returns only entries with fields.status='active'")` |
| TS-2.7 | `it("status=paused returns only entries with fields.status='paused'")` |
| TS-2.8 | `it("status=completed returns only entries with fields.status='completed'")` |
| TS-2.9 | `it("stale_days=5 returns only entries updated_at < now() - 5 days")` |
| TS-2.10 | `it("stale_days=100000 returns an empty list with status 200")` |
| TS-2.11 | `it("category=tasks and status=pending compose with AND semantics")` |
| TS-2.12 | `it("status=pending and tag=work compose with AND semantics")` |
| TS-2.13 | `it("semantic search with status=pending returns only pending entries ranked by similarity")` |
| TS-2.14 | `it("since uses date_trunc in PG server timezone — boundary entries land on expected side")` |
| TS-2.15 | `it("entries without fields.status are excluded from status= filter")` |
| TS-2.22 | `it("semantic search with stale_days post-filters by updated_at, preserves similarity order")` |
| TS-2.23 | `it("text search (mode=text) with status=pending returns only pending entries matching text")` |
| TS-5.7 | `it("category=people with status=pending returns empty list with Clear-filters empty state")` |

**Setup (Given):**

- `startTestDb()` + `runMigrations()` at the `beforeAll` level (existing convention).
- `beforeEach`: `await sql\`TRUNCATE entries CASCADE\`` to isolate test state.
- `createMockEntry` factory already exists; extend calls with `created_at`, `updated_at`, and `fields` overrides as needed per scenario.
- Insert entries via `sql.unsafe(INSERT …)` or the helper already present in the integration file.
- `createTestBrowse()` equivalent for integration: mount `createBrowseRoutes(sql)` and `createAuthRoutes/Middleware` on a fresh Hono app; login to obtain a session cookie (via existing helper).
- For semantic search scenarios (TS-2.13, TS-2.22): seed entries with deterministic embeddings using `createSimilarEmbedding` / `createDissimilarEmbedding` helpers already defined in the integration file.

**Action (When):** `await app.request("/browse?<params>", { headers: { cookie } })`.

**Assertion (Then):**

- **TS-2.1 – TS-2.3** — Insert entries with `created_at` values straddling `date_trunc('today'|'week'|'month', CURRENT_DATE)`. Parse the response HTML; extract the rendered entry `name` attributes or count the `<a href="/entry/...">` rows in the entry list. Assert exact match of names.
  
  Helper for extraction:
  ```ts
  function entryLinks(html: string): string[] {
    return [...html.matchAll(/<a href="\/entry\/([^"]+)"/g)].map((m) => m[1]);
  }
  ```

- **TS-2.4 – TS-2.8** — Seed entries whose JSONB `fields.status` matches and mismatches the filter. Assert only the matching entries appear in the response.

  Because `postgres.js` wraps `JSON.stringify` as a JSON-string value (not a JSON object) in JSONB columns, use `sql.json({ status: "pending" })` — **not** bare `{ status: "pending" }` — when inserting. This mirrors the known project gotcha documented in the MCP Server implementation decisions (user memory).

- **TS-2.9** — Insert 4 entries: 2 with `updated_at = now() - '10 days'::interval`, 2 with `updated_at = now() - '2 days'::interval`. Query `?stale_days=5`. Assert the 2 older entries appear.

- **TS-2.10** — With any entries present, query `?stale_days=100000`. Assert `res.status === 200` and the response contains the localized empty-state text (regex match on the substring — avoid pinning to an exact string in case the catalog wording changes).

- **TS-2.11** — Seed: 2 pending tasks, 1 done task, 1 pending project. Query `?category=tasks&status=pending`. Assert exactly the 2 pending tasks appear.

- **TS-2.12** — Seed: 2 pending-tagged-work tasks, 1 pending-tagged-home, 1 done-tagged-work. Query `?status=pending&tag=work`. Assert exactly the 2 matching entries appear.

- **TS-2.13** — Seed tasks with unit-vector embeddings (`createQueryEmbedding`, `createSimilarEmbedding`, `createDissimilarEmbedding`). Half `fields.status='pending'`, half `'done'`. Mock `generateEmbedding` to return the query embedding. Query `?q=test&status=pending`. Assert only pending entries appear and they appear in similarity order (IDs list matches the expected similarity-sorted order).

- **TS-2.14** — Insert two entries with explicit `created_at`:
  - `A`: `CURRENT_DATE + interval '1 second'` (strictly today)
  - `B`: `CURRENT_DATE - interval '1 second'` (strictly yesterday)
  
  Query `?since=today`. Assert `A` is present, `B` is absent. Timezone pinning is handled by PG's default timezone (test container runs UTC by default, matching the production image); the assertion is about `date_trunc('day', CURRENT_DATE)` behavior, not absolute clock time.

- **TS-2.15** — Seed: 1 idea with `fields = { oneliner: "...", notes: "..." }` (no `status` key), 1 task with `fields = { status: "pending" }`. Query `?status=pending`. Assert only the task is present.

- **TS-2.22** — Seed 3 entries with similar embeddings and `updated_at` at 10/2/20 days ago. Query `?q=test&stale_days=7`. Assert B (updated 2d ago) is absent; A (10d) and C (20d) are present. Extract entry IDs from the response HTML, assert they appear in similarity-ranked order — not staleness order.

- **TS-2.23** — Seed: 2 pending tasks with "launch" in `name` or `content`, 1 done task with "launch" in `name`. Query `?q=launch&mode=text&status=pending`. Assert exactly the 2 pending tasks appear.

- **TS-5.7** — Insert entries across categories; none with `category='people'` and `fields.status='pending'`. Query `?category=people&status=pending`. Assert `res.status === 200`, entry list is empty, and response contains the "Clear filters" link HTML (regex for an anchor with localized "Clear filters" label pointing to `/browse?category=people` — the category is preserved per AC-3.10).

**Failure guarantee:** All tests fail on current `main` because `browse-queries.ts` has no support for `since`, `status`, or `stale_days` params. Handler-level parsing in `src/web/browse.ts` similarly does not accept these params.

---

### Group 3 — Parameter validation + filter bar rendering (`tests/unit/web-browse.test.ts`)

Unit tests because validation and HTML-rendering behavior is pure handler logic with mocked queries. No DB needed.

| TS | Test function |
|---|---|
| TS-2.16 | `it("returns 400 for since=yesterday (not in enum)")` |
| TS-2.17 | `it("returns 400 for status=typo (not in enum)")` |
| TS-2.18 | `it("returns 400 for stale_days=0")` |
| TS-2.19 | `it("returns 400 for stale_days=-5")` |
| TS-2.20 | `it("returns 400 for stale_days=1.5")` |
| TS-2.21 | `it("returns 400 for stale_days=abc")` |
| TS-3.1 | `it("renders the filter bar container on /browse with no active filters")` |
| TS-3.2 | `it("renders an 'Updated: This week' pill for since=week")` |
| TS-3.3 | `it("renders a 'Status: Pending' pill for status=pending")` |
| TS-3.4 | `it("renders an 'Inactive: 5+ days' pill for stale_days=5")` |
| TS-3.5 | `it("renders pills in English by default")` |
| TS-3.6 | `it("renders pills in German when the locale is 'de'")` |
| TS-3.7 | `it("renders 'Inactive: 1+ day' using singular pluralization")` |
| TS-3.8 | `it("× on a pill removes only that param, preserving others")` |
| TS-3.9 | `it("removing the last structured filter leaves only category and q if present")` |
| TS-3.10 | `it("pill value element carries a data-attribute that opens the picker on click")` |
| TS-3.11 | `it("'+ Filter' menu omits dimensions already applied")` |
| TS-3.12 | `it("'+ Filter' menu offers all three dimensions when none are active")` |
| TS-3.13 | `it("'+ Filter' button is omitted when all three dimensions are active")` |
| TS-3.14a | `it("'+ Filter' dimension menu contains exactly Status, Updated, Inactive options")` |
| TS-3.14b | `it("dimension menu item carries a data-attribute that opens the matching value picker")` |
| TS-3.14c | `it("value picker options link to the URL with the new param appended")` |
| TS-3.15 | `it("status picker offers only Pending/Done when category=tasks")` |
| TS-3.16 | `it("status picker offers only Active/Paused/Completed when category=projects")` |
| TS-3.17 | `it("status picker offers the full union when no category is set")` |
| TS-3.18 | `it("since picker always offers Today, This week, This month")` |
| TS-3.19 | `it("stale_days picker offers only the presets 5, 14, 30")` |
| TS-3.20 | `it("renders 'No entries match' when result set is empty")` |
| TS-3.21 | `it("renders '1 entry matches' when result set has one entry")` |
| TS-3.22 | `it("renders '{N} entries match' when result set has multiple entries")` |
| TS-3.23 | `it("renders a Clear filters link when at least one filter is active")` |
| TS-3.24 | `it("Clear filters href preserves category and q; drops tag, since, status, stale_days")` |
| TS-3.25 | `it("empty-state view includes a Clear filters link when a structured filter is active")` |
| TS-3.26 | `it("empty-state view includes a Clear filters link when only a tag filter is active")` |
| TS-4.1 | `it("category tabs render with unchanged hrefs")` |
| TS-4.2 | `it("search form action=/browse method=GET with name=q input is preserved")` |
| TS-4.3 | `it("tag pill row renders with discovery pills; active tag deselects on click")` |
| TS-4.4 | `it("entry-list row format matches the existing renderEntryList output")` |
| TS-4.5 | `it("semantic-to-text fallback notice appears when embedding yields zero matches")` |
| TS-4.6 | `it("unclassified tab and Reclassify all button render when category=unclassified")` |
| TS-5.1 | `it("pill × control is a plain anchor element (not a button requiring JS)")` |
| TS-5.2 | `it("filter bar subtree contains no inline style attributes")` |
| TS-5.3 | `it("en.ts defines all required new i18n keys")` |
| TS-5.4 | `it("de.ts defines all required new i18n keys")` |
| TS-5.5 | `it("invalid param returns 400 before invoking any browse-queries function")` |
| TS-5.6 | `it("/browse?since=week redirects to /login for unauthenticated requests")` |
| TS-5.8 | `it("duplicate status params: only the first value is honored")` |
| TS-5.9 | `it("sort= param has no effect on ordering")` |

**Setup (Given):**

- Existing `vi.mock("../../src/web/browse-queries.js", …)` — extend per-test. For HTML rendering tests (Group 3), override `browseEntries` / `semanticSearch` / `textSearch` to return a predetermined array of mock entries.
- Existing `vi.mock("../../src/embed.js", …)` — keep.
- `createTestBrowse()` helper — already present.
- Authenticated request via `loginAndGetCookie()`.

**Action (When):** Issue `GET /browse?<params>` with the session cookie; read `res.status` and `await res.text()`.

**Assertion (Then):**

- **TS-2.16 – TS-2.21** — Assert `res.status === 400` and `html.toLowerCase()` contains the param name (`"since"`, `"status"`, `"stale_days"`). Using lowercase avoids false negatives from title-cased catalog strings.

- **TS-3.1** — Assert the rendered HTML contains the filter bar wrapper element (e.g., `<div data-filter-bar>` or the class selected during implementation — locked in Phase 5). The spec's stable marker is a `data-*` attribute chosen in Phase 5; the test asserts its presence. A Phase 5 decision comment annotates the chosen marker.
  
  To keep the test spec stable regardless of the Phase 5 marker choice, this test asserts a semantic invariant: an element bearing attribute `data-filter-bar` exists in the response. Phase 5 must use that attribute name.

- **TS-3.2 – TS-3.4** — Regex match the expected localized pill text combined with the expected `×` remove-anchor markup. Example for TS-3.3:
  ```ts
  expect(html).toMatch(/Status:\s*Pending/);
  expect(html).toMatch(/<a\b[^>]*href="\/browse"[^>]*>\s*×\s*<\/a>/); // the remove anchor for the only active filter
  ```
  The exact localized string comes from `en.ts` — assertions use the key value (e.g., `t("browse.filter.pill.status.pending")`) rather than hardcoded strings to avoid catalog-drift breakage. Import `i18next.getFixedT("en")` at top of the test file and use `t(key)` in the regex.

- **TS-3.5** — En locale. Already the default — assert the "Status: Pending" rendering matches the en.ts string.

- **TS-3.6** — Issue `GET /browse?status=pending&done&stale_days=14` with `Accept-Language: de` header (or cookie-selected de locale — match the approach from existing `tests/integration/ui-language-integration.test.ts`). Assert the response body contains the translated strings from `de.ts`. Test author resolves translation values via `i18next.getFixedT("de")(key)` rather than hardcoding.

- **TS-3.7** — Query `?stale_days=1`. Assert response contains the singular-pluralization variant (e.g., `"Inactive: 1+ day"` from `en.ts`'s singular form).

- **TS-3.8** — Query `?category=tasks&status=pending&since=week`. Regex-extract the `href` of the Status pill's × anchor; assert it equals `"/browse?category=tasks&since=week"`.

- **TS-3.9** — Query `?category=projects&q=alpha&status=active`. Assert the × anchor on the Status pill has href `"/browse?category=projects&q=alpha"`.

- **TS-3.10** — Pill value span/anchor carries a `data-picker="status"` (or similar) attribute that the client-side JS hooks. Assert the attribute is present.

- **TS-3.11** — Query `?status=pending`. Assert the `+ Filter` menu markup contains `Updated` and `Inactive` but not `Status`. Selector: find the filter-bar-add-menu container (`data-filter-add-menu`), assert its contents.

- **TS-3.12** — Query `/browse`. Assert the + Filter menu contains all three options.

- **TS-3.13** — Query `?status=pending&since=week&stale_days=5`. Assert `+ Filter` button / menu is absent from the response HTML.

- **TS-3.14a / b / c** — `/browse` rendered.
  - 3.14a: assert the dimension menu DOM has exactly three children labeled `Status, Updated, Inactive`.
  - 3.14b: assert each dimension-menu item has a `data-picker="<dim>"` attribute so client-side JS opens the value picker.
  - 3.14c: assert each value-picker option is an `<a href="/browse?<dim>=<value>">`. Click-equivalent: the href navigates.

- **TS-3.15 – TS-3.17** — Query with differing categories; extract the status picker's option list; assert exact content.

- **TS-3.18** — Any URL. Assert the since picker contains exactly `Today`, `This week`, `This month`.

- **TS-3.19** — Any URL. Assert the stale_days picker contains exactly three options with `value` attributes or href params `5`, `14`, `30`; negate-match any `<input type="number">` or similar free-form input widget in the stale_days picker.

- **TS-3.20 – TS-3.22** — Override `browseEntries` mock to return 0, 1, or N entries. Assert the result-count text in the response matches the i18n plural rule for `n`.

- **TS-3.23** — Query `?status=pending`. Assert response contains a `Clear filters` link (by its data-attribute or its localized text). Then query `/browse` and assert no such link is present.

- **TS-3.24** — Query `?category=tasks&q=alpha&tag=work&status=pending&since=week&stale_days=5`. Regex-extract the Clear filters href; assert equality with `"/browse?category=tasks&q=alpha"`.

- **TS-3.25** — Override `browseEntries` to return `[]`. Query `?status=pending`. Assert response contains the empty-state markup AND a Clear filters link within it.

- **TS-3.26** — Override to return `[]`. Query `?tag=nonexistent`. Assert empty state + Clear filters link with href `/browse`.

- **TS-4.1** — Assert response contains the existing category-tab anchors (`/browse?category=people`, `/browse?category=projects`, etc.) — regression assertion using the existing expected substrings from current tests.

- **TS-4.2** — Assert response contains `<form action="/browse" method="GET"` and `<input … name="q"`.

- **TS-4.3** — Override `getFilterTags` to return `["alpha", "beta", "gamma"]`. Assert the three tag pill anchors render with their expected hrefs. Then query `?tag=alpha` and assert the active tag pill href is `/browse` (deselect behavior).

- **TS-4.4** — Override `browseEntries` to return 3 mock entries. Assert each entry's markup matches the existing format (category badge span + entry name span + relative-time span), by checking for representative substrings already present in the current test suite.

- **TS-4.5** — Override `semanticSearch` to return `[]` and `textSearch` to return `[createMockEntry()]`. Query `?q=something`. Assert the notice text ("No semantic matches found. Showing text results instead." or localized equivalent) appears.

- **TS-4.6** — Override the unclassified-count mock to return a positive integer. Query `?category=unclassified`. Assert the "Reclassify all" button and form are present.

- **TS-5.1** — Assert the pill `×` control is an `<a>` tag (not `<button>`).

- **TS-5.2** — Extract the substring between `<div data-filter-bar>` and its matching closing tag; assert no `style="..."` appears in that substring.

- **TS-5.3 / TS-5.4** — Import the catalogs directly (`import { en } from "../../src/web/i18n/en.js"; import { de } from "../../src/web/i18n/de.js";`). For each expected key (enumerate the list from the behavioral spec's C-4 and AC-3.3), assert `typeof en[...key path...] === "string"` and `.length > 0`. Same for `de`.

  The key list to verify (exact paths locked in Phase 5, with these logical names):
  ```
  browse.filter.add                          (e.g. "+ Filter")
  browse.filter.clear                        (e.g. "Clear filters")
  browse.filter.dimension.status             ("Status")
  browse.filter.dimension.since              ("Updated")
  browse.filter.dimension.stale_days         ("Inactive")
  browse.filter.value.status.pending         ("Pending")
  browse.filter.value.status.done            ("Done")
  browse.filter.value.status.active          ("Active")
  browse.filter.value.status.paused          ("Paused")
  browse.filter.value.status.completed       ("Completed")
  browse.filter.value.since.today            ("Today")
  browse.filter.value.since.week             ("This week")
  browse.filter.value.since.month            ("This month")
  browse.filter.pill.status                  ("Status: {{value}}")
  browse.filter.pill.since                   ("Updated: {{value}}")
  browse.filter.pill.stale_days_one          ("Inactive: {{count}}+ day")
  browse.filter.pill.stale_days_other        ("Inactive: {{count}}+ days")
  browse.filter.results_zero                 ("No entries match")
  browse.filter.results_one                  ("1 entry matches")
  browse.filter.results_other                ("{{count}} entries match")
  ```

- **TS-5.5** — Configure `browseEntries` / `semanticSearch` / `textSearch` mocks to throw immediately when called. Query `?status=typo`. Assert `res.status === 400` and none of the three mocks were called (`expect(mock).not.toHaveBeenCalled()`).

- **TS-5.6** — Query `GET /browse?since=week` WITHOUT a cookie. Assert `res.status === 302` (or the redirect-to-login status used by the existing auth middleware) and `location` header matches `/login`.

- **TS-5.8** — Query `/browse?status=pending&status=done`. Assert the response reflects `status=pending` (the first value) — e.g., only the Status: Pending pill renders, not Status: Done.

- **TS-5.9** — Query `/browse?sort=oldest`. Assert `res.status === 200` and mock `browseEntries` was called with filters not containing a `sort` key (or, more robustly, assert the handler did not pass `sort` to the query layer).

**Failure guarantee:** All tests fail on current `main` because the filter bar, validation, and query-param parsing do not exist yet.

---

### Group 4 — Trash page (`tests/unit/web-trash.test.ts`)

| TS | Test function |
|---|---|
| TS-4.7 | `it("/trash ignores new filter params and returns 200 without the filter bar")` |

**Setup (Given):**

- Extend the existing `vi.mock("../../src/web/browse-queries.js", …)` already imported in `web-trash.test.ts` (if present) or add one.
- `createTestTrash()` helper equivalent (pattern from existing file).
- Authenticated cookie.

**Action (When):** `GET /trash?since=week&status=pending&stale_days=5`.

**Assertion (Then):** `res.status === 200`. The response HTML contains trash's existing elements (category tabs, tag pills) but does NOT contain `data-filter-bar`. Negate-match on the filter-bar marker.

**Failure guarantee:** Initially fails only if `/trash` starts validating and rejecting the new params (which it must not). Passes trivially today because `/trash` currently ignores unknown params. Phase 5 must ensure the implementation does not regress this behavior when extracting shared query-parsing logic.

---

### Group 5 — Integration: dashboard card count = browse count (`tests/integration/web-dashboard-integration.test.ts`)

| TS | Test function |
|---|---|
| TS-1.7 | `it("open-tasks card count matches GET /browse?category=tasks&status=pending entry count")` |
| TS-1.8 | `it("stalled card count matches GET /browse?category=projects&status=active&stale_days=5 entry count")` |

**Setup (Given):**

- Existing `startTestDb()` + `runMigrations()` at `beforeAll`.
- `beforeEach` truncates entries.
- Seed the DB per scenario (see TS-2.4 / TS-2.9 seeding logic).
- Mount the dashboard routes AND browse routes on the same Hono app (same `sql` instance), since the assertion spans both.

**Action (When):**
1. `GET /` — extract the numeric `textContent` of `[data-stat="open-tasks"]` (or `"stalled"`) from the response HTML.
2. `GET /browse?category=tasks&status=pending` — count `<a href="/entry/…">` links in the entry list.

**Assertion (Then):** The two numbers are equal.

  Implementation helper:
  ```ts
  function extractStatValue(html: string, key: string): number {
    const m = html.match(new RegExp(`data-stat="${key}"[^>]*>([\\d]+)<`));
    return m ? parseInt(m[1]!, 10) : -1;
  }
  function countEntryLinks(html: string): number {
    return (html.match(/<a href="\/entry\//g) || []).length;
  }
  expect(extractStatValue(dashboardHtml, "open-tasks")).toBe(countEntryLinks(browseHtml));
  ```

**Failure guarantee:** Fails on current `main` because the filters don't yet exist (browse returns all entries regardless of `status=pending`), so the counts diverge.

---

## Fixtures & Test Data

No new helper files. The feature reuses:

- `tests/helpers/test-db.ts` — `startTestDb`, `runMigrations`, `TestDb`.
- `tests/helpers/session.ts` — `loginAndGetCookie` / equivalent.
- `tests/helpers/mock-sql.ts` — only referenced by tests that need a full tagged-template mock.
- Existing `createMockEntry` factories in each test file (extended inline per scenario with `created_at` / `updated_at` / `fields` overrides).

Shared setup/teardown patterns are unchanged from the conventions already in use:

- Unit files: `beforeEach(() => vi.clearAllMocks())`; `afterEach(() => vi.restoreAllMocks())`.
- Integration files: `beforeAll` starts DB + runs migrations; `beforeEach` truncates `entries`; `afterAll` stops the container.

Seeding for JSONB fields must use `sql.json({ status: "pending" })` when inserting directly — a known project gotcha where `postgres.js` otherwise stores the stringified JSON as a JSON string value.

## Alignment Check

Every test scenario in the test specification maps to a concrete test function above:

| Group | Spec scenarios | Implementation scenarios |
|---|---|---|
| Group 1 (Dashboard stat cards) | TS-1.1 … TS-1.12 | TS-1.1–1.6, 1.9–1.12 in unit; TS-1.7, 1.8 in integration |
| Group 2 (Query params) | TS-2.1 … TS-2.23 | TS-2.16–21 in unit (validation); TS-2.1–15, 22, 23 in integration |
| Group 3 (Filter bar UI) | TS-3.1 … TS-3.26 | All in unit (`web-browse.test.ts`); TS-3.14 split into 3.14a/b/c |
| Group 4 (Existing behavior) | TS-4.1 … TS-4.7 | TS-4.1–6 in `web-browse.test.ts` unit; TS-4.7 in `web-trash.test.ts` unit |
| Group 5 (Constraints) | TS-5.1 … TS-5.10 | TS-5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9 in `web-browse.test.ts` unit; TS-5.7 in browse integration; TS-5.10 in `web-dashboard.test.ts` unit |

**Coverage verification:** No scenario is left unaddressed. Regression-only items (AC-2.6, C-1, C-6, C-7, NG-5, NG-7, NG-9 — covered by pre-existing suites, package.json diffs, or Phase 6 review) are not mapped to new test code but are explicitly documented in the test spec's coverage matrix.

**Unit / integration split summary:**
- Unit: ~49 scenarios (dashboard rendering, validation, filter bar UI, existing-behavior regressions, constraints)
- Integration: ~20 scenarios (SQL predicate correctness, semantic/text search composition, count-match across endpoints)

All new tests must FAIL on the current `main` branch before Phase 5 implementation begins.

---

## Phase 4 Handoff Prompt

Paste the following into a fresh Claude Code session (after `/clear`) to execute Phase 4 — implementation of the failing tests — without any carryover context from the planning session.

````
You are implementing Phase 4 (test implementation) of the `browse-filters` feature in the Cortex project at /home/era/projects/cortex. Cortex is a TypeScript/Node.js (ESM, Node 21.7.2) self-hosted second brain with a Hono web server, PostgreSQL + pgvector via the postgres.js driver, and Vitest as the test runner.

Do NOT implement feature code. Only write tests. The tests must fail against current `main` because the feature does not exist yet.

Read these three spec files in order and follow them as the source of truth:

1. docs/specs/browse-filters-specification.md — the behavioral contract (what the feature does).
2. docs/specs/browse-filters-test-specification.md — Given/When/Then scenarios with a coverage matrix.
3. docs/specs/browse-filters-test-implementation-specification.md — the technical mapping of each scenario to a test function, file, and test-code approach. This is your per-test recipe.

Scope:

- Implement every scenario listed in docs/specs/browse-filters-test-implementation-specification.md's "Test Scenario Mapping" section.
- Extend existing test files (enumerated under "File organization"). Do not create new test files for this feature.
- Do not modify any production `src/` file in this phase. If a test fails at import time because `src/web/browse.ts` or `src/web/dashboard.ts` lacks a symbol, that is expected — record it as part of the failure report, do not patch the source.
- Do not modify `docs/specs/browse-filters-*.md`. If you discover a spec inconsistency, stop and report it rather than editing specs.

Conventions (follow the house style documented in CLAUDE.md and the existing cortex test files):

- `describe`/`it`/`expect` from `vitest`.
- Module-level `vi.mock("…")` factories with plain async closures for stable defaults, `vi.fn()` only for per-test override or `.toHaveBeenCalled()` assertions.
- `beforeEach(() => vi.clearAllMocks())`, `afterEach(() => vi.restoreAllMocks())`.
- Existing helpers: `tests/helpers/test-db.ts`, `tests/helpers/session.ts`, `tests/helpers/mock-sql.ts`.
- Factory-pattern routes: `createDashboardRoutes(sql, broadcaster)`, `createBrowseRoutes(sql)`, `createTrashRoutes(sql)`.
- Assertion style: regex/substring matching on response HTML via `expect(html).toMatch(...)` / `.toContain(...)`.
- For JSONB inserts, use `sql.json({ status: "pending" })` NOT bare objects (known postgres.js gotcha).
- Integration tests use testcontainers via `startTestDb()` + `runMigrations()`; truncate entries in `beforeEach`.
- i18n: resolve strings via `i18next.getFixedT("en")(key)` in tests to avoid catalog-drift breakage; do not hardcode English text.

Stack the tests must exercise:

- Node.js 21 / ESM (`"type": "module"` in package.json).
- Vitest (test scripts: `npm test`, `npm run test:unit`, `npm run test:integration`).
- Hono for HTTP.
- postgres.js tagged-template client.
- pgvector for embeddings (real for integration, mocked-shape for unit).

When finished:

1. Run `npm run test:unit` and `npm run test:integration` (the latter requires Docker). Capture the full pass/fail report.
2. Confirm that every scenario listed in the test-impl spec corresponds to a test that FAILED (either via assertion failure or import/compile error caused by missing feature code).
3. Confirm that no PREVIOUSLY-PASSING test regressed. If any pre-existing test now fails because of a file you edited, fix the cause or, if the test asserts behavior you did not change, flag it.
4. Produce a summary: scenario ID → test file + test name → observed failure reason.

Do NOT create git commits. The user handles all commits themselves.

Do NOT proceed to Phase 5 (feature implementation). Stop after the tests exist and fail.
````

## Phase 5 Handoff Prompt

After Phase 4 finishes and you have confirmed a clean "all new tests fail, no pre-existing regressions" state, paste the following into a second fresh session to execute Phase 5:

````
You are implementing Phase 5 (feature implementation) of the `browse-filters` feature in the Cortex project at /home/era/projects/cortex. Cortex is a TypeScript/Node.js (ESM, Node 21.7.2) self-hosted second brain — see CLAUDE.md and ARCHITECTURE.md for full context.

Your goal: write production code in `src/` so that every test in the browse-filters suite passes, without modifying any test file.

Read these spec files in order:

1. docs/specs/browse-filters-specification.md
2. docs/specs/browse-filters-test-specification.md
3. docs/specs/browse-filters-test-implementation-specification.md

Then run `npm run test:unit` and `npm run test:integration` to confirm the expected failure baseline from Phase 4.

Implementation scope (inferable from the three specs — do not invent new behavior):

- Extend `src/web/browse-queries.ts` — add new filter parameters (`since`, `status`, `stale_days`) to `browseEntries`, `semanticSearch`, and `textSearch`. Keep existing signatures backwards-compatible.
- Extend `src/web/browse.ts` — parse/validate the new query params (return 400 on invalid values), render the filter bar UI with pills + remove controls + "+ Filter" menu + context-aware value pickers + result count + "Clear filters" link + empty-state integration.
- Update `src/web/dashboard.ts` — wrap each stat card in `src/web/dashboard.ts:renderStats` in an `<a>` element with the correct href per the spec's AC-1.2 table. Preserve every existing `[data-stat]` selector target inside the anchor. Update hover classes to include `hover:border-primary` and `hover:bg-secondary`.
- Update `src/web/i18n/en.ts` and `src/web/i18n/de.ts` — add every new catalog key listed in the test-impl spec under Group 3, TS-5.3 / TS-5.4.
- Add any small client-side JS needed for the filter-bar popovers within the existing `renderClientScript` function in `browse.ts` or `dashboard.ts` (no new script files).
- Do NOT touch `/trash` routes except insofar as to confirm the new params are tolerated (return 200 without validation).
- Do NOT add new dependencies, new files under `src/`, or new database columns.

When finished:

1. Run `npm run test:unit` and `npm run test:integration`. All browse-filters tests must pass. All previously-passing tests must still pass.
2. Run `npm run build:css` and `npm run build` to verify the TypeScript compile and CSS build are clean.
3. Produce a summary: files changed, test results (unit + integration totals), and any deviations from the spec with justification.

Do NOT create git commits. The user handles all commits themselves.
````
