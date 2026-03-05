# Web Dashboard - Test Specification

| Field | Value |
|-------|-------|
| Feature | Web Dashboard |
| Phase | 2 |
| Date | 2026-03-05 |
| Derives From | `web-dashboard-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|-------------------|
| AC-1.1: Dashboard shows most recent digest | TS-1.1 |
| AC-1.2: No digest placeholder with configured time | TS-1.2 |
| AC-1.3: New digest pushed via SSE | TS-1.3 |
| AC-2.1: Shows 5 most recent entries | TS-2.1 |
| AC-2.2: Entries grouped by date, most recent first | TS-2.2 |
| AC-2.3: Entry shows category badge, name, relative time | TS-2.3 |
| AC-2.4: Clicking entry navigates to /entry/:id | TS-2.4 |
| AC-2.5: Soft-deleted entries not shown | TS-2.5 |
| AC-2.6: "View all" link to /browse | TS-2.6 |
| AC-3.1: Entries this week stat | TS-3.1 |
| AC-3.1: Open tasks stat | TS-3.2 |
| AC-3.1: Stalled projects stat | TS-3.3 |
| AC-3.2: Stats reflect current data (page load) | TS-3.4 |
| AC-3.2: Stats update in real-time (SSE) | TS-3.5 |
| AC-4.1: Single-line capture input on dashboard | TS-4.1 |
| AC-4.2: Submit sends through classification pipeline | TS-4.2 |
| AC-4.3: New entry appears via SSE | TS-5.2 |
| AC-4.4: Input cleared after capture | TS-4.3 |
| AC-4.5: Confirmation shows category, name, confidence | TS-4.4 |
| AC-5.1: SSE endpoint connected on page load | TS-5.1 |
| AC-5.2: New entries appear in real-time | TS-5.2 |
| AC-5.3: Entry updates reflected in real-time | TS-5.3 |
| AC-5.3: Entry deletions reflected in real-time | TS-5.4 |
| AC-5.4: New digest pushed via SSE | TS-1.3 |
| C-1: Server-rendered HTML via Hono | TS-6.1 |
| C-2: Tailwind CSS pre-built via CLI | *(build constraint — not behaviorally testable)* |
| C-2: Requires authentication | TS-6.2 |
| C-3: SSE requires session cookie | TS-6.3, TS-5.1 |
| C-4: deleted_at IS NULL filter | TS-2.5 |
| C-5: Stalled = active + >5 days | TS-3.3 |
| C-6: Full classification pipeline | TS-4.2 |
| EC-1: No entries empty state | TS-7.1 |
| EC-2: SSE reconnection | TS-7.2 |
| EC-3: Max 5 entries | TS-2.1 |
| EC-4: Unclassified entries shown | TS-7.3 |
| EC-5: Capture while Ollama down | TS-7.4 |
| EC-6: Capture while Claude down | TS-7.5 |
| EC-7: Multiple tabs SSE | TS-7.6 |

## Test Scenarios

### Group 1: Digest (US-1)

#### TS-1.1: Dashboard shows today's digest

```
Scenario: Dashboard shows today's digest
  Given the user is authenticated
  And a daily digest has been generated
  When the user loads the dashboard
  Then the digest content is displayed on the page
```

**Traces to:** AC-1.1

---

#### TS-1.2: No digest placeholder with configured time

```
Scenario: No digest placeholder with configured time
  Given the user is authenticated
  And no digest has been generated yet
  When the user loads the dashboard
  Then a placeholder message is displayed: "No digest yet — your first one arrives tomorrow at {configured time}"
  And the configured time is derived from the digest_daily_cron setting
```

**Traces to:** AC-1.2

---

#### TS-1.3: New digest appears via SSE

```
Scenario: New digest appears via SSE
  Given the user is authenticated
  And the dashboard is loaded with an active SSE connection
  When a new digest is generated
  Then the digest content on the page is updated without a page refresh
```

**Traces to:** AC-1.3, AC-5.4

---

### Group 2: Recent Entries (US-2)

#### TS-2.1: Dashboard shows 5 most recent entries

```
Scenario: Dashboard shows 5 most recent entries
  Given the user is authenticated
  And 8 entries exist in the database
  When the user loads the dashboard
  Then exactly 5 entries are displayed
  And they are the 5 most recently created entries
```

**Traces to:** AC-2.1, EC-3

---

#### TS-2.2: Entries grouped by date, most recent first

```
Scenario: Entries grouped by date, most recent first
  Given the user is authenticated
  And entries exist from today and yesterday
  When the user loads the dashboard
  Then entries are grouped under date headings
  And today's group appears before yesterday's group
```

**Traces to:** AC-2.2

---

#### TS-2.3: Entry shows category badge, name, and relative time

```
Scenario: Entry shows category badge, name, and relative time
  Given the user is authenticated
  And an entry exists with category "tasks", name "Buy groceries", created 2 hours ago
  When the user loads the dashboard
  Then the entry row displays a "tasks" category badge
  And the entry name "Buy groceries" is displayed
  And a relative time like "2h ago" is displayed
```

**Traces to:** AC-2.3

---

#### TS-2.4: Entry links to detail page

```
Scenario: Entry links to detail page
  Given the user is authenticated
  And an entry exists with a known ID
  When the user loads the dashboard
  Then the entry name is a link to /entry/:id
```

**Traces to:** AC-2.4

---

#### TS-2.5: Soft-deleted entries are excluded

```
Scenario: Soft-deleted entries are excluded
  Given the user is authenticated
  And 3 active entries and 2 soft-deleted entries exist
  When the user loads the dashboard
  Then only the 3 active entries are displayed
  And the soft-deleted entries are not shown
```

**Traces to:** AC-2.5, C-4

---

#### TS-2.6: "View all" link navigates to /browse

```
Scenario: "View all" link navigates to /browse
  Given the user is authenticated
  When the user loads the dashboard
  Then a "View all" link is displayed
  And the link points to /browse
```

**Traces to:** AC-2.6

---

### Group 3: Stats (US-3)

#### TS-3.1: Entries this week count

```
Scenario: Entries this week count
  Given the user is authenticated
  And 4 entries were created this calendar week
  And 2 entries were created last week
  When the user loads the dashboard
  Then the "entries this week" stat displays 4
```

**Traces to:** AC-3.1 (entries this week)

---

#### TS-3.2: Open tasks count

```
Scenario: Open tasks count
  Given the user is authenticated
  And 3 entries exist with category "tasks" and status "pending"
  And 1 entry exists with category "tasks" and status "done"
  And 1 soft-deleted entry exists with category "tasks" and status "pending"
  When the user loads the dashboard
  Then the "open tasks" stat displays 3
```

**Traces to:** AC-3.1 (open tasks)

---

#### TS-3.3: Stalled projects count

```
Scenario: Stalled projects count
  Given the user is authenticated
  And 2 entries exist with category "projects", status "active", and updated_at older than 5 days
  And 1 entry exists with category "projects", status "active", and updated_at 1 day ago
  And 1 entry exists with category "projects", status "paused", and updated_at older than 5 days
  When the user loads the dashboard
  Then the "stalled projects" stat displays 2
```

**Traces to:** AC-3.1 (stalled projects), C-5

---

#### TS-3.4: Stats reflect current data on page load

```
Scenario: Stats reflect current data on page load
  Given the user is authenticated
  And a new task entry with status "pending" is created
  When the user loads the dashboard
  Then the "open tasks" stat includes the newly created entry
```

**Traces to:** AC-3.2 (page load)

---

#### TS-3.5: Stats update in real-time via SSE

```
Scenario: Stats update in real-time via SSE
  Given the user is authenticated
  And the dashboard is loaded with an active SSE connection
  When a new entry is created from another source
  Then the stats are recalculated without a page refresh
```

**Traces to:** AC-3.2 (SSE)

---

### Group 4: Quick Capture (US-4)

#### TS-4.1: Capture input is present on dashboard

```
Scenario: Capture input is present on dashboard
  Given the user is authenticated
  When the user loads the dashboard
  Then a single-line text input is displayed
  And the input has a placeholder indicating its purpose
```

**Traces to:** AC-4.1

---

#### TS-4.2: Submitting capture sends text through classification pipeline

```
Scenario: Submitting capture sends text through classification pipeline
  Given the user is authenticated
  And the dashboard is loaded
  When the user submits "Call dentist tomorrow" via the capture input
  Then the text is sent to the server
  And the entry is classified, embedded, and stored with source "webapp"
```

**Traces to:** AC-4.2, C-6

---

#### TS-4.3: Capture input is cleared after successful submission

```
Scenario: Capture input is cleared after successful submission
  Given the user is authenticated
  And the dashboard is loaded
  And the capture API is available
  When the user submits text via the capture input
  Then the input field is cleared
```

**Traces to:** AC-4.4

---

#### TS-4.4: Confirmation shows classification result

```
Scenario: Confirmation shows classification result
  Given the user is authenticated
  And the dashboard is loaded
  And the capture API is available
  When the user submits text via the capture input
  Then a confirmation message is briefly displayed showing the category, name, and confidence percentage
```

**Traces to:** AC-4.5

---

### Group 5: SSE Live Updates (US-5)

#### TS-5.1: Dashboard connects to SSE endpoint on page load

```
Scenario: Dashboard connects to SSE endpoint on page load
  Given the user is authenticated
  When the user loads the dashboard
  Then the page establishes a connection to the SSE endpoint
  And the connection includes the session cookie for authentication
```

**Traces to:** AC-5.1, C-3

---

#### TS-5.2: New entry appears in real-time via SSE

```
Scenario: New entry appears in real-time via SSE
  Given the user is authenticated
  And the dashboard is loaded with an active SSE connection
  When a new entry is created from any source
  Then the entry appears in the recent entries list without a page refresh
```

**Traces to:** AC-5.2, AC-4.3

---

#### TS-5.3: Entry update is reflected in real-time via SSE

```
Scenario: Entry update is reflected in real-time via SSE
  Given the user is authenticated
  And the dashboard is loaded with an active SSE connection
  And an entry is displayed in the recent entries list
  When that entry is updated
  Then the entry's content on the page is updated without a page refresh
```

**Traces to:** AC-5.3 (updates)

---

#### TS-5.4: Entry deletion is reflected in real-time via SSE

```
Scenario: Entry deletion is reflected in real-time via SSE
  Given the user is authenticated
  And the dashboard is loaded with an active SSE connection
  And an entry is displayed in the recent entries list
  When that entry is soft-deleted
  Then the entry is removed from the recent entries list without a page refresh
```

**Traces to:** AC-5.3 (deletes)

---

### Group 6: Constraints

#### TS-6.1: Dashboard returns server-rendered HTML

```
Scenario: Dashboard returns server-rendered HTML
  Given the user is authenticated
  When the user loads the dashboard
  Then the response content-type is HTML
  And the response body contains the dashboard content as rendered HTML
```

**Traces to:** C-1

---

#### TS-6.2: Unauthenticated dashboard request redirects to login

```
Scenario: Unauthenticated dashboard request redirects to login
  Given the user is not authenticated
  When the user requests the dashboard
  Then the user is redirected to /login
  And the redirect preserves the original URL
```

**Traces to:** C-2

---

#### TS-6.3: Unauthenticated SSE request is rejected

```
Scenario: Unauthenticated SSE request is rejected
  Given the user is not authenticated
  When the user attempts to connect to the SSE endpoint
  Then the connection is rejected with 401 Unauthorized
```

**Traces to:** C-3

---

### Group 7: Edge Cases

#### TS-7.1: Empty state when no entries exist

```
Scenario: Empty state when no entries exist
  Given the user is authenticated
  And no entries exist in the database
  When the user loads the dashboard
  Then the recent entries section shows an empty state message
  And all three stats display zero
```

**Traces to:** EC-1

---

#### TS-7.2: SSE reconnects after connection drop

```
Scenario: SSE reconnects after connection drop
  Given the user is authenticated
  And the dashboard is loaded with an active SSE connection
  When the SSE connection drops
  Then the client automatically attempts to reconnect
```

**Traces to:** EC-2

---

#### TS-7.3: Unclassified entries shown with unclassified badge

```
Scenario: Unclassified entries shown with unclassified badge
  Given the user is authenticated
  And an entry exists with category null (classification failed)
  When the user loads the dashboard
  Then the entry is displayed in the recent entries list
  And the entry shows an "unclassified" badge instead of a category badge
```

**Traces to:** EC-4

---

#### TS-7.4: Capture succeeds when Ollama is down

```
Scenario: Capture succeeds when Ollama is down
  Given the user is authenticated
  And the dashboard is loaded
  And the Ollama embedding service is unavailable
  When the user submits text via the capture input
  Then the entry is saved without an embedding
  And the confirmation still shows the classification result
```

**Traces to:** EC-5

---

#### TS-7.5: Capture succeeds when Claude API is down

```
Scenario: Capture succeeds when Claude API is down
  Given the user is authenticated
  And the dashboard is loaded
  And the LLM classification service is unavailable
  When the user submits text via the capture input
  Then the entry is saved with category null and confidence null
  And the entry appears in the recent entries list with an "unclassified" badge
```

**Traces to:** EC-6

---

#### TS-7.6: Multiple tabs receive the same SSE updates

```
Scenario: Multiple tabs receive the same SSE updates
  Given the user is authenticated
  And two dashboard instances are loaded with separate SSE connections
  When a new entry is created
  Then both instances receive the entry via their respective SSE connections
```

**Traces to:** EC-7

---

## Traceability Summary

All acceptance criteria (AC-1.1 through AC-5.4), all testable constraints (C-1, C-3 through C-7), and all edge cases (EC-1 through EC-7) have at least one corresponding test scenario. Constraint C-2 (Tailwind CSS pre-built via CLI) is a build/tooling constraint with no observable behavioral outcome — explicitly excluded.

**Total scenarios:** 31

## Orphan Check

No orphan scenarios. Every scenario traces to at least one spec requirement.
