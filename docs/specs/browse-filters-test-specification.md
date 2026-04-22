# Browse Filters — Test Specification

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|---|---|
| AC-1.1 Stat card renders as `<a>` wrapping icon, number, label | TS-1.1, TS-1.2 |
| AC-1.2 Destination URLs for the 4 cards | TS-1.3, TS-1.4, TS-1.5, TS-1.6 |
| AC-1.3 Destination count matches card count modulo concurrent writes | TS-1.7, TS-1.8 (integration) |
| AC-1.4 Hover state transitions border to primary and bg to secondary | TS-1.9 |
| AC-1.5 Cards are keyboard-focusable, Enter/Space activates | TS-1.10 |
| AC-1.6 Count=0 cards are still clickable (empty state on land) | TS-1.11 |
| AC-1.7 SSE handlers continue to update `[data-stat]` spans inside anchor | TS-1.12 |
| AC-2.1 `since=today\|week\|month` filter predicates | TS-2.1, TS-2.2, TS-2.3, TS-2.14 (integration) |
| AC-2.2 `status=<enum>` filter + entries without `status` key excluded | TS-2.4, TS-2.5, TS-2.6, TS-2.7, TS-2.8, TS-2.15 |
| AC-2.3 `stale_days=N` filter (positive integer ≥1) | TS-2.9, TS-2.10 |
| AC-2.4 New params compose with existing category/tag/q/mode | TS-2.11, TS-2.12 (integration) |
| AC-2.5 Invalid values → HTTP 400 with param name in body | TS-2.16, TS-2.17, TS-2.18, TS-2.19, TS-2.20, TS-2.21 |
| AC-2.6 Absent params = no filter (backwards compatible) | Existing web-browse tests (regression baseline) |
| AC-2.7 New filters apply to semantic and text search paths identically | TS-2.13, TS-2.22, TS-2.23 (integration) |
| AC-3.1 Filter bar always renders on `/browse` | TS-3.1 |
| AC-3.2 Active filters render as pills with label + value + × | TS-3.2, TS-3.3, TS-3.4 |
| AC-3.3 Localized pill labels | TS-3.5 (EN), TS-3.6 (DE), TS-3.7 (pluralization) |
| AC-3.4 × removes just that filter, other params preserved | TS-3.8, TS-3.9 |
| AC-3.5 Clicking pill value opens picker | TS-3.10 |
| AC-3.6 "+ Filter" button shows only unapplied dimensions, hidden when all 3 applied | TS-3.11, TS-3.12, TS-3.13 |
| AC-3.7 "+ Filter" picker adds a new filter | TS-3.14a, TS-3.14b, TS-3.14c |
| AC-3.8 Context-aware value menus (status per category, since presets, stale_days presets) | TS-3.15, TS-3.16, TS-3.17, TS-3.18, TS-3.19 |
| AC-3.9 Result count with localized pluralization | TS-3.20, TS-3.21, TS-3.22 |
| AC-3.10 "Clear filters" link when ≥1 filter active, preserves category + q | TS-3.23, TS-3.24 |
| AC-3.11 Empty state includes "Clear filters" when filters active | TS-3.25, TS-3.26 |
| AC-4.1 Category tabs unchanged | TS-4.1 |
| AC-4.2 Search input unchanged | TS-4.2 |
| AC-4.3 Tag pill row unchanged (discovery + deselect) | TS-4.3 |
| AC-4.4 Entry list rendering unchanged | TS-4.4 |
| AC-4.5 Semantic vs text fallback unchanged | TS-4.5 |
| AC-4.6 Unclassified tab + Reclassify all unchanged | TS-4.6 |
| AC-4.7 `/trash` ignores new params, returns 200 | TS-4.7 |
| C-1 No new dependencies | Verified in Phase 6 review (package.json diff) |
| C-2 Progressive enhancement: × works without JS | TS-5.1 |
| C-3 Design system: no inline styles, Tailwind classes, Lucide icons | TS-5.2 |
| C-4 i18n: every user-facing string in en.ts + de.ts | TS-5.3, TS-5.4 |
| C-5 Validation runs before DB query | TS-5.5 |
| C-6 Backwards-compatible URL contract | Existing web-browse tests (regression baseline) |
| C-7 No schema or settings changes | Verified in Phase 6 review |
| C-8 Auth: standard `requireAuth` middleware | TS-5.6 |
| E-1 Card count drift between render and click | Acceptable — not testable deterministically |
| E-2 Stat card 0 → empty state on land | TS-1.11 |
| E-3 Incompatible category+status (e.g. people+pending) → 0 rows + empty state | TS-5.7 (integration) |
| E-4 `stale_days=100000` → valid, 0 rows, no crash | TS-2.10 |
| E-5 `stale_days` invalid values → 400 | TS-2.18, TS-2.19 |
| E-6 `since=yesterday` → 400 | TS-2.16 |
| E-7 Duplicate query params → first wins (Hono default) | TS-5.8 |
| E-8 Replace filter via picker | TS-3.10 |
| E-9 Remove filters one by one | TS-3.8 |
| E-10 Clear filters preserves category + q | TS-3.24 |
| E-11 No-JS fallback: × still works | TS-5.1 |
| E-12 Browser back/forward | Browser behavior — not testable in vitest |
| E-13 SSE still updates `[data-stat]` inside anchor | TS-1.12 |
| E-14 `fields` JSONB missing `status` → excluded from `status=` filter | TS-2.15 |
| NG-1 No sort controls | TS-5.9 (sort=… param has no effect — asserts absence) |
| NG-2 No multi-select — covered by E-7 | TS-5.8 |
| NG-3 No free-form dates — covered by AC-2.5 | TS-2.16 |
| NG-4 No free-form `stale_days` input — picker presets only | TS-3.19 |
| NG-5 No saved presets / named views | Negative: no route `/browse/saved` — existence test skipped |
| NG-6 Timezone uses PG server tz | TS-2.14 (integration) |
| NG-7 No live count updates without navigation | Negative — no SSE on browse, verified by absence |
| NG-8 Filter bar not on `/trash` | TS-4.7 |
| NG-9 No persisted default filters | No setting introduced — verified in Phase 6 |
| NG-10 `stale_days` is a post-filter on semantic ranking | TS-2.22 (integration) |
| NG-11 Only the 4 stat cards become anchors | TS-5.10 |

## Test Scenarios

### Group 1 — Dashboard stat cards (US-1)

**TS-1.1: Stat card renders as an anchor element**

```
Given the dashboard is rendered with any stats
When the page HTML is inspected
Then each stat card is an <a> element with an href attribute
And the anchor wraps the icon, the number span, and the label span
```

**TS-1.2: Nested data-stat span is preserved inside the anchor**

```
Given the dashboard is rendered
When the rendered HTML is parsed
Then each of [data-stat="entries-week"], [data-stat="entries-total"],
     [data-stat="open-tasks"], [data-stat="stalled"] exists exactly once
And each is nested inside an <a> element
```

**TS-1.3: "Entries this week" card links to /browse?since=week**

```
Given the dashboard is rendered
When the anchor containing [data-stat="entries-week"] is inspected
Then its href is "/browse?since=week"
```

**TS-1.4: "Total entries" card links to /browse**

```
Given the dashboard is rendered
When the anchor containing [data-stat="entries-total"] is inspected
Then its href is "/browse"
```

**TS-1.5: "Open tasks" card links to the composed tasks filter**

```
Given the dashboard is rendered
When the anchor containing [data-stat="open-tasks"] is inspected
Then its href is "/browse?category=tasks&status=pending"
```

**TS-1.6: "Stalled projects" card links to the composed projects filter**

```
Given the dashboard is rendered
When the anchor containing [data-stat="stalled"] is inspected
Then its href is "/browse?category=projects&status=active&stale_days=5"
```

**TS-1.7: Destination count matches card count — open tasks (integration)**

```
Given the database contains exactly 3 tasks with fields.status='pending'
  and 2 tasks with fields.status='done'
  and 4 entries in other categories
When the dashboard renders and [data-stat="open-tasks"] value is read
  And GET /browse?category=tasks&status=pending is issued
Then the card value is 3
And the browse response contains exactly 3 entry rows
```

**TS-1.8: Destination count matches card count — stalled projects (integration)**

```
Given the database contains 2 projects with status='active' and updated_at > now()-5d
  and 1 project with status='active' and updated_at < now()-5d (stalled)
  and 1 project with status='paused' and updated_at < now()-30d
When the dashboard renders and [data-stat="stalled"] value is read
  And GET /browse?category=projects&status=active&stale_days=5 is issued
Then the card value is 1
And the browse response contains exactly 1 entry row
```

**TS-1.9: Hover state transitions card visuals**

```
Given the dashboard is rendered
When each stat card anchor's class attribute is inspected
Then it includes hover classes that shift the border to the primary color
  (e.g., hover:border-primary) and the background to the secondary tone
  (e.g., hover:bg-secondary)
```

**TS-1.10: Cards are keyboard-focusable**

```
Given the dashboard is rendered
When each stat card anchor is inspected
Then it is a natural focus target (<a> with href — no tabindex="-1" override)
And no role override prevents default Enter/Space activation semantics
```

**TS-1.11: Card with count=0 is still clickable**

```
Given the dashboard stats are { entriesThisWeek: 0, totalEntries: 0,
  openTasks: 0, stalledProjects: 0 }
When the dashboard renders
Then all four stat cards are still rendered as anchors with the correct hrefs
And none are disabled, hidden, or rendered as non-anchor elements
```

**TS-1.12: `[data-stat]` selectors still resolve when nested inside anchors**

```
Given the dashboard response HTML with the four stat cards wrapped in anchors
When document.querySelector is invoked with each of the four selectors
  ('[data-stat="entries-week"]', '[data-stat="entries-total"]',
  '[data-stat="open-tasks"]', '[data-stat="stalled"]')
Then each call returns a non-null element
And each element's textContent matches the rendered card numeric value
```

### Group 2 — New query parameters (US-2)

**TS-2.1: `since=today` returns only entries created today (integration)**

```
Given the database contains:
  - 2 entries created at CURRENT_DATE (today)
  - 1 entry created at CURRENT_DATE - 1 day (yesterday)
  - 1 entry created at CURRENT_DATE - 30 days
When GET /browse?since=today is issued
Then the response contains exactly 2 entries
And all are the ones created today
```

**TS-2.2: `since=week` returns only entries created this week (integration)**

```
Given the database contains:
  - 3 entries created at date_trunc('week', CURRENT_DATE) or later
  - 2 entries created before date_trunc('week', CURRENT_DATE)
When GET /browse?since=week is issued
Then the response contains exactly 3 entries
```

**TS-2.3: `since=month` returns only entries created this month (integration)**

```
Given the database contains:
  - 4 entries created at date_trunc('month', CURRENT_DATE) or later
  - 3 entries created before date_trunc('month', CURRENT_DATE)
When GET /browse?since=month is issued
Then the response contains exactly 4 entries
```

**TS-2.4: `status=pending` returns only entries with fields.status='pending' (integration)**

```
Given the database contains:
  - 2 tasks with fields.status='pending'
  - 1 task with fields.status='done'
  - 1 entry in a category whose fields JSONB lacks any 'status' key
When GET /browse?status=pending is issued
Then the response contains exactly 2 entries
```

**TS-2.5: `status=done` filters correctly (integration)**

```
Given the database contains 3 tasks with fields.status='done' and 2 pending
When GET /browse?status=done is issued
Then the response contains exactly 3 entries
```

**TS-2.6: `status=active` filters correctly (integration)**

```
Given the database contains 4 projects with fields.status='active', 1 paused,
  1 completed
When GET /browse?status=active is issued
Then the response contains exactly 4 entries
```

**TS-2.7: `status=paused` filters correctly (integration)**

```
Given the database contains 1 project with fields.status='paused' and 5 active
When GET /browse?status=paused is issued
Then the response contains exactly 1 entry
```

**TS-2.8: `status=completed` filters correctly (integration)**

```
Given the database contains 2 projects with fields.status='completed' and others
When GET /browse?status=completed is issued
Then the response contains exactly 2 entries
```

**TS-2.9: `stale_days=5` filters by updated_at threshold (integration)**

```
Given the database contains:
  - 2 entries with updated_at = now() - interval '10 days'
  - 2 entries with updated_at = now() - interval '2 days'
When GET /browse?stale_days=5 is issued
Then the response contains exactly 2 entries
And both are the ones updated more than 5 days ago
```

**TS-2.10: `stale_days=100000` is valid and returns no rows (integration)**

```
Given the database contains entries all updated within the last year
When GET /browse?stale_days=100000 is issued
Then the response status is 200
And the entry list is empty (empty-state view rendered)
```

**TS-2.11: Filters compose with category — `category=tasks&status=pending` (integration)**

```
Given the database contains:
  - 2 tasks with fields.status='pending'
  - 1 task with fields.status='done'
  - 1 project with fields.status='active'
  - 1 project with fields.status='pending'  (unusual but permitted)
When GET /browse?category=tasks&status=pending is issued
Then the response contains exactly 2 entries
And all have category='tasks' and fields.status='pending'
```

**TS-2.12: Filters compose with tag — `status=pending&tag=work` (integration)**

```
Given the database contains:
  - 2 pending tasks tagged 'work'
  - 1 pending task tagged 'home'
  - 1 done task tagged 'work'
When GET /browse?status=pending&tag=work is issued
Then the response contains exactly 2 entries
```

**TS-2.13: Filters compose with semantic search (integration)**

```
Given the database contains 4 pending tasks with embeddings
  and 4 done tasks with similar embeddings
When GET /browse?q=<semantic-match>&status=pending is issued
Then the response contains only entries with fields.status='pending'
And they are ordered by similarity
```

**TS-2.14: `since` uses PG server-tz `date_trunc` (integration)**

```
Given the database reports CURRENT_DATE = '2026-04-21'
  and contains entries whose created_at is 2026-04-20 23:59 and 2026-04-21 00:01
When GET /browse?since=today is issued
Then the response contains only the 2026-04-21 00:01 entry
And not the 2026-04-20 23:59 entry
```

**TS-2.15: Entries without fields.status key are excluded from status= filter (integration)**

```
Given the database contains:
  - 1 idea with fields = {"oneliner": "...", "notes": "..."} (no status key)
  - 1 task with fields.status = 'pending'
When GET /browse?status=pending is issued
Then the response contains only the task
And not the idea
```

**TS-2.16: `since=yesterday` returns HTTP 400**

```
Given a running /browse route
When GET /browse?since=yesterday is issued
Then the response status is 400
And the response body mentions the param name "since"
```

**TS-2.17: `status=typo` returns HTTP 400**

```
Given a running /browse route
When GET /browse?status=typo is issued
Then the response status is 400
And the response body mentions the param name "status"
```

**TS-2.18: `stale_days=0` returns HTTP 400**

```
Given a running /browse route
When GET /browse?stale_days=0 is issued
Then the response status is 400
And the response body mentions the param name "stale_days"
```

**TS-2.19: `stale_days=-5` returns HTTP 400**

```
Given a running /browse route
When GET /browse?stale_days=-5 is issued
Then the response status is 400
```

**TS-2.20: `stale_days=1.5` returns HTTP 400**

```
Given a running /browse route
When GET /browse?stale_days=1.5 is issued
Then the response status is 400
```

**TS-2.21: `stale_days=abc` returns HTTP 400**

```
Given a running /browse route
When GET /browse?stale_days=abc is issued
Then the response status is 400
```

**TS-2.22: Semantic search with `stale_days` applies the filter post-ranking (integration)**

```
Given the database contains 3 semantically similar entries:
  - A updated 10 days ago
  - B updated 2 days ago
  - C updated 20 days ago
When GET /browse?q=<similar>&stale_days=7 is issued
Then the response contains exactly A and C
And they are ordered by semantic similarity, not by staleness
```

**TS-2.23: Text search honors the new filters (integration)**

```
Given the database contains:
  - 2 pending tasks whose name or content contains "launch"
  - 1 done task whose name contains "launch"
When GET /browse?q=launch&mode=text&status=pending is issued
Then the response contains exactly the 2 pending tasks
And the done task is not present
```

### Group 3 — Filter bar UI (US-3)

**TS-3.1: Filter bar renders on /browse even with no active filters**

```
Given a running /browse route
When GET /browse is issued
Then the response HTML contains the filter bar container element
And a "+ Filter" button is present within it
And no filter pills are rendered (since none are active)
```

**TS-3.2: Active `since` filter renders as a pill with × control**

```
Given a running /browse route
When GET /browse?since=week is issued
Then the response HTML contains a filter pill with the localized label
  "Updated: This week"
And the pill includes a × remove control
```

**TS-3.3: Active `status` filter renders as a pill with × control**

```
Given a running /browse route
When GET /browse?status=pending is issued
Then the response HTML contains a filter pill with the localized label
  "Status: Pending"
And the pill includes a × remove control
```

**TS-3.4: Active `stale_days` filter renders as a pill with × control**

```
Given a running /browse route
When GET /browse?stale_days=5 is issued
Then the response HTML contains a filter pill with the localized label
  "Inactive: 5+ days"
And the pill includes a × remove control
```

**TS-3.5: Pill labels render in English by default**

```
Given the user's locale is 'en'
When GET /browse?since=today&status=done&stale_days=14 is issued
Then the pills render "Updated: Today", "Status: Done", "Inactive: 14+ days"
```

**TS-3.6: Pill labels render in German when locale is de**

```
Given the user's locale is 'de'
When GET /browse?since=today&status=done&stale_days=14 is issued
Then the pills render the German translations defined in de.ts
  (e.g., "Aktualisiert: Heute", "Status: Erledigt", "Inaktiv: 14+ Tage"
   — exact strings per the catalog)
```

**TS-3.7: `stale_days=1` uses singular pluralization form**

```
Given a running /browse route
When GET /browse?stale_days=1 is issued
Then the pill text uses the singular form "Inactive: 1+ day" (en)
  or the catalog's singular form for 'de'
```

**TS-3.8: × on a pill removes only that param**

```
Given the URL /browse?category=tasks&status=pending&since=week
When the × control on the "Status: Pending" pill is rendered
Then its href is "/browse?category=tasks&since=week"
And category and since params are preserved
```

**TS-3.9: Removing the last structured filter leaves only category and q if present**

```
Given the URL /browse?category=projects&q=alpha&status=active
When the × control on the "Status: Active" pill is rendered
Then its href is "/browse?category=projects&q=alpha"
```

**TS-3.10: Pill value click opens the value picker**

```
Given the URL /browse?status=pending is rendered with JS enabled
When the user clicks the value portion of the "Status: Pending" pill
Then a value picker (popover or native control) is made visible
And it lists the legal status values
```

**TS-3.11: "+ Filter" menu shows only unapplied dimensions**

```
Given the URL /browse?status=pending is rendered
When the "+ Filter" menu is inspected
Then it offers "Updated" and "Inactive"
And it does not offer "Status"
```

**TS-3.12: "+ Filter" shows all three when no structured filter is applied**

```
Given the URL /browse is rendered
When the "+ Filter" menu is inspected
Then it offers exactly these three options in order: "Status", "Updated",
  "Inactive"
```

**TS-3.13: "+ Filter" button hidden when all three dimensions are active**

```
Given the URL /browse?status=pending&since=week&stale_days=5 is rendered
When the filter bar is inspected
Then no "+ Filter" button is present
```

**TS-3.14a: Clicking "+ Filter" reveals the dimension menu**

```
Given the URL /browse is rendered with JS enabled and no dimension menu visible
When the user clicks the "+ Filter" button
Then a dimension menu becomes visible
And it offers exactly "Status", "Updated", "Inactive"
```

**TS-3.14b: Clicking a dimension opens the value picker**

```
Given the "+ Filter" dimension menu is open
When the user clicks "Status"
Then the status value picker becomes visible
And it offers the legal status values (union or category-filtered per AC-3.8)
```

**TS-3.14c: Selecting a value navigates with the new param**

```
Given the status value picker is open on /browse (no prior status filter)
When the user selects "Pending"
Then the browser navigates to /browse?status=pending
```

**TS-3.15: Status picker options adapt when `category=tasks`**

```
Given the URL /browse?category=tasks is rendered
When the status picker (either from a pill or from +Filter) is opened
Then it offers exactly: "Pending", "Done"
And it does not offer active/paused/completed
```

**TS-3.16: Status picker options adapt when `category=projects`**

```
Given the URL /browse?category=projects is rendered
When the status picker is opened
Then it offers exactly: "Active", "Paused", "Completed"
```

**TS-3.17: Status picker shows union when no category is set**

```
Given the URL /browse is rendered
When the status picker is opened
Then it offers exactly: "Pending", "Done", "Active", "Paused", "Completed"
  (in that order)
```

**TS-3.18: Since picker always offers today/week/month**

```
Given any /browse URL with JS enabled
When the since picker is opened
Then it offers exactly: "Today", "This week", "This month"
```

**TS-3.19: Stale-days picker offers 5, 14, 30 presets**

```
Given any /browse URL with JS enabled
When the stale_days picker is opened
Then it offers exactly the three preset values: 5, 14, 30
And it does not include a free-form numeric input
```

**TS-3.20: Result count renders "No entries match" when result set is empty**

```
Given the DB has no entries matching the active filters
When GET /browse?status=paused is issued
Then the response contains the localized text "No entries match"
```

**TS-3.21: Result count renders "1 entry matches" for singular**

```
Given the DB has exactly 1 entry matching the active filters
When GET /browse?status=paused is issued
Then the response contains the localized text "1 entry matches"
```

**TS-3.22: Result count renders "N entries match" for plural**

```
Given the DB has exactly 4 entries matching the active filters
When GET /browse?status=pending is issued
Then the response contains the localized text "4 entries match"
```

**TS-3.23: Clear filters link appears when ≥1 filter is active**

```
Given the URL /browse?status=pending is rendered
When the filter bar is inspected
Then a "Clear filters" text link is present
And no such link is present when the URL is /browse (no filters)
```

**TS-3.24: Clear filters preserves category and q**

```
Given the URL /browse?category=tasks&q=alpha&tag=work&status=pending
  &since=week&stale_days=5 is rendered
When the "Clear filters" link's href is inspected
Then it is "/browse?category=tasks&q=alpha"
And tag, since, status, and stale_days are all removed
```

**TS-3.25: Empty state includes "Clear filters" when structured filter is active**

```
Given the DB returns 0 entries for /browse?status=pending
When GET /browse?status=pending is issued
Then the empty-state view includes a "Clear filters" link
And its href is "/browse" (preserving nothing since nothing else was set)
```

**TS-3.26: Empty state includes "Clear filters" when only a tag filter is active**

```
Given the DB returns 0 entries for /browse?tag=nonexistent
When GET /browse?tag=nonexistent is issued
Then the empty-state view includes a "Clear filters" link
And its href is "/browse"
```

### Group 4 — Preserve existing behavior (US-4)

**TS-4.1: Category tabs render unchanged**

```
Given a running /browse route
When GET /browse is issued
Then the response contains the category tabs for All, People, Projects, Tasks,
  Ideas, Reference
And their hrefs match the pre-existing contract (no new params required)
```

**TS-4.2: Search input renders with unchanged form contract**

```
Given a running /browse route
When GET /browse is issued
Then a <form action="/browse" method="GET"> with an <input name="q"> is present
And the 500-char cap behavior is preserved (existing regression)
```

**TS-4.3: Tag pill row renders unchanged**

```
Given the DB contains tags ["alpha", "beta", "gamma"]
When GET /browse is issued
Then the tag pill row shows those tags (up to 10)
And an active tag pill click-to-deselect navigates to the URL without tag=
```

**TS-4.4: Entry list row format unchanged**

```
Given the DB contains entries matching any /browse query
When GET /browse is issued
Then each entry row includes the category badge, optional visibility marker,
  the entry name, and the relative-time label — matching the existing format
  from renderEntryList
```

**TS-4.5: Semantic search falls back to text when no matches, with notice**

```
Given the embedding for "nonexistent topic" yields no similarity results
  but the text LIKE '%nonexistent topic%' yields 2 matches
When GET /browse?q=nonexistent%20topic is issued
Then the response contains the 2 text-match entries
And a notice "No semantic matches found. Showing text results instead."
  (or localized equivalent) is rendered
```

**TS-4.6: Unclassified tab + Reclassify-all workflow unchanged**

```
Given the DB contains 3 entries with category IS NULL
When GET /browse?category=unclassified is issued
Then the unclassified tab is rendered as active
And the "Reclassify all" button is present
And POST /api/reclassify-unclassified behaves as before
```

**TS-4.7: `/trash` ignores new filter params, returns 200**

```
Given a running /trash route
When GET /trash?since=week&status=pending&stale_days=5 is issued
Then the response status is 200
And the new params are not validated (no 400)
And no filter bar is rendered on the trash page
```

### Group 5 — Constraints and cross-cutting behavior

**TS-5.1: Pill × works without JavaScript**

```
Given a /browse page rendered with a "Status: Pending" pill
When the × element's markup is inspected
Then it is a plain <a> element (not a <button> requiring JS)
And its href navigates to /browse with the status param removed
```

**TS-5.2: No inline styles in filter bar output**

```
Given a /browse page with the filter bar rendered with various active filters
When the response HTML is parsed
Then no element in the filter-bar subtree has a style="..." attribute
```

**TS-5.3: EN catalog defines all new i18n keys**

```
Given the English catalog src/web/i18n/en.ts
When the new keys introduced by this feature are enumerated
Then each has a non-empty string value (keys: filter.add, filter.clear,
  filter.dimension.status, filter.dimension.since, filter.dimension.stale_days,
  filter.value.status.{pending,done,active,paused,completed},
  filter.value.since.{today,week,month}, filter.pill.status, filter.pill.since,
  filter.pill.stale_days_one, filter.pill.stale_days_other, results.count_zero,
  results.count_one, results.count_other — exact keys finalized in Phase 3)
```

**TS-5.4: DE catalog defines all new i18n keys**

```
Given the German catalog src/web/i18n/de.ts
When the same key set is looked up
Then each has a non-empty translation value
```

**TS-5.5: Invalid param validation runs before DB query**

```
Given the browse-queries module is instrumented to fail on call
When GET /browse?status=typo is issued
Then the response status is 400
And the browse-queries module was never called
```

**TS-5.6: `/browse` still requires auth**

```
Given an unauthenticated request
When GET /browse?since=week is issued (or any new-filter URL)
Then the response redirects to /login (existing requireAuth behavior)
```

**TS-5.7: Incompatible category + status combination returns 0 rows with empty state (integration)**

```
Given the DB contains no entries with category='people' and fields.status='pending'
When GET /browse?category=people&status=pending is issued
Then the response status is 200
And the entry list is empty
And the empty state includes a "Clear filters" link
```

**TS-5.8: Duplicate query param — first value wins**

```
Given a URL /browse?status=pending&status=done
When GET /browse is issued with this URL
Then the response reflects status=pending (first value, Hono/URL default)
And status=done is ignored
```

**TS-5.9: `sort=` param is ignored (NG-1)**

```
Given a URL /browse?sort=oldest
When GET /browse is issued
Then the response status is 200
And entries are returned in the default order (updated_at DESC)
And the sort param has no effect on ordering
```

**TS-5.10: Non-stat dashboard elements are not anchors (NG-11)**

```
Given the dashboard is rendered
When the digest panel, capture input, recent-entries list rows,
  and service-status rows are inspected
Then none of them are newly wrapped in anchors by this feature
  (recent-entries rows continue to be anchors via their existing
   per-entry links; no regression there)
```
