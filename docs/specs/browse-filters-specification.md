# Browse Filters — Behavioral Specification

## Objective

Make the four dashboard stat cards clickable and landing on `/browse` views that return exactly the entries counted by each card. To keep that promise honest, extend `/browse` with three new structured filter dimensions (`since`, `status`, `stale_days`) and surface those dimensions through a persistent filter bar so users can set, change, and remove them without hand-editing the URL.

The feature exists because a number on a dashboard card becomes more useful when it doubles as a drill-down into the entries behind it. Today's browse page exposes only category, tag, and free-text search — the predicates behind the stat cards (week-bounded creation time, JSONB status, staleness) are not representable in the URL. This feature closes that gap and, in doing so, makes `/browse` a first-class tool for "show me my pending tasks" or "show me projects I have not touched in a week" without a dashboard round-trip.

## User Stories & Acceptance Criteria

### US-1: As a dashboard reader, I want each stat card to be clickable, so that I can drill into the exact entries behind the number.

**AC-1.1:** Each of the four stat cards in `src/web/dashboard.ts:renderStats` renders as an `<a>` element wrapping the existing card markup. The anchor is the entire card surface (icon, number, label) — not a separate "view" button inside the card.

**AC-1.2:** The four cards link to the following destinations:

| `data-stat` | Card label | `href` |
|---|---|---|
| `entries-week` | "Entries this week" | `/browse?since=week` |
| `entries-total` | "Total entries" | `/browse` |
| `open-tasks` | "Open tasks" | `/browse?category=tasks&status=pending` |
| `stalled` | "Stalled projects" | `/browse?category=projects&status=active&stale_days=5` |

**AC-1.3:** Each destination URL returns an entry count that matches the number displayed on its card when both are measured against the same database snapshot. If entries are inserted or deleted between the dashboard render and the `/browse` fetch, counts may differ; that drift is not a bug (covered in E-1).

**AC-1.4:** Cards render a hover state that signals clickability: the card border transitions from `border-border` to `border-primary` and the card background shifts to `bg-secondary`. The numeric value and icon colors are preserved (the existing `text-primary`, `text-foreground`, `text-accent`, `text-destructive` classes remain).

**AC-1.5:** Cards are keyboard-focusable in tab order. Pressing Enter or Space with focus on a card activates the link. Focus-visible state uses the existing `ring-1 ring-primary` pattern.

**AC-1.6:** Cards at count `0` remain clickable and link to their filtered destination. The user lands on `/browse`'s empty state for that filter combination, not an error page.

**AC-1.7:** The SSE handlers that mutate card counts (`entry:created`, `entry:updated`, `entry:deleted` in `dashboard.ts` client script) must continue to update the `data-stat` span text even though the span is now nested inside an anchor. The anchor element is the outer wrapper; the `[data-stat="..."]` selector inside it is unchanged.

### US-2: As a browse-page user, I want new filter query parameters, so that the URL can express the same predicates the dashboard cards do.

**AC-2.1:** `/browse` accepts a `since` query parameter with exactly three valid values: `today`, `week`, `month`. The filter restricts results to entries satisfying:

- `since=today` → `created_at >= CURRENT_DATE`
- `since=week` → `created_at >= date_trunc('week', CURRENT_DATE)`
- `since=month` → `created_at >= date_trunc('month', CURRENT_DATE)`

All three truncations use the PostgreSQL server's timezone, matching `getDashboardStats` in `dashboard-queries.ts`. (Switching to the configured `timezone` setting is NG-6.)

**AC-2.2:** `/browse` accepts a `status` query parameter. Valid values form a closed enum: `pending`, `done`, `active`, `paused`, `completed`. The filter restricts results to entries where `fields->>'status' = <value>`. Entries whose `fields` JSONB lacks a `status` key are excluded.

The enum is the union of `tasks.status` and `projects.status` as defined in `prompts/classify.md:45-46`. No cross-validation against `category` is performed — setting `category=people&status=pending` is allowed and returns zero rows.

**AC-2.3:** `/browse` accepts a `stale_days` query parameter. Valid values are positive integers (`stale_days >= 1`, no upper bound). The filter restricts results to entries where `updated_at < now() - interval '<N> days'`. Non-integer, zero, and negative values fail validation (AC-2.5).

**AC-2.4:** The new parameters compose with the existing `category`, `tag`, `q`, and `mode` parameters. All filters applied are ANDed. Example: `/browse?category=projects&status=active&stale_days=5&tag=work&q=launch` returns only entries matching every condition.

**AC-2.5:** Invalid query parameter values return HTTP 400 with `Content-Type: text/html` and a body containing the invalid parameter name in an error page using the standard `renderLayout` chrome. Invalid values are:

- `since` not in `{today, week, month}` (e.g., `since=yesterday`, `since=`, `since=2026-01-01`)
- `status` not in the closed enum (e.g., `status=typo`, `status=PENDING` — case-sensitive)
- `stale_days` that does not parse as a positive integer ≥ 1 (e.g., `stale_days=0`, `stale_days=-1`, `stale_days=1.5`, `stale_days=abc`, `stale_days=`)

Validation runs before any database query. A single request with multiple invalid params reports the first one encountered in the order `since`, `status`, `stale_days`.

**AC-2.6:** Absent parameters behave as "no filter" — previous browse behavior is preserved when no new parameter is supplied.

**AC-2.7:** The `browseEntries`, `semanticSearch`, and `textSearch` functions in `browse-queries.ts` all honor the new filters. A semantic-search request (`q=something` with default mode) filtered by `status=pending` still returns only pending entries ranked by similarity, subject to the 0.6 similarity threshold.

### US-3: As a browse-page user, I want a filter bar UI, so that I can set, change, and remove the new filters without editing the URL.

**AC-3.1:** A filter bar renders below the tag pill row and above the entry list whenever the user is on `/browse`. The bar is present on every browse render, not only when filters are active.

**AC-3.2:** For each active filter among `since`, `status`, `stale_days`, a pill renders in the filter bar showing a natural-language label, the filter value, and a remove control (×). The rendered pills follow the design system — rounded, bordered, JetBrains Mono, matching the existing tag-pill look.

**AC-3.3:** Pill labels are localized strings. English catalog entries (German translations in `de.ts`):

| Filter | Pill format | Example |
|---|---|---|
| `status=pending` | "Status: Pending" | |
| `status=done` | "Status: Done" | |
| `status=active` | "Status: Active" | |
| `status=paused` | "Status: Paused" | |
| `status=completed` | "Status: Completed" | |
| `since=today` | "Updated: Today" | |
| `since=week` | "Updated: This week" | |
| `since=month` | "Updated: This month" | |
| `stale_days=N` | "Inactive: {N}+ days" (plural form for N≠1) | "Inactive: 5+ days" |

**AC-3.4:** Clicking the × on a pill removes that filter from the URL and triggers a navigation. All other query parameters (including other filter pills, the category tab, the tag, the search query) are preserved.

**AC-3.5:** Clicking the pill value (not the ×) opens an inline value picker listing the legal values for that dimension. Selecting a value triggers navigation to `/browse` with the parameter updated; selecting the same value is a no-op (no navigation). The picker can be dismissed by clicking outside it or pressing Esc.

**AC-3.6:** A "+ Filter" button renders at the end of the pill row. Clicking it opens a menu listing the filter dimensions that are *not* already applied. The menu contains exactly these options (in this order):

- Status (hidden from the menu when a `status` pill is already active)
- Updated (hidden when `since` is active)
- Inactive (hidden when `stale_days` is active)

When all three dimensions are active, the "+ Filter" button is hidden (there is nothing to add).

**AC-3.7:** Selecting a dimension from the "+ Filter" menu opens the same value picker as AC-3.5, pre-populated with the legal values for that dimension. Selecting a value adds the new filter to the URL and triggers navigation. The user cannot add a dimension without selecting a value — cancelling the picker leaves the URL untouched.

**AC-3.8:** Value pickers present context-aware options:

- `status` picker, when `category=tasks`, offers `Pending, Done` only. When `category=projects`, offers `Active, Paused, Completed` only. When no category or `category=unclassified`, offers the full union: `Pending, Done, Active, Paused, Completed`. When `category=people|ideas|reference`, offers the full union (no category has a dedicated status enum, but the filter still works).
- `since` picker always offers `Today, This week, This month`.
- `stale_days` picker offers three presets: `5`, `14`, `30` (rendered as "5+ days", "14+ days", "30+ days"). No free-form integer input in this iteration.

**AC-3.9:** The result count renders as subtle text near the filter bar (above the entry list). Text uses localized pluralization:

- `0` results → "No entries match"
- `1` result → "1 entry matches"
- `N > 1` results → "{N} entries match"

The count reflects the full filtered result set size (the number of rows returned by the query), not a paginated subset.

**AC-3.10:** When at least one of `tag`, `since`, `status`, `stale_days` is active, a "Clear filters" text link appears in the filter bar area. Clicking it navigates to `/browse` retaining only `category` and `q` if present (those have their own dedicated UIs and mental models). Category is not cleared; search query is not cleared.

**AC-3.11:** The empty-state view (rendered by `renderEmptyState`) includes a "Clear filters" link when at least one filterable parameter (`tag`, `since`, `status`, `stale_days`) is active and the result set is empty. The existing empty-state copy is preserved alongside the new link.

### US-4: As a user of the existing browse surface, I want the feature to preserve behaviors I already rely on.

**AC-4.1:** The category tab row (`renderCategoryTabs`) renders as before at the top of the page chrome. Tabs continue to function as the primary axis and retain their URL contract (`category=tasks`, etc.).

**AC-4.2:** The search input (`renderSearchBar`) renders as before and retains its behavior: default semantic search, `mode=text` bypass, 500-character query cap.

**AC-4.3:** The tag pill row (`renderTagPills`) renders as before, showing up to 10 tags with "show more" disclosure. Single-tag selection and the click-to-deselect behavior are preserved; the active tag's visual state is unchanged.

**AC-4.4:** Entry list rendering (`renderEntryList`) is unchanged — same row format, same badge, same visibility marker, same relative-time label.

**AC-4.5:** Semantic vs text-search fallback behavior (semantic → fall back to text if no matches or embedding error) is unchanged. The new filters apply to both search paths identically.

**AC-4.6:** The `unclassified` tab and the "Reclassify all" workflow are unchanged.

**AC-4.7:** Trash browse (`/trash`, which reuses `renderCategoryTabs`/`renderTagPills`) does **not** gain the new filter bar in this feature. `since`/`status`/`stale_days` are only honored on `/browse`. Sending any of these params to `/trash` returns HTTP 200 with the parameter ignored (not 400) — rationale: trash pages are a different tool with different intent, and surfacing the filter bar there is a separate decision.

## Constraints

**C-1:** No new dependencies. The filter bar is implemented with vanilla JS and server-rendered HTML. No frameworks, no popover libraries.

**C-2:** Progressive enhancement. The filter bar degrades gracefully without JavaScript: pill removal (×) works via plain anchor navigation — no JS required. Adding or changing filter values may require JS for the inline popover pickers; an acceptable no-JS fallback is to render native `<select>` elements inside a `<form method="GET" action="/browse">` with an "Apply" submit button, or to rely on dashboard card links and URL editing. With JS enabled, the "+ Filter" menu and value pickers are inline popovers with click-outside and Esc dismissal.

**C-3:** Design system compliance. All styling uses Tailwind utility classes per CLAUDE.md — no inline `style="..."` attributes. Colors come from the existing oklch palette. Icons come from `src/web/icons.ts` (add new Lucide icons there if needed; do not inline SVGs elsewhere). Font is JetBrains Mono via the existing global stylesheet.

**C-4:** i18n coverage. Every user-facing string introduced by this feature (pill labels, picker option labels, "+ Filter" button text, result-count text, "Clear filters" link) is defined in `src/web/i18n/en.ts` and `src/web/i18n/de.ts`. No hardcoded English strings in templates.

**C-5:** Invalid query parameter values return HTTP 400 (per AC-2.5). The browse handler does not silently strip unknown or malformed params.

**C-6:** Backwards-compatible URL contract. Existing URLs with only `category`, `tag`, `q`, `mode` keep working unchanged. The new params are additive; no existing param is renamed or repurposed.

**C-7:** No changes to the `entries` schema, indexes, or settings table. All queries are expressible against the existing `entries` columns and the JSONB `fields` column.

**C-8:** The feature is not auth-gated beyond the existing `requireAuth` middleware — the same users who can see `/browse` can use the new filters. No role checks.

## Edge Cases

**E-1:** **Card count drifts between render and click.** An entry is inserted into `tasks` with `status=pending` after the dashboard renders `open-tasks: 7` but before the user clicks. The user lands on `/browse?category=tasks&status=pending` and sees 8 rows. Acceptable; the destination always reflects the live database.

**E-2:** **Stat card at count = 0 is clicked.** The user arrives on `/browse` with the filters applied and sees the empty state (AC-3.11). The filter bar shows the applied pills; a "Clear filters" link is visible.

**E-3:** **Incompatible category + status combination via URL.** A user bookmarks `/browse?category=people&status=pending`. The query runs, returns zero rows, empty state renders with both filter pills and a "Clear filters" link.

**E-4:** **`stale_days=100000`.** Valid (≥ 1 integer), query runs and returns zero rows (no entry is 274 years old). No crash, no special handling.

**E-5:** **`stale_days=1.5` or `stale_days=0` or `stale_days=-1` or `stale_days=abc` or `stale_days=` (empty).** All return HTTP 400 per AC-2.5.

**E-6:** **`since=yesterday`.** Returns HTTP 400 — not in the closed enum.

**E-7:** **Duplicate query parameters.** A URL like `/browse?status=pending&status=done` is treated per Hono/standard URL semantics: the first value wins (matching the current behavior of the other browse filters). This is a de facto rule of the existing implementation, not a new invariant.

**E-8:** **User replaces a filter via the value picker.** Active pill is `status=pending`; user clicks the pill, picks `done`. Navigation goes to the same URL with `status=done` — other params preserved.

**E-9:** **User removes the last filter.** With `?tag=work&status=pending`, the user clicks × on the status pill. Destination is `/browse?tag=work` (status removed, tag preserved). Clicking × on the tag pill next lands on `/browse`.

**E-10:** **User clicks "Clear filters" with an active category tab and search query.** Destination is `/browse?category=<cat>&q=<query>` — category and search are preserved; tag, since, status, stale_days are all removed.

**E-11:** **JS disabled or errors before attaching handlers.** The filter bar renders via the progressive-enhancement fallback: value pickers are native `<select>` elements inside a `<form method="GET" action="/browse">`, "+ Filter" is a `<details>` disclosure. All filter operations work via full-page submits.

**E-12:** **Browser back/forward after a filter change.** The URL reverts to the previous state and the page re-renders with the prior filter pills. No stale UI.

**E-13:** **SSE event increments a counter while the user is on `/browse`.** The browse page is not wired to SSE, so the list and count do not live-update. The user refreshes to see new entries. Not a regression (browse has never been live). The dashboard's SSE counter updates continue to work because the `data-stat` span selector is preserved inside the new anchor wrapper.

**E-14:** **`fields` JSONB is `{}` or missing the `status` key for an entry in a category that normally has status.** The entry is excluded from `status=<any>` filters. Not a bug: a task without a status (e.g., pre-classification or legacy data) is not "open" under the dashboard's definition either.

## Non-Goals

**NG-1:** **Sort controls.** The default sort order (`updated_at DESC`, or `similarity DESC` for semantic search) is preserved. This feature does not introduce `sort=` or UI to change ordering. Sorting stalled projects by most-stale-first is not provided in this iteration.

**NG-2:** **Multi-select filter values.** A filter accepts exactly one value per dimension. `status=pending,done` is not supported; setting a new value replaces the old.

**NG-3:** **Free-form date range.** `since=YYYY-MM-DD` is not supported. Only the three preset buckets (`today`, `week`, `month`).

**NG-4:** **Free-form `stale_days` input.** The picker offers presets (5, 14, 30). Users who want a different integer must edit the URL. Adding a number input to the picker is a future enhancement.

**NG-5:** **Saved filter presets / named views.** No "Save this filter" button, no named shortcuts beyond the dashboard card links.

**NG-6:** **Timezone-aware `since=` bucketing.** Date truncation uses the PostgreSQL server's timezone. The dashboard already does this (`getDashboardStats`), so browse inherits the same behavior for consistency. Promoting both sites to use the configured `timezone` setting is a separate future improvement.

**NG-7:** **Live result count updates without navigation.** The result count re-renders on page load. No AJAX preview.

**NG-8:** **Filter bar on `/trash`.** Trash continues to use only category tabs + tag pills + search. Adding filters there is a separate decision (AC-4.7 clarifies the behavior when params arrive anyway).

**NG-9:** **Per-user filter preferences or persisted default filters.** Filters live only in the URL.

**NG-10:** **Combining `stale_days` with semantic search ranking.** `stale_days` acts as a post-filter on the similarity-ranked list; the ranking itself is not biased by staleness. (This falls out of AC-2.7's "filters apply identically to both paths.")

**NG-11:** **Linkifying non-stat cells on the dashboard.** Only the four stat cards become anchors. The digest panel, capture input, recent-entries list, and service-status rows are unchanged.

## Open Questions

None.
