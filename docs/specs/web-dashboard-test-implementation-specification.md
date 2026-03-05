# Web Dashboard - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Web Dashboard |
| Phase | 3 |
| Date | 2026-03-05 |
| Derives From | `web-dashboard-test-specification.md` |

## Test Framework & Conventions

- **Framework:** Vitest (project standard)
- **Style:** `describe`/`it` blocks with explicit imports (`import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"`)
- **HTTP testing:** Hono's built-in `app.request(url, init?)` — no real server needed
- **Module mocking:** `vi.mock()` for query functions, classification, and embedding modules
- **Env var control:** `tests/helpers/env.ts` (`withEnv`, `setRequiredEnvVars`, `clearAllConfigEnvVars`)
- **DB testing:** testcontainers with `pgvector/pgvector:pg16` for integration tests (existing `tests/helpers/test-db.ts`)
- **Auth reuse:** Login helper pattern from `web-auth.test.ts` — POST `/login` and extract `Set-Cookie`
- **SSE testing:** Read from `Response.body` ReadableStream; event bus for controlled broadcasting

## Test Structure

### File Organization

```
tests/unit/web-dashboard.test.ts                # 22 unit tests (mocked queries)
tests/integration/web-dashboard-integration.test.ts  # 9 integration tests (testcontainers)
```

**Unit tests** mock the data layer (query functions, classify, embed) and test HTTP handler behavior — HTML rendering, response format, auth enforcement, SSE protocol.

**Integration tests** use testcontainers with real PostgreSQL, seed data via SQL, and verify actual query correctness, full capture pipeline, and SSE event broadcasting.

### Test Grouping

```typescript
// Unit tests
describe("Web Dashboard", () => {
  describe("Digest (US-1)", () => { /* TS-1.1, TS-1.2 */ });
  describe("Recent Entries (US-2)", () => { /* TS-2.1 through TS-2.6 */ });
  describe("Stats (US-3)", () => { /* TS-3.1, TS-3.2, TS-3.3 */ });
  describe("Quick Capture (US-4)", () => { /* TS-4.1, TS-4.4 */ });
  describe("SSE (US-5)", () => { /* TS-5.1 */ });
  describe("Constraints", () => { /* TS-6.1, TS-6.2, TS-6.3 */ });
  describe("Edge Cases", () => { /* TS-7.1, TS-7.2, TS-7.3, TS-7.4, TS-7.5 */ });
});

// Integration tests
describe("Web Dashboard Integration", () => {
  describe("Digest SSE", () => { /* TS-1.3 */ });
  describe("Entry Filtering", () => { /* TS-2.5 */ });
  describe("Stats Queries", () => { /* TS-3.4, TS-3.5 */ });
  describe("Capture Pipeline", () => { /* TS-4.2, TS-4.3 */ });
  describe("SSE Events", () => { /* TS-5.2, TS-5.3, TS-5.4 */ });
  describe("Multiple Connections", () => { /* TS-7.6 */ });
});
```

### Naming Convention

Test names mirror scenario titles from the test specification:

```typescript
it("shows today's digest content")                            // TS-1.1
it("shows placeholder when no digest exists")                 // TS-1.2
it("displays 5 most recent entries when more exist")          // TS-2.1
it("excludes soft-deleted entries from results")              // TS-2.5
it("returns 401 for unauthenticated SSE request")             // TS-6.3
```

## Expected Module API

### Dashboard Routes (`src/web/dashboard.ts`)

```typescript
export function createDashboardRoutes(sql: Sql, broadcaster: SSEBroadcaster): Hono;
```

The factory returns a Hono sub-app with:
- `GET /` — renders dashboard HTML (digest, entries, stats, capture input)
- `POST /api/capture` — accepts `{ text: string }`, runs classification + embedding pipeline, stores entry, broadcasts SSE event, returns `{ id, category, name, confidence }`
- `GET /api/events` — SSE endpoint, streams events to connected clients

Internal query functions (imported or defined within module):
- `getRecentEntries(sql, limit?)` — returns non-deleted entries ordered by `created_at DESC`
- `getDashboardStats(sql)` — returns `{ entriesThisWeek, openTasks, stalledProjects }`
- `getLatestDigest(sql)` — returns latest digest content or null

The dashboard imports from existing modules:
- `classifyEntry` from `src/classify.ts`
- `embedEntry` from `src/embed.ts`
- `resolveConfigValue` from `src/config.ts` (for `digest_daily_cron`)

### SSE Broadcaster (`src/web/sse.ts`)

```typescript
export interface SSEBroadcaster {
  subscribe(listener: (event: SSEEvent) => void): () => void;
  broadcast(event: SSEEvent): void;
}

export interface SSEEvent {
  type: "entry:created" | "entry:updated" | "entry:deleted" | "digest:updated";
  data: Record<string, unknown>;
}

export function createSSEBroadcaster(): SSEBroadcaster;
```

The broadcaster is an in-memory event bus (EventEmitter wrapper). Created once at app startup, passed to all modules that need to emit or listen for events. The SSE endpoint subscribes on connection and unsubscribes on disconnect.

## Test App Factory

### Unit Test Factory

```typescript
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

async function createTestDashboard(
  overrides: Partial<MockDeps> = {}
): Promise<{ app: Hono; broadcaster: SSEBroadcaster }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createDashboardRoutes } = await import("../../src/web/dashboard.js");
  const { createSSEBroadcaster } = await import("../../src/web/sse.js");

  const broadcaster = createSSEBroadcaster();
  const mockSql = {} as any; // Query functions are mocked via vi.mock()

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createDashboardRoutes(mockSql, broadcaster));

  return { app, broadcaster };
}
```

### Login Helper (reused pattern)

```typescript
async function loginAndGetCookie(
  app: Hono,
  password = TEST_PASSWORD
): Promise<string> {
  const res = await app.request("/login", {
    method: "POST",
    body: new URLSearchParams({ password }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}
```

### Integration Test Factory

```typescript
import { startTestDb, runMigrations } from "../helpers/test-db.js";

let sql: Sql;
let container: StartedTestContainer;

beforeAll(async () => {
  const db = await startTestDb();
  container = db.container;
  sql = db.sql;
  await runMigrations(db.url);
}, 60_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

async function createIntegrationDashboard(): Promise<{ app: Hono; broadcaster: SSEBroadcaster }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createDashboardRoutes } = await import("../../src/web/dashboard.js");
  const { createSSEBroadcaster } = await import("../../src/web/sse.js");

  const broadcaster = createSSEBroadcaster();

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createDashboardRoutes(sql, broadcaster));

  return { app, broadcaster };
}
```

### SSE Reader Helper

```typescript
async function readSSEEvent(
  response: Response,
  timeoutMs = 2000
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SSE read timeout")), timeoutMs)
      ),
    ]);
    return decoder.decode(result.value);
  } finally {
    reader.cancel();
  }
}
```

## Test Scenario Mapping

| Test Scenario ID | Scenario Title | Test File | Test Function |
|------------------|----------------|-----------|---------------|
| TS-1.1 | Dashboard shows today's digest | unit | `it("shows today's digest content")` |
| TS-1.2 | No digest placeholder with configured time | unit | `it("shows placeholder when no digest exists")` |
| TS-1.3 | New digest appears via SSE | integration | `it("pushes new digest content via SSE")` |
| TS-2.1 | Dashboard shows 5 most recent entries | unit | `it("displays 5 most recent entries when more exist")` |
| TS-2.2 | Entries grouped by date, most recent first | unit | `it("groups entries by date with most recent first")` |
| TS-2.3 | Entry shows category badge, name, relative time | unit | `it("renders entry with category badge, name, and relative time")` |
| TS-2.4 | Entry links to detail page | unit | `it("links entry name to /entry/:id")` |
| TS-2.5 | Soft-deleted entries are excluded | integration | `it("excludes soft-deleted entries from results")` |
| TS-2.6 | "View all" link navigates to /browse | unit | `it("includes a View all link to /browse")` |
| TS-3.1 | Entries this week count | unit | `it("displays entries this week count")` |
| TS-3.2 | Open tasks count | unit | `it("displays open tasks count")` |
| TS-3.3 | Stalled projects count | unit | `it("displays stalled projects count")` |
| TS-3.4 | Stats reflect current data (page load) | integration | `it("reflects current stats on page load after new entry")` |
| TS-3.5 | Stats update in real-time via SSE | integration | `it("updates stats via SSE after data change")` |
| TS-4.1 | Capture input is present on dashboard | unit | `it("renders capture input on dashboard")` |
| TS-4.2 | Submitting capture sends through pipeline | integration | `it("classifies, embeds, and stores captured text")` |
| TS-4.3 | Capture input cleared after submission | integration | `it("returns success response for client to clear input")` |
| TS-4.4 | Confirmation shows classification result | unit | `it("returns category, name, and confidence in capture response")` |
| TS-5.1 | Dashboard connects to SSE endpoint | unit | `it("returns event-stream content-type for SSE endpoint")` |
| TS-5.2 | New entry appears in real-time via SSE | integration | `it("streams entry:created event when entry is inserted")` |
| TS-5.3 | Entry update is reflected via SSE | integration | `it("streams entry:updated event when entry is modified")` |
| TS-5.4 | Entry deletion is reflected via SSE | integration | `it("streams entry:deleted event when entry is soft-deleted")` |
| TS-6.1 | Dashboard returns server-rendered HTML | unit | `it("returns HTML content-type for dashboard")` |
| TS-6.2 | Unauthenticated redirect to login | unit | `it("redirects unauthenticated dashboard request to /login")` |
| TS-6.3 | Unauthenticated SSE request rejected | unit | `it("returns 401 for unauthenticated SSE request")` |
| TS-7.1 | Empty state when no entries exist | unit | `it("shows empty state message and zero stats")` |
| TS-7.2 | SSE reconnects after connection drop | unit | `it("includes retry field in SSE stream")` |
| TS-7.3 | Unclassified entries shown with badge | unit | `it("renders unclassified badge for entry with null category")` |
| TS-7.4 | Capture succeeds when Ollama is down | unit | `it("saves entry without embedding when Ollama fails")` |
| TS-7.5 | Capture succeeds when Claude API is down | unit | `it("saves entry with null category when classification fails")` |
| TS-7.6 | Multiple tabs receive same SSE updates | integration | `it("delivers same event to multiple SSE connections")` |

## Detailed Scenario Implementation

### Group 1: Digest (US-1)

#### TS-1.1: Dashboard shows today's digest (unit)

- **Setup (Given):** Mock `getLatestDigest` to return `{ content: "## Daily Summary\nYou had 5 entries today.", created_at: new Date() }`. Create test app via `createTestDashboard()`. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body (HTML) contains the digest content text "Daily Summary" and "5 entries today" rendered in the digest section.

#### TS-1.2: No digest placeholder with configured time (unit)

- **Setup (Given):** Mock `getLatestDigest` to return `null`. Mock `resolveConfigValue("digest_daily_cron", sql)` to return `"0 7 * * *"`. Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains placeholder text matching "No digest yet" and includes "7:00" (parsed from the cron expression `0 7 * * *`).

#### TS-1.3: New digest appears via SSE (integration)

- **Setup (Given):** Create integration app with real DB. Login. Connect to SSE endpoint. Allow a microtask yield for handler registration.
- **Action (When):** `broadcaster.broadcast({ type: "digest:updated", data: { content: "New digest content" } })`.
- **Assertion (Then):** Read from SSE stream. Event text contains `event: digest:updated` and `"New digest content"`.

---

### Group 2: Recent Entries (US-2)

#### TS-2.1: Dashboard shows 5 most recent entries (unit)

- **Setup (Given):** Mock `getRecentEntries` to return 5 entries (simulating the query limiting to 5 from a larger set). Each entry has `id`, `name`, `category`, `created_at`. Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains exactly 5 entry names. All 5 names are present in the HTML.

Note: The query function enforces the `LIMIT 5` — the unit test verifies the handler renders all entries the query returns. The integration test for TS-2.5 verifies the actual SQL query limit behavior.

#### TS-2.2: Entries grouped by date, most recent first (unit)

- **Setup (Given):** Mock `getRecentEntries` to return entries from two dates: 2 from today, 3 from yesterday. Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains two date group headings. Today's heading appears before yesterday's heading in the HTML. Use string index comparison: `body.indexOf(todayHeading) < body.indexOf(yesterdayHeading)`.

#### TS-2.3: Entry shows category badge, name, and relative time (unit)

- **Setup (Given):** Mock `getRecentEntries` to return one entry: `{ id: "abc-123", name: "Buy groceries", category: "tasks", created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) }` (2 hours ago). Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains:
  - Text "tasks" (category badge)
  - Text "Buy groceries" (entry name)
  - Text matching relative time pattern (e.g., "2h ago" or "2 hours ago")

#### TS-2.4: Entry links to detail page (unit)

- **Setup (Given):** Mock `getRecentEntries` to return one entry with `id: "550e8400-e29b-41d4-a716-446655440000"`. Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains an `<a` tag with `href="/entry/550e8400-e29b-41d4-a716-446655440000"`.

#### TS-2.5: Soft-deleted entries are excluded (integration)

- **Setup (Given):** Insert 3 active entries and 2 soft-deleted entries (with `deleted_at` set) into the real DB. Create integration app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains only the 3 active entry names. The 2 soft-deleted entry names do NOT appear in the body.

This test verifies the SQL query includes `WHERE deleted_at IS NULL`.

#### TS-2.6: "View all" link navigates to /browse (unit)

- **Setup (Given):** Mock `getRecentEntries` to return at least 1 entry. Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains an `<a` tag with `href="/browse"` and text "View all" (case-insensitive).

---

### Group 3: Stats (US-3)

#### TS-3.1: Entries this week count (unit)

- **Setup (Given):** Mock `getDashboardStats` to return `{ entriesThisWeek: 4, openTasks: 0, stalledProjects: 0 }`. Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains "4" in the entries-this-week stat area. Verify the surrounding context identifies it as the "entries this week" metric (not just any "4" on the page).

#### TS-3.2: Open tasks count (unit)

- **Setup (Given):** Mock `getDashboardStats` to return `{ entriesThisWeek: 0, openTasks: 3, stalledProjects: 0 }`. Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains "3" in the open-tasks stat area with surrounding context identifying it as "open tasks".

#### TS-3.3: Stalled projects count (unit)

- **Setup (Given):** Mock `getDashboardStats` to return `{ entriesThisWeek: 0, openTasks: 0, stalledProjects: 2 }`. Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains "2" in the stalled-projects stat area with surrounding context identifying it as "stalled projects".

#### TS-3.4: Stats reflect current data on page load (integration)

- **Setup (Given):** Insert a task entry with `category = 'tasks'`, `fields = '{"status":"pending"}'`, `deleted_at = NULL` into the real DB. Create integration app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body shows open tasks count that includes the newly inserted entry (at least 1).

This verifies the stats query runs at page load time and reflects the current DB state.

#### TS-3.5: Stats update in real-time via SSE (integration)

- **Setup (Given):** Create integration app. Login. Connect to SSE endpoint.
- **Action (When):** `broadcaster.broadcast({ type: "entry:created", data: { id: "new-id", category: "tasks", fields: { status: "pending" } } })`.
- **Assertion (Then):** Read from SSE stream. The event contains data that enables the client to update stats (the event includes enough entry data for the client to recalculate, or a separate `stats:updated` event is emitted).

Note: The exact SSE payload design (full entry vs stats summary) is an implementation decision. The test verifies that after a data change, the SSE stream delivers information enabling stats refresh.

---

### Group 4: Quick Capture (US-4)

#### TS-4.1: Capture input is present on dashboard (unit)

- **Setup (Given):** Create test app (any mock data). Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains an `<input` element (or `<form`) with a text input. Check for a placeholder attribute indicating capture purpose (e.g., "What's on your mind").

#### TS-4.2: Submitting capture sends through classification pipeline (integration)

- **Setup (Given):** Create integration app with real DB. Mock `classifyEntry` to return `{ category: "tasks", name: "Call dentist", confidence: 0.92, fields: { status: "pending" } }`. Mock `embedEntry` to resolve successfully. Login.
- **Action (When):** `app.request("/api/capture", { method: "POST", body: JSON.stringify({ text: "Call dentist tomorrow" }), headers: { Cookie: cookie, "Content-Type": "application/json" } })`.
- **Assertion (Then):**
  - Response status 201.
  - Response JSON contains `{ category: "tasks", name: "Call dentist", confidence }`.
  - `classifyEntry` was called with the submitted text.
  - `embedEntry` was called with the new entry ID.
  - A row exists in the `entries` table with `source = 'webapp'`, `name = 'Call dentist'`, `category = 'tasks'`.

#### TS-4.3: Capture input cleared after successful submission (integration)

- **Setup (Given):** Create integration app. Mock classify/embed to succeed. Login.
- **Action (When):** `app.request("/api/capture", { method: "POST", body: JSON.stringify({ text: "Test note" }), headers: { Cookie: cookie, "Content-Type": "application/json" } })`.
- **Assertion (Then):** Response status is 2xx (success). This is the server-side contract that enables the client to clear the input field. The client clears based on a successful response.

Note: Input clearing is client-side JavaScript behavior. The server-side test verifies the success response that triggers it. The behavioral spec says "input is cleared after successful capture" — the server fulfills its part by returning success.

#### TS-4.4: Confirmation shows classification result (unit)

- **Setup (Given):** Mock `classifyEntry` to return `{ category: "ideas", name: "App for plant watering", confidence: 0.87, fields: {} }`. Mock `embedEntry` to resolve. Create test app. Login.
- **Action (When):** `app.request("/api/capture", { method: "POST", body: JSON.stringify({ text: "App idea for plant watering" }), headers: { Cookie: cookie, "Content-Type": "application/json" } })`.
- **Assertion (Then):** Response status 201. Response JSON includes:
  - `category: "ideas"`
  - `name: "App for plant watering"`
  - `confidence: 0.87` (or the numeric value)

The client renders this data as a brief confirmation.

---

### Group 5: SSE Live Updates (US-5)

#### TS-5.1: Dashboard connects to SSE endpoint on page load (unit)

- **Setup (Given):** Create test app. Login.
- **Action (When):** `app.request("/api/events", { headers: { Cookie: cookie } })`.
- **Assertion (Then):**
  - Response status 200.
  - `Content-Type` header contains `text/event-stream`.
  - `Cache-Control` header contains `no-cache`.
  - Response body is a readable stream (not null).

Note: The test verifies the SSE endpoint is accessible with authentication. The behavioral spec says "connection includes the session cookie" — this is verified by the auth middleware passing the request through.

#### TS-5.2: New entry appears in real-time via SSE (integration)

- **Setup (Given):** Create integration app. Login. Start SSE connection. Yield a microtask for handler setup.
- **Action (When):** Insert an entry into the DB via the capture API or directly. The insertion triggers `broadcaster.broadcast({ type: "entry:created", data: entry })`.
- **Assertion (Then):** Read from SSE stream via `readSSEEvent()`. The event text contains `event: entry:created` and the entry's `id` and `name` in the JSON data payload.

#### TS-5.3: Entry update is reflected in real-time via SSE (integration)

- **Setup (Given):** Create integration app. Insert an entry. Login. Start SSE connection.
- **Action (When):** Update the entry (e.g., change name). Broadcast `{ type: "entry:updated", data: updatedEntry }`.
- **Assertion (Then):** Read from SSE stream. Event contains `event: entry:updated` and the updated entry data.

#### TS-5.4: Entry deletion is reflected in real-time via SSE (integration)

- **Setup (Given):** Create integration app. Insert an entry. Login. Start SSE connection.
- **Action (When):** Soft-delete the entry (set `deleted_at`). Broadcast `{ type: "entry:deleted", data: { id: entryId } }`.
- **Assertion (Then):** Read from SSE stream. Event contains `event: entry:deleted` and the entry's `id`.

---

### Group 6: Constraints

#### TS-6.1: Dashboard returns server-rendered HTML (unit)

- **Setup (Given):** Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. `Content-Type` header contains `text/html`. Response body starts with `<!DOCTYPE html>` or `<html` (server-rendered, not a JSON API).

#### TS-6.2: Unauthenticated dashboard request redirects to login (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/")`.
- **Assertion (Then):** Response status 302. `Location` header is `/login?redirect=%2F` (or equivalent URL-encoded form preserving the original URL).

Note: This behavior is provided by `createAuthMiddleware` (already implemented and tested in web-auth). This test confirms the dashboard route is behind the auth middleware.

#### TS-6.3: Unauthenticated SSE request is rejected (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/api/events")`.
- **Assertion (Then):** Response status 401. The auth middleware returns 401 for `/api/*` routes (not a redirect). No SSE stream is established.

---

### Group 7: Edge Cases

#### TS-7.1: Empty state when no entries exist (unit)

- **Setup (Given):** Mock `getRecentEntries` to return `[]`. Mock `getDashboardStats` to return `{ entriesThisWeek: 0, openTasks: 0, stalledProjects: 0 }`. Mock `getLatestDigest` to return `null`. Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains an empty state message (e.g., "No entries yet" or similar text from the spec). All three stats display "0".

#### TS-7.2: SSE reconnects after connection drop (unit)

- **Setup (Given):** Create test app. Login.
- **Action (When):** `app.request("/api/events", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Read initial SSE data. The stream includes a `retry:` field (sets reconnection interval for the `EventSource` API). The retry value is a positive integer (milliseconds).

Note: Actual reconnection is handled by the browser's `EventSource` API natively. The server-side contract is to include the `retry` field so the client knows the reconnection interval. The test verifies the server sends this field.

#### TS-7.3: Unclassified entries shown with unclassified badge (unit)

- **Setup (Given):** Mock `getRecentEntries` to return one entry with `category: null` (classification failed). Create test app. Login.
- **Action (When):** `app.request("/", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains the entry name. Instead of a category badge like "tasks" or "ideas", it displays an "unclassified" badge (text "unclassified" appears near the entry).

#### TS-7.4: Capture succeeds when Ollama is down (unit)

- **Setup (Given):** Mock `classifyEntry` to return a valid result `{ category: "tasks", name: "Test", confidence: 0.9, fields: {} }`. Mock `embedEntry` to throw an error (Ollama unavailable). Create test app. Login.
- **Action (When):** `app.request("/api/capture", { method: "POST", body: JSON.stringify({ text: "Test note" }), headers: { Cookie: cookie, "Content-Type": "application/json" } })`.
- **Assertion (Then):**
  - Response status is 201 (NOT an error).
  - Response JSON still includes the classification result (`category`, `name`, `confidence`).
  - The entry is saved (mock DB insertion was called) without an embedding.
  - `embedEntry` was called but its failure did not prevent the capture from succeeding.

Note: The behavioral spec says "entry is saved without an embedding" and "confirmation still shows the classification result." The embed failure is swallowed; the entry is saved with `embedding: null`.

#### TS-7.5: Capture succeeds when Claude API is down (unit)

- **Setup (Given):** Mock `classifyEntry` to throw an error (LLM unavailable). Mock `embedEntry` to throw (embedding also fails without classification). Create test app. Login.
- **Action (When):** `app.request("/api/capture", { method: "POST", body: JSON.stringify({ text: "Test note" }), headers: { Cookie: cookie, "Content-Type": "application/json" } })`.
- **Assertion (Then):**
  - Response status is 201 (NOT an error).
  - Response JSON shows `category: null`, `confidence: null`.
  - The entry is saved with the raw text as content, `category: null`, and `source: 'webapp'`.

Note: The behavioral spec says "entry is saved with category null and confidence null" and "appears with an unclassified badge." The capture must not fail even when classification is unavailable.

#### TS-7.6: Multiple tabs receive the same SSE updates (integration)

- **Setup (Given):** Create integration app. Login. Open two separate SSE connections by calling `app.request("/api/events", ...)` twice with the same session cookie.
- **Action (When):** `broadcaster.broadcast({ type: "entry:created", data: { id: "multi-tab-test", name: "Shared event" } })`.
- **Assertion (Then):** Read from both SSE response streams. Both contain `event: entry:created` with the same entry data. Each connection receives an independent copy of the event.

---

## Fixtures & Test Data

### Constants

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
```

### Entry Factory

```typescript
function createMockEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: crypto.randomUUID(),
    name: "Test Entry",
    category: "tasks",
    content: "Test content",
    fields: {},
    tags: [],
    confidence: 0.85,
    source: "telegram",
    source_type: "text",
    embedding: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}
```

### Stats Factory

```typescript
function createMockStats(overrides: Partial<Stats> = {}): Stats {
  return {
    entriesThisWeek: 0,
    openTasks: 0,
    stalledProjects: 0,
    ...overrides,
  };
}
```

### Integration Test Data Seeding

For integration tests, entries are inserted directly via SQL:

```typescript
async function seedEntry(sql: Sql, overrides: Partial<Entry> = {}): Promise<string> {
  const entry = createMockEntry(overrides);
  await sql`
    INSERT INTO entries (id, name, category, content, fields, tags, confidence, source, source_type, deleted_at, created_at, updated_at)
    VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
            ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
            ${entry.source}, ${entry.source_type}, ${entry.deleted_at},
            ${entry.created_at}, ${entry.updated_at})
  `;
  return entry.id;
}

async function clearEntries(sql: Sql): Promise<void> {
  await sql`DELETE FROM entries`;
}
```

### Shared Helpers

| Helper | Purpose | Scope |
|--------|---------|-------|
| `createTestDashboard(overrides?)` | Unit: Hono app with mocked data layer + auth | Per-test |
| `createIntegrationDashboard()` | Integration: Hono app with real DB + auth | Per-test |
| `loginAndGetCookie(app, password?)` | Authenticates and returns session cookie string | Per-test |
| `readSSEEvent(response, timeout?)` | Reads one event from SSE response stream | Per-test |
| `createMockEntry(overrides?)` | Produces an entry object with sensible defaults | Per-test |
| `createMockStats(overrides?)` | Produces a stats object with sensible defaults | Per-test |
| `seedEntry(sql, overrides?)` | Integration: inserts an entry into real DB | Per-test |
| `clearEntries(sql)` | Integration: deletes all entries between tests | Per-test |

### Mocking Strategy

**Unit tests mock three layers:**

1. **Query functions** — Via `vi.mock()` on the dashboard query module (or internal functions):
   ```typescript
   vi.mock("../../src/web/dashboard-queries.js", () => ({
     getRecentEntries: vi.fn().mockResolvedValue([]),
     getDashboardStats: vi.fn().mockResolvedValue({ entriesThisWeek: 0, openTasks: 0, stalledProjects: 0 }),
     getLatestDigest: vi.fn().mockResolvedValue(null),
   }));
   ```
   Each test overrides return values via `mockResolvedValue()` or `mockResolvedValueOnce()`.

2. **Classification** — Via `vi.mock()` on `src/classify.ts`:
   ```typescript
   vi.mock("../../src/classify.js", () => ({
     classifyEntry: vi.fn().mockResolvedValue({
       category: "tasks", name: "Mock", confidence: 0.9, fields: {},
     }),
   }));
   ```

3. **Embedding** — Via `vi.mock()` on `src/embed.ts`:
   ```typescript
   vi.mock("../../src/embed.js", () => ({
     embedEntry: vi.fn().mockResolvedValue(undefined),
   }));
   ```

**Integration tests mock only external services** (LLM + Ollama), not the DB:
- `classifyEntry` — mocked via `vi.mock()` (requires LLM API)
- `embedEntry` — mocked via `vi.mock()` (requires Ollama)
- Database — real testcontainers PostgreSQL, no mocks

### Setup / Teardown

```typescript
// Unit tests
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Integration tests
beforeEach(async () => {
  await clearEntries(sql);
});
```

## Alignment Check

**Status: Full alignment.**

All 31 test scenarios from the test specification (TS-1.1 through TS-7.6) are mapped to test functions with setup, action, and assertion strategies defined. Split: 22 unit tests + 9 integration tests.

| Check | Result |
|-------|--------|
| Every TS-ID mapped to a test function | Yes (31/31) |
| One behavior per test | Yes |
| All tests will initially fail | Yes (see notes below) |
| Test isolation verified | Yes (per-test factory, `clearEntries` between integration tests) |
| No implementation coupling | Yes (tests verify observable HTTP behavior) |

### Notes

1. **TS-6.2 and TS-6.3** (auth enforcement) will fail because the dashboard routes don't exist yet, which means the auth middleware has no routes to protect at `/` and `/api/events`. These will pass once the dashboard module is created and wired into the app.

2. **TS-4.3** (input cleared) is tested server-side by verifying the capture API returns a success response. The actual input clearing is client-side JavaScript. This is the correct boundary — the server fulfills its contract (success response), and the client fulfills its contract (clear on success).

3. **TS-7.2** (SSE reconnection) is tested by verifying the server sends a `retry:` field in the SSE stream. Actual reconnection is native `EventSource` behavior.

4. **TS-3.5** (stats via SSE) — the exact mechanism (dedicated `stats:updated` event vs client-side recalculation from `entry:created` events) is an implementation decision. The test verifies that the SSE stream delivers information enabling the client to update stats.

5. **Digest storage** — The dashboard queries for digest content via `getLatestDigest()`. The digests feature (Phase 6) has not been built yet. For unit tests, this function is mocked. For integration tests, digest data can be seeded directly. The exact storage table/mechanism is deferred to the digests feature implementation. If a `digests` table doesn't exist at test time, integration tests for TS-1.3 can seed via the broadcaster directly (bypassing the query).

6. **SSE timing** — SSE tests that involve broadcasting after connecting need a microtask yield (`await new Promise(r => setTimeout(r, 0))`) between starting the SSE connection and broadcasting, to allow the handler's event listener to register. The `readSSEEvent` helper includes a timeout to prevent hanging if events don't arrive.

7. **Query function organization** — The spec references query functions (`getRecentEntries`, `getDashboardStats`, `getLatestDigest`) as mockable units. Whether these are exported from `dashboard.ts` directly, placed in a separate `dashboard-queries.ts`, or extracted some other way is an implementation decision. The test mocking approach (`vi.mock()`) works regardless of file organization.
