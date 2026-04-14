# Digests - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Digests |
| Phase | 3 |
| Date | 2026-03-07 |
| Derives From | `digests-test-specification.md` |

## Spec Discrepancy: Setting Key Name

The behavioral spec AC-1.3 uses `anthropic_model` but the correct key is `llm_model` (renamed during web-settings for LLM-agnostic naming). Tests use `llm_model`. The behavioral spec should be updated to match.

## Test Framework & Conventions

- **Framework:** Vitest (project standard)
- **Style:** `describe`/`it` blocks with explicit imports
- **Module mocking:** `vi.mock()` for query module, LLM provider, email module, embed, classify
- **DB testing:** testcontainers with `pgvector/pgvector:pg16` (existing `tests/helpers/test-db.ts`)
- **Env var testing:** `withEnv` from `tests/helpers/env.ts`
- **Fetch mocking:** `vi.spyOn(globalThis, 'fetch')` for Ollama in retry tests
- **Cron mocking:** `vi.mock("node-cron")` for scheduler tests

## Test Structure

### File Organization

```
tests/unit/digests.test.ts                    # 35 unit tests (mocked queries + LLM + email)
tests/integration/digests-integration.test.ts  # 7 integration tests (testcontainers)
```

**Unit tests** mock the query layer (`digests-queries.ts`), LLM provider (`llm/index.ts`), email module (`email.ts`), embedding (`embed.ts`), classification (`classify.ts`), and cron scheduler (`node-cron`). They test pipeline orchestration, error handling, email composition, retry logic, and scheduler behavior.

**Integration tests** use testcontainers with real PostgreSQL + pgvector to verify data assembly queries, digest caching, and retry entry selection.

### Test Grouping

```typescript
// Unit tests
describe("Digests", () => {
  describe("Daily Digest Pipeline (US-1)", () => { /* TS-1.2, TS-1.3, TS-1.5, TS-1.6, TS-1.7, TS-1.8, TS-1.9 */ });
  describe("Weekly Review Pipeline (US-2)", () => { /* TS-2.2, TS-2.3, TS-2.5, TS-2.5b, TS-2.6, TS-2.7 */ });
  describe("Email Delivery (US-3)", () => { /* TS-3.1, TS-3.2, TS-3.3, TS-3.4, TS-3.5, TS-3.6, TS-3.7, TS-3.8 */ });
  describe("Background Retry (US-4)", () => { /* TS-4.3, TS-4.5, TS-4.6, TS-4.7, TS-4.8, TS-4.9 */ });
  describe("Scheduling & Configuration (US-5)", () => { /* TS-5.1a, TS-5.1b, TS-5.2, TS-5.3, TS-5.4, TS-5.5, TS-5.6, TS-5.7 */ });
});

// Integration tests
describe("Digests Integration", () => {
  describe("Daily Data Assembly", () => { /* TS-1.1 */ });
  describe("Weekly Data Assembly", () => { /* TS-2.1 */ });
  describe("Digest Caching", () => { /* TS-1.4, TS-2.4 */ });
  describe("Background Retry Queries", () => { /* TS-4.1, TS-4.2, TS-4.4 */ });
});
```

### Naming Convention

```typescript
// Unit tests — Daily Pipeline
it("sends assembled data to Claude with daily prompt and configured model")  // TS-1.2
it("trims whitespace from Claude response")                                  // TS-1.3
it("pushes digest to SSE clients")                                           // TS-1.5
it("sends digest via email")                                                 // TS-1.6
it("runs prompt with zero items when database is empty")                     // TS-1.7
it("logs error and caches error message when Claude is down")                // TS-1.8
it("treats empty Claude response as failure")                                // TS-1.9

// Unit tests — Weekly Pipeline
it("sends assembled data to Claude with weekly prompt")                      // TS-2.2
it("trims whitespace from weekly review response")                           // TS-2.3
it("sends weekly review via email")                                          // TS-2.5
it("pushes weekly review to SSE clients")                                    // TS-2.5b
it("runs weekly prompt with zero entries")                                   // TS-2.6
it("handles Claude failure during weekly review same as daily")              // TS-2.7

// Unit tests — Email
it("defaults sender to SMTP_USER when DIGEST_EMAIL_FROM is not set")         // TS-3.1
it("formats daily email subject as Cortex Daily — YYYY-MM-DD")              // TS-3.2
it("formats weekly email subject as Cortex Weekly — w/c YYYY-MM-DD")        // TS-3.3
it("sends plain text body without HTML")                                     // TS-3.4
it("uses digest_email_to setting over DIGEST_EMAIL_TO env var")              // TS-3.5
it("logs SMTP failure but still caches digest and pushes SSE")               // TS-3.6
it("skips email without error when SMTP is not configured")                  // TS-3.7
it("skips email with warning when recipient is empty")                       // TS-3.8

// Unit tests — Background Retry
it("handles embedding success with classification failure independently")    // TS-4.3
it("logs failed entries and leaves them for next cycle")                     // TS-4.5
it("attempts both embedding and classification for entry with both null")    // TS-4.6
it("handles Ollama down for all embedding retries")                          // TS-4.7
it("handles Claude down for all classification retries")                     // TS-4.8
it("completes immediately with no API calls when nothing needs retry")       // TS-4.9

// Unit tests — Scheduling
it("uses settings value over env var for cron schedule")                     // TS-5.1a
it("uses env var when no settings value exists")                             // TS-5.1b
it("uses default schedules when neither settings nor env vars exist")        // TS-5.2
it("runs cron in configured timezone")                                       // TS-5.3
it("reschedules cron without restart when settings change")                  // TS-5.4
it("reschedules cron when timezone changes")                                 // TS-5.5
it("does not retroactively generate digest on late start")                   // TS-5.6
it("runs daily and weekly jobs independently when both fire")                // TS-5.7

// Integration tests
it("assembles correct daily data from database")                             // TS-1.1
it("caches latest daily digest, overwriting previous")                       // TS-1.4
it("assembles correct weekly data from database")                            // TS-2.1
it("caches weekly review separately from daily digest")                      // TS-2.4
it("finds and embeds entries with null embedding, excluding soft-deleted")   // TS-4.1
it("finds and reclassifies entries with null category")                      // TS-4.2
it("limits retry to 50 entries, oldest first")                               // TS-4.4
```

## Expected Module API

### New Dependencies

| Package | Purpose |
|---------|---------|
| `node-cron` | Cron job scheduling with timezone support |
| `nodemailer` | SMTP email sending |
| `@types/nodemailer` | TypeScript types for nodemailer |

### Database Schema Addition

A `digests` table for caching generated digests:

```sql
CREATE TABLE IF NOT EXISTS digests (
  type TEXT PRIMARY KEY,        -- 'daily' or 'weekly'
  content TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Only ever holds 2 rows (latest daily, latest weekly). Upsert pattern: `INSERT ... ON CONFLICT (type) DO UPDATE`.

### Digest Queries (`src/digests-queries.ts`)

```typescript
import type { Sql } from "postgres";

export interface DailyDigestData {
  activeProjects: Array<{ id: string; name: string; fields: Record<string, unknown> }>;
  pendingFollowUps: Array<{ id: string; name: string; fields: Record<string, unknown> }>;
  upcomingTasks: Array<{ id: string; name: string; fields: Record<string, unknown> }>;
  yesterdayEntries: Array<{ id: string; name: string; category: string; content: string | null; created_at: Date }>;
}

export interface WeeklyReviewData {
  weekEntries: Array<{ id: string; name: string; category: string; content: string | null; created_at: Date }>;
  dailyCounts: Array<{ date: string; count: number }>;
  categoryCounts: Array<{ category: string; count: number }>;
  stalledProjects: Array<{ id: string; name: string; fields: Record<string, unknown>; updated_at: Date }>;
}

export interface CachedDigest {
  content: string;
  generated_at: Date;
}

export interface RetryEntry {
  id: string;
  name: string;
  content: string | null;
  embedding: number[] | null;
  category: string | null;
}

// Daily: active projects with next_action, people with follow_ups,
// tasks pending + due within 7 days, yesterday's entries. Excludes soft-deleted.
export async function getDailyDigestData(sql: Sql): Promise<DailyDigestData>;

// Weekly: all entries from past 7 days, daily/category counts,
// stalled projects (active, updated > 5 days ago). Excludes soft-deleted.
export async function getWeeklyReviewData(sql: Sql): Promise<WeeklyReviewData>;

// Upsert digest content by type ('daily' or 'weekly').
export async function cacheDigest(sql: Sql, type: "daily" | "weekly", content: string): Promise<void>;

// Read latest cached digest by type. Returns null if none cached.
export async function getLatestDigest(sql: Sql, type: "daily" | "weekly"): Promise<CachedDigest | null>;

// Find entries needing embedding OR classification, excluding soft-deleted,
// ordered by created_at ASC, limited to `limit` entries.
export async function getEntriesNeedingRetry(sql: Sql, limit: number): Promise<RetryEntry[]>;
```

### Digest Pipeline (`src/digests.ts`)

```typescript
import type { Sql } from "postgres";
import type { SSEBroadcaster } from "./web/sse.js";

// Assemble daily data, call LLM with daily prompt, cache result,
// push SSE, send email. Handles errors gracefully.
export async function generateDailyDigest(sql: Sql, broadcaster?: SSEBroadcaster): Promise<void>;

// Assemble weekly data, call LLM with weekly prompt, cache result,
// push SSE, send email. Handles errors gracefully.
export async function generateWeeklyReview(sql: Sql, broadcaster?: SSEBroadcaster): Promise<void>;

// Find entries needing embedding/classification (max 50, oldest first),
// attempt each independently, log failures.
export async function runBackgroundRetry(sql: Sql): Promise<void>;

// Start node-cron jobs for daily digest, weekly review, and background retry.
// Returns stop() to cancel all jobs and reschedule() to reload settings.
export async function startScheduler(
  sql: Sql,
  broadcaster: SSEBroadcaster,
): Promise<{ stop: () => void; reschedule: () => Promise<void> }>;
```

Pipeline functions resolve configuration internally:
- LLM model: `resolveConfigValue("llm_model", sql)` falling back to `config.llmModel`
- Timezone: `resolveConfigValue("timezone", sql)` falling back to `config.timezone`
- Email recipient: `resolveConfigValue("digest_email_to", sql)` falling back to `DIGEST_EMAIL_TO` env var
- Cron schedules: `resolveConfigValue("daily_digest_cron", sql)` / `resolveConfigValue("weekly_digest_cron", sql)`

### Email Module (`src/email.ts`)

```typescript
// Send an email via SMTP. Throws on failure.
export async function sendDigestEmail(options: {
  subject: string;
  body: string;
  to: string;
  from: string;
  smtp: { host: string; port: number; user: string; pass: string };
}): Promise<void>;

// Check if SMTP env vars are configured (SMTP_HOST is set and non-empty).
export function isSmtpConfigured(): boolean;
```

### Prompt Templates

| File | Sections | Word Limit |
|------|----------|------------|
| `prompts/daily-digest.md` | TOP 3 TODAY, STUCK ON, SMALL WIN | 150 |
| `prompts/weekly-review.md` | WHAT HAPPENED, OPEN LOOPS, NEXT WEEK, RECURRING THEME | 250 |

Templates use `{placeholder}` substitution (same pattern as `prompts/classify.md`). The pipeline function reads the template via `fs.readFileSync`, substitutes data placeholders, and passes the result to `provider.chat()`.

## Test Scenario Mapping

| Test Scenario ID | Scenario Title | Test File | Test Function |
|------------------|----------------|-----------|---------------|
| TS-1.1 | Daily data assembly | integration | `it("assembles correct daily data from database")` |
| TS-1.2 | Daily prompt + model | unit | `it("sends assembled data to Claude with daily prompt and configured model")` |
| TS-1.3 | Response trimming | unit | `it("trims whitespace from Claude response")` |
| TS-1.4 | Cache overwrite | integration | `it("caches latest daily digest, overwriting previous")` |
| TS-1.5 | SSE push | unit | `it("pushes digest to SSE clients")` |
| TS-1.6 | Email sending | unit | `it("sends digest via email")` |
| TS-1.7 | Empty DB | unit | `it("runs prompt with zero items when database is empty")` |
| TS-1.8 | Claude down | unit | `it("logs error and caches error message when Claude is down")` |
| TS-1.9 | Empty response | unit | `it("treats empty Claude response as failure")` |
| TS-2.1 | Weekly data assembly | integration | `it("assembles correct weekly data from database")` |
| TS-2.2 | Weekly prompt | unit | `it("sends assembled data to Claude with weekly prompt")` |
| TS-2.3 | Response trimming | unit | `it("trims whitespace from weekly review response")` |
| TS-2.4 | Separate cache | integration | `it("caches weekly review separately from daily digest")` |
| TS-2.5 | Weekly email | unit | `it("sends weekly review via email")` |
| TS-2.5b | Weekly SSE push | unit | `it("pushes weekly review to SSE clients")` |
| TS-2.6 | Zero entries week | unit | `it("runs weekly prompt with zero entries")` |
| TS-2.7 | Claude down weekly | unit | `it("handles Claude failure during weekly review same as daily")` |
| TS-3.1 | Sender defaults | unit | `it("defaults sender to SMTP_USER when DIGEST_EMAIL_FROM is not set")` |
| TS-3.2 | Daily subject | unit | `it("formats daily email subject as Cortex Daily — YYYY-MM-DD")` |
| TS-3.3 | Weekly subject | unit | `it("formats weekly email subject as Cortex Weekly — w/c YYYY-MM-DD")` |
| TS-3.4 | Plain text body | unit | `it("sends plain text body without HTML")` |
| TS-3.5 | Recipient override | unit | `it("uses digest_email_to setting over DIGEST_EMAIL_TO env var")` |
| TS-3.6 | SMTP failure | unit | `it("logs SMTP failure but still caches digest and pushes SSE")` |
| TS-3.7 | SMTP not configured | unit | `it("skips email without error when SMTP is not configured")` |
| TS-3.8 | Recipient empty | unit | `it("skips email with warning when recipient is empty")` |
| TS-4.1 | Embed null entries | integration | `it("finds and embeds entries with null embedding, excluding soft-deleted")` |
| TS-4.2 | Classify null entries | integration | `it("finds and reclassifies entries with null category")` |
| TS-4.3 | Independent success/fail | unit | `it("handles embedding success with classification failure independently")` |
| TS-4.4 | Max 50 oldest first | integration | `it("limits retry to 50 entries, oldest first")` |
| TS-4.5 | Failed entries logged | unit | `it("logs failed entries and leaves them for next cycle")` |
| TS-4.6 | Both null attempted | unit | `it("attempts both embedding and classification for entry with both null")` |
| TS-4.7 | Ollama down | unit | `it("handles Ollama down for all embedding retries")` |
| TS-4.8 | Claude down retry | unit | `it("handles Claude down for all classification retries")` |
| TS-4.9 | Nothing to retry | unit | `it("completes immediately with no API calls when nothing needs retry")` |
| TS-5.1a | Settings precedence | unit | `it("uses settings value over env var for cron schedule")` |
| TS-5.1b | Env var fallback | unit | `it("uses env var when no settings value exists")` |
| TS-5.2 | Default schedules | unit | `it("uses default schedules when neither settings nor env vars exist")` |
| TS-5.3 | Timezone cron | unit | `it("runs cron in configured timezone")` |
| TS-5.4 | Reschedule | unit | `it("reschedules cron without restart when settings change")` |
| TS-5.5 | Timezone reschedule | unit | `it("reschedules cron when timezone changes")` |
| TS-5.6 | No retroactive | unit | `it("does not retroactively generate digest on late start")` |
| TS-5.7 | Simultaneous jobs | unit | `it("runs daily and weekly jobs independently when both fire")` |

## Detailed Scenario Implementation

### Group 1: Daily Digest Pipeline (US-1)

#### TS-1.1: Assembles correct daily data from database (integration)

- **Setup (Given):** Start testcontainers PostgreSQL. Seed entries:
  - Active project with `next_action`: `category='projects'`, `fields={status:'active', next_action:'Ship v2'}`, `deleted_at=NULL`
  - Active project without `next_action`: `category='projects'`, `fields={status:'active', next_action:null}` (excluded from `activeProjects`)
  - Archived project: `category='projects'`, `fields={status:'archived', next_action:'Do thing'}` (excluded)
  - Person with follow-ups: `category='people'`, `fields={follow_ups:'Call back Monday'}`
  - Person without follow-ups: `category='people'`, `fields={follow_ups:null}` (excluded from `pendingFollowUps`)
  - Task due in 3 days: `category='tasks'`, `fields={status:'pending', due_date:'<3 days from now>'}` (included)
  - Task due in 10 days: `category='tasks'`, `fields={status:'pending', due_date:'<10 days from now>'}` (excluded — outside 7-day window)
  - Task completed: `category='tasks'`, `fields={status:'completed', due_date:'<3 days from now>'}` (excluded — not pending)
  - Entry captured yesterday: any category, `created_at` set to yesterday
  - Entry captured 2 days ago: any category (excluded from yesterday's entries)
  - Soft-deleted entry from yesterday: `deleted_at` set (excluded from all results)
- **Action (When):** Call `getDailyDigestData(sql)`.
- **Assertion (Then):**
  - `activeProjects` has 1 entry (the project with next_action)
  - `pendingFollowUps` has 1 entry (the person with follow_ups)
  - `upcomingTasks` has 1 entry (the task due in 3 days)
  - `yesterdayEntries` has 1 entry (yesterday's non-deleted entry)
  - No soft-deleted entries in any result set

#### TS-1.2: Sends assembled data to Claude with daily prompt and configured model (unit)

- **Setup (Given):** Mock `getDailyDigestData` to return sample data (1 project, 1 person, 1 task, 1 yesterday entry). Mock `createLLMProvider` to return mock provider whose `chat` resolves to `"TOP 3 TODAY\n..."`. Mock `resolveConfigValue` for `llm_model` to return `"claude-haiku-4-5-20251001"`. Mock `cacheDigest`, `sendDigestEmail`, `isSmtpConfigured`. Create mock broadcaster.
- **Action (When):** Call `generateDailyDigest(mockSql, mockBroadcaster)`.
- **Assertion (Then):**
  - `createLLMProvider` called with `model: "claude-haiku-4-5-20251001"`
  - `provider.chat` called once with a prompt string that:
    - Contains "TOP 3 TODAY", "STUCK ON", "SMALL WIN" (section names)
    - Contains "150" (word limit)
    - Contains the project/person/task data from the assembled payload

#### TS-1.3: Trims whitespace from Claude response (unit)

- **Setup (Given):** Mock `getDailyDigestData` to return empty data. Mock LLM provider `chat` to return `"  \n  TOP 3 TODAY\nContent here  \n  "`. Mock `cacheDigest`.
- **Action (When):** Call `generateDailyDigest(mockSql)`.
- **Assertion (Then):** `cacheDigest` called with `type: "daily"` and `content` equal to `"TOP 3 TODAY\nContent here"` (trimmed).

#### TS-1.5: Pushes digest to connected SSE clients (unit)

- **Setup (Given):** Mock pipeline to succeed (LLM returns valid response). Create mock broadcaster with `broadcast` spy.
- **Action (When):** Call `generateDailyDigest(mockSql, mockBroadcaster)`.
- **Assertion (Then):** `mockBroadcaster.broadcast` called with `{ type: "digest:updated", data: { digestType: "daily", content: <trimmed response> } }` (or equivalent).

#### TS-1.6: Sends digest via email (unit)

- **Setup (Given):** Mock pipeline to succeed. Mock `isSmtpConfigured` to return `true`. Mock `resolveConfigValue` for `digest_email_to` to return `"user@example.com"`. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `DIGEST_EMAIL_FROM` env vars via `withEnv`. Mock `sendDigestEmail`.
- **Action (When):** Call `generateDailyDigest(mockSql)`.
- **Assertion (Then):** `sendDigestEmail` called once with subject matching daily format, body matching trimmed response, `to: "user@example.com"`, and `from` matching `DIGEST_EMAIL_FROM`.

#### TS-1.7: Empty database — prompt still runs with zero items (unit)

- **Setup (Given):** Mock `getDailyDigestData` to return `{ activeProjects: [], pendingFollowUps: [], upcomingTasks: [], yesterdayEntries: [] }`. Mock LLM provider.
- **Action (When):** Call `generateDailyDigest(mockSql)`.
- **Assertion (Then):** `provider.chat` called once (prompt runs). `cacheDigest` called with the response. Pipeline does not short-circuit.

#### TS-1.8: Claude API down — error logged, error message cached, no email (unit)

- **Setup (Given):** Mock `getDailyDigestData` to return sample data. Mock LLM provider `chat` to reject with `new Error("Connection refused")`. Mock `cacheDigest`. Spy on `console.error` (or structured logger). Mock `sendDigestEmail`.
- **Action (When):** Call `generateDailyDigest(mockSql, mockBroadcaster)`.
- **Assertion (Then):**
  - Error is logged (console.error or logger called with message containing "digest" and error details)
  - `cacheDigest` called with `type: "daily"` and content containing error message (e.g., "Digest generation failed")
  - `sendDigestEmail` NOT called
  - Function does not throw (error is handled gracefully)

#### TS-1.9: Claude returns empty response — treated as failure (unit)

- **Setup (Given):** Mock LLM provider `chat` to return `""` (empty string). Mock `cacheDigest`.
- **Action (When):** Call `generateDailyDigest(mockSql)`.
- **Assertion (Then):** Same behavior as TS-1.8: error logged, error message cached, no email sent.

---

### Group 2: Weekly Review Pipeline (US-2)

#### TS-2.1: Assembles correct weekly data from database (integration)

- **Setup (Given):** Seed entries:
  - 3 entries created today (various categories)
  - 2 entries created 5 days ago
  - 1 entry created 8 days ago (excluded — outside 7-day window)
  - 1 stalled project: `category='projects'`, `fields={status:'active'}`, `updated_at` set to 6 days ago
  - 1 active project updated today (not stalled — updated < 5 days ago)
  - 1 soft-deleted entry from today (excluded)
- **Action (When):** Call `getWeeklyReviewData(sql)`.
- **Assertion (Then):**
  - `weekEntries` has 5 entries (3 today + 2 from 5 days ago, no 8-day-old or deleted)
  - `dailyCounts` has entries for days with activity (today: 3, 5 days ago: 2)
  - `categoryCounts` reflects category distribution of the 5 entries
  - `stalledProjects` has 1 entry (the project updated 6 days ago)

#### TS-2.2: Sends assembled data to Claude with weekly prompt (unit)

- **Setup (Given):** Mock `getWeeklyReviewData` to return sample data. Mock LLM provider. Mock `cacheDigest`.
- **Action (When):** Call `generateWeeklyReview(mockSql)`.
- **Assertion (Then):**
  - `provider.chat` called with prompt containing "WHAT HAPPENED", "OPEN LOOPS", "NEXT WEEK", "RECURRING THEME"
  - Prompt contains "250" (word limit)
  - Prompt includes the weekly data payload

#### TS-2.3: Uses Claude's response as-is with whitespace trimmed (unit)

- **Setup (Given):** Mock LLM provider to return `"  WHAT HAPPENED\nBusy week  "`. Mock `cacheDigest`.
- **Action (When):** Call `generateWeeklyReview(mockSql)`.
- **Assertion (Then):** `cacheDigest` called with `type: "weekly"`, content `"WHAT HAPPENED\nBusy week"`.

#### TS-2.5: Sends weekly review via email (unit)

- **Setup (Given):** Mock pipeline to succeed. Mock `isSmtpConfigured` → `true`. Mock email config resolution. Mock `sendDigestEmail`.
- **Action (When):** Call `generateWeeklyReview(mockSql)`.
- **Assertion (Then):** `sendDigestEmail` called with subject matching weekly format (`"Cortex Weekly — w/c ..."`) and body matching trimmed response.

#### TS-2.5b: Pushes weekly review to SSE clients (unit)

- **Setup (Given):** Mock pipeline to succeed. Create mock broadcaster.
- **Action (When):** Call `generateWeeklyReview(mockSql, mockBroadcaster)`.
- **Assertion (Then):** `mockBroadcaster.broadcast` called with `{ type: "digest:updated", data: { digestType: "weekly", ... } }`.

#### TS-2.6: Zero entries in past week — prompt runs with empty data (unit)

- **Setup (Given):** Mock `getWeeklyReviewData` to return `{ weekEntries: [], dailyCounts: [], categoryCounts: [], stalledProjects: [] }`. Mock LLM provider.
- **Action (When):** Call `generateWeeklyReview(mockSql)`.
- **Assertion (Then):** `provider.chat` called once. `cacheDigest` called. Pipeline does not short-circuit.

#### TS-2.7: Claude API down during weekly review (unit)

- **Setup (Given):** Mock `getWeeklyReviewData` to return data. Mock LLM provider to reject with error. Mock `cacheDigest`.
- **Action (When):** Call `generateWeeklyReview(mockSql)`.
- **Assertion (Then):** Same as TS-1.8: error logged, error message cached as weekly type, no email, no throw.

---

### Group 3: Email Delivery (US-3)

Email tests verify the `sendDigestEmail` function and the pipeline's email integration. Tests mock `nodemailer` at the module level:

```typescript
vi.mock("nodemailer", () => ({
  createTransport: vi.fn().mockReturnValue({
    sendMail: vi.fn().mockResolvedValue({ messageId: "test-id" }),
  }),
}));
```

#### TS-3.1: Defaults sender to SMTP_USER when DIGEST_EMAIL_FROM is not set (unit)

- **Setup (Given):** Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER=smtp-user@example.com`, `SMTP_PASS` via `withEnv`. Do NOT set `DIGEST_EMAIL_FROM`. Mock nodemailer.
- **Action (When):** Call `sendDigestEmail({ subject: "Test", body: "Content", to: "user@example.com", from: "smtp-user@example.com", smtp: { host, port, user, pass } })`.
- **Assertion (Then):** `transport.sendMail` called with `from: "smtp-user@example.com"`.

Note: The `from` field defaults to `SMTP_USER` — this default resolution happens in the pipeline function, not in `sendDigestEmail` itself. The pipeline test (TS-1.6) verifies the resolution; this test verifies `sendDigestEmail` passes `from` through correctly.

#### TS-3.2: Daily email subject format (unit)

- **Setup (Given):** Mock pipeline with successful LLM response. Mock `isSmtpConfigured` → `true`. Mock email config. Mock `sendDigestEmail`.
- **Action (When):** Call `generateDailyDigest(mockSql)`.
- **Assertion (Then):** `sendDigestEmail` called with `subject` matching `"Cortex Daily — YYYY-MM-DD"` where the date is today.

#### TS-3.3: Weekly email subject format (unit)

- **Setup (Given):** Same as TS-3.2 but for weekly.
- **Action (When):** Call `generateWeeklyReview(mockSql)`.
- **Assertion (Then):** `sendDigestEmail` called with `subject` matching `"Cortex Weekly — w/c YYYY-MM-DD"` where the date is the Monday of the current week.

#### TS-3.4: Email body is plain text content (unit)

- **Setup (Given):** Mock LLM to return `"TOP 3 TODAY\n1. Ship feature\n2. Review PR\n3. Update docs"`. Mock `sendDigestEmail`.
- **Action (When):** Call `generateDailyDigest(mockSql)`.
- **Assertion (Then):** `sendDigestEmail` called with `body` equal to the trimmed Claude response. No HTML tags in body.

#### TS-3.5: Recipient from settings overrides env var (unit)

- **Setup (Given):** Set `DIGEST_EMAIL_TO=env@example.com` via `withEnv`. Mock `resolveConfigValue("digest_email_to", sql)` to return `"settings@example.com"`. Mock `sendDigestEmail`. Mock `isSmtpConfigured` → `true`.
- **Action (When):** Call `generateDailyDigest(mockSql)`.
- **Assertion (Then):** `sendDigestEmail` called with `to: "settings@example.com"` (not `env@example.com`).

#### TS-3.6: SMTP failure — error logged, digest still delivered (unit)

- **Setup (Given):** Mock LLM to return valid response. Mock `isSmtpConfigured` → `true`. Mock `sendDigestEmail` to reject with `new Error("SMTP connection timeout")`. Mock `cacheDigest`. Create mock broadcaster. Spy on logging.
- **Action (When):** Call `generateDailyDigest(mockSql, mockBroadcaster)`.
- **Assertion (Then):**
  - Error logged with module info (e.g., "email")
  - `cacheDigest` still called with the valid digest content (not error message)
  - `mockBroadcaster.broadcast` still called
  - Function does not throw

#### TS-3.7: SMTP not configured — email skipped, no error logged (unit)

- **Setup (Given):** Mock `isSmtpConfigured` to return `false`. Ensure `SMTP_HOST` is not set. Mock LLM to return valid response. Spy on logging.
- **Action (When):** Call `generateDailyDigest(mockSql)`.
- **Assertion (Then):**
  - `sendDigestEmail` NOT called
  - No error logged (only debug/info at most)
  - Digest still cached and SSE pushed

#### TS-3.8: Recipient empty — email skipped, warning logged (unit)

- **Setup (Given):** Mock `isSmtpConfigured` → `true`. Mock `resolveConfigValue("digest_email_to", sql)` to return `undefined` or `""`. No `DIGEST_EMAIL_TO` env var. Mock LLM to return valid response. Spy on logging.
- **Action (When):** Call `generateDailyDigest(mockSql)`.
- **Assertion (Then):**
  - `sendDigestEmail` NOT called
  - Warning logged (message about missing recipient)
  - Digest still cached and SSE pushed

---

### Group 4: Background Retry (US-4)

#### TS-4.1: Finds and embeds entries with null embedding, excluding soft-deleted (integration)

Note: The test spec describes the full retry pipeline flow ("embeddings are generated using Ollama"). This integration test validates the **query layer only** — that `getEntriesNeedingRetry` correctly identifies entries needing embedding and excludes soft-deleted entries. The actual embedding execution is covered by unit tests TS-4.3, TS-4.6, and TS-4.7, which verify that `runBackgroundRetry` calls `embedEntry` for entries with null embedding.

- **Setup (Given):** Seed entries:
  - Entry A: `embedding IS NULL`, `deleted_at IS NULL` (active, needs embedding)
  - Entry B: `embedding IS NULL`, `deleted_at IS NULL` (active, needs embedding)
  - Entry C: `embedding IS NULL`, `deleted_at = now()` (soft-deleted, excluded)
  - Entry D: valid embedding, `deleted_at IS NULL` (doesn't need embedding)
- **Action (When):** Call `getEntriesNeedingRetry(sql, 50)`.
- **Assertion (Then):**
  - Returns entries A and B (not C or D)
  - Both have `embedding: null`
  - Entry C (soft-deleted) is excluded

#### TS-4.2: Finds and reclassifies entries with null category (integration)

Note: Same scoping as TS-4.1 — this integration test validates the query layer. The classification pipeline invocation is verified by unit tests TS-4.3, TS-4.6, and TS-4.8.

- **Setup (Given):** Seed entries:
  - Entry A: `category IS NULL`, `deleted_at IS NULL`, with valid embedding
  - Entry B: `category IS NULL`, `deleted_at IS NULL`, `embedding IS NULL` (needs both)
  - Entry C: `category = 'projects'`, `deleted_at IS NULL` (doesn't need classification)
- **Action (When):** Call `getEntriesNeedingRetry(sql, 50)`.
- **Assertion (Then):**
  - Returns entries A and B (both have null category)
  - Entry A has `embedding` populated, entry B has `embedding: null`
  - Entry C is not returned

#### TS-4.3: Embedding and classification succeed/fail independently (unit)

- **Setup (Given):** Mock `getEntriesNeedingRetry` to return one entry with `embedding: null, category: null`. Mock `embedEntry` to resolve (success). Mock `classifyEntry` to reject (failure). Spy on logging.
- **Action (When):** Call `runBackgroundRetry(mockSql)`.
- **Assertion (Then):**
  - `embedEntry` called with the entry's ID
  - `classifyEntry` called with the entry's ID
  - Classification failure is logged
  - Function does not throw (embedding success preserved despite classification failure)

#### TS-4.4: Maximum 50 entries per cycle, oldest first (integration)

- **Setup (Given):** Seed 60 entries with `embedding IS NULL`, `deleted_at IS NULL`, with staggered `created_at` values (entry 1 oldest, entry 60 newest).
- **Action (When):** Call `getEntriesNeedingRetry(sql, 50)`.
- **Assertion (Then):**
  - Returns exactly 50 entries
  - First entry is the oldest (entry 1)
  - Last entry is the 50th oldest (entry 50)
  - Entries 51-60 are not returned

#### TS-4.5: Failed entries logged, left for next cycle (unit)

- **Setup (Given):** Mock `getEntriesNeedingRetry` to return 2 entries needing embedding. Mock `embedEntry` to reject with `new Error("Ollama timeout")` for both. Spy on logging.
- **Action (When):** Call `runBackgroundRetry(mockSql)`.
- **Assertion (Then):**
  - Errors logged for both entries (structured JSON with entry details)
  - Function does not throw
  - No entries "marked as permanently failed" (they'll be returned by next query)

#### TS-4.6: Entry with both null embedding and null category — both attempted (unit)

- **Setup (Given):** Mock `getEntriesNeedingRetry` to return one entry with `embedding: null, category: null`. Mock `embedEntry` to resolve. Mock `classifyEntry` to resolve.
- **Action (When):** Call `runBackgroundRetry(mockSql)`.
- **Assertion (Then):**
  - `embedEntry` called with entry ID
  - `classifyEntry` called with entry ID
  - Both succeed independently

#### TS-4.7: Ollama down — all embedding retries fail (unit)

- **Setup (Given):** Mock `getEntriesNeedingRetry` to return 3 entries with `embedding: null, category: 'ideas'` (need embedding only). Mock `embedEntry` to reject with `new Error("ECONNREFUSED")` for all calls.
- **Action (When):** Call `runBackgroundRetry(mockSql)`.
- **Assertion (Then):**
  - `embedEntry` called 3 times
  - 3 errors logged
  - Function does not throw (retry job doesn't crash)

#### TS-4.8: Claude down — all classification retries fail (unit)

- **Setup (Given):** Mock `getEntriesNeedingRetry` to return 3 entries with `embedding: [...], category: null` (need classification only). Mock `classifyEntry` to reject with `new Error("Claude API error")` for all calls.
- **Action (When):** Call `runBackgroundRetry(mockSql)`.
- **Assertion (Then):**
  - `classifyEntry` called 3 times
  - 3 errors logged
  - Function does not throw

#### TS-4.9: No entries need retry — job completes with no API calls (unit)

- **Setup (Given):** Mock `getEntriesNeedingRetry` to return `[]` (empty array). Mock `embedEntry` and `classifyEntry`.
- **Action (When):** Call `runBackgroundRetry(mockSql)`.
- **Assertion (Then):**
  - `embedEntry` NOT called
  - `classifyEntry` NOT called
  - Function completes without error

---

### Group 5: Scheduling & Configuration (US-5)

Scheduler tests mock `node-cron` and `resolveConfigValue`:

```typescript
const mockJob = { stop: vi.fn() };

vi.mock("node-cron", () => ({
  schedule: vi.fn().mockReturnValue(mockJob),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    dailyDigestCron: "30 7 * * *",
    weeklyDigestCron: "0 16 * * 0",
    timezone: "Europe/Berlin",
  },
  resolveConfigValue: vi.fn(),
}));
```

#### TS-5.1a: Settings value takes precedence over env var (unit)

- **Setup (Given):** Mock `resolveConfigValue("daily_digest_cron", sql)` to return `"0 8 * * *"`. Set `DAILY_DIGEST_CRON=0 9 * * *` via `withEnv`.
- **Action (When):** Call `startScheduler(mockSql, mockBroadcaster)`.
- **Assertion (Then):** `cron.schedule` called with `"0 8 * * *"` as the daily cron expression (settings value, not env var).

#### TS-5.1b: Env var used when no settings value exists (unit)

- **Setup (Given):** Mock `resolveConfigValue("daily_digest_cron", sql)` to return `"0 9 * * *"` (no DB setting, but `resolveConfigValue` finds the `DAILY_DIGEST_CRON` env var via `SETTINGS_TO_ENV` mapping and returns it).
- **Action (When):** Call `startScheduler(mockSql, mockBroadcaster)`.
- **Assertion (Then):** `cron.schedule` called with `"0 9 * * *"`.

Note: `resolveConfigValue` already handles the DB > env var cascade internally. When no DB setting exists, it checks `SETTINGS_TO_ENV` for the mapped env var (`DAILY_DIGEST_CRON`) and returns that value. The scheduler calls `resolveConfigValue` and only falls back to `config.dailyDigestCron` (the hardcoded default) if `resolveConfigValue` returns `undefined` (meaning both DB and env var are empty). For this test, we mock `resolveConfigValue` to return the env var value directly, which is what the real function would do when the env var is set but no DB setting exists.

#### TS-5.2: Default schedules when neither settings nor env vars exist (unit)

- **Setup (Given):** Mock `resolveConfigValue` to return `undefined` for all keys. Use default `config` values (`dailyDigestCron: "30 7 * * *"`, `weeklyDigestCron: "0 16 * * 0"`).
- **Action (When):** Call `startScheduler(mockSql, mockBroadcaster)`.
- **Assertion (Then):**
  - `cron.schedule` called with `"30 7 * * *"` for daily
  - `cron.schedule` called with `"0 16 * * 0"` for weekly
  - `cron.schedule` called with `"*/15 * * * *"` for background retry

#### TS-5.3: Cron runs in configured timezone (unit)

- **Setup (Given):** Mock `resolveConfigValue("timezone", sql)` to return `"America/New_York"`.
- **Action (When):** Call `startScheduler(mockSql, mockBroadcaster)`.
- **Assertion (Then):** `cron.schedule` called with options including `{ timezone: "America/New_York" }` for both daily and weekly jobs.

#### TS-5.4: Schedule change via settings reschedules without restart (unit)

- **Setup (Given):** Mock `resolveConfigValue` to return `"30 7 * * *"` initially. Call `startScheduler` to get `{ reschedule }`. Then update `resolveConfigValue` to return `"0 8 * * *"`.
- **Action (When):** Call `reschedule()`.
- **Assertion (Then):**
  - Old jobs' `stop()` called (at least the daily job's stop)
  - `cron.schedule` called again with the new expression `"0 8 * * *"`

#### TS-5.5: Timezone change reschedules cron (unit)

- **Setup (Given):** Start scheduler with timezone `"Europe/Berlin"`. Update `resolveConfigValue("timezone", sql)` to return `"America/New_York"`.
- **Action (When):** Call `reschedule()`.
- **Assertion (Then):** New `cron.schedule` calls use `{ timezone: "America/New_York" }`.

#### TS-5.6: App starts after digest time — no retroactive generation (unit)

- **Setup (Given):** Mock `resolveConfigValue` to return default schedule. Mock `generateDailyDigest` and `generateWeeklyReview`.
- **Action (When):** Call `startScheduler(mockSql, mockBroadcaster)`.
- **Assertion (Then):**
  - `generateDailyDigest` NOT called during startup
  - `generateWeeklyReview` NOT called during startup
  - Only `cron.schedule` called (jobs registered but not immediately triggered)

Note: `node-cron` does not retroactively fire by default. This test verifies the scheduler doesn't manually trigger a digest on startup.

#### TS-5.7: Two jobs fire at the same time — run independently (unit)

- **Setup (Given):** Mock `cron.schedule` to capture callbacks for daily and weekly jobs. Mock `generateDailyDigest` and `generateWeeklyReview` (as imported module mocks).
- **Action (When):** Invoke both captured callbacks simultaneously (call both without awaiting the first).
- **Assertion (Then):**
  - `generateDailyDigest` called once
  - `generateWeeklyReview` called once
  - Both execute independently (no mutex, no blocking)

---

### Integration-Only: Digest Caching

#### TS-1.4: Caches latest daily digest, overwriting previous (integration)

- **Setup (Given):** Call `cacheDigest(sql, "daily", "First digest")`. Wait briefly. Call `cacheDigest(sql, "daily", "Second digest")`.
- **Action (When):** Call `getLatestDigest(sql, "daily")`.
- **Assertion (Then):**
  - Returns `{ content: "Second digest", generated_at: <recent timestamp> }`
  - Only one row exists in `digests` table with `type = 'daily'`

#### TS-2.4: Caches weekly review separately from daily digest (integration)

- **Setup (Given):** Call `cacheDigest(sql, "daily", "Daily content")`. Call `cacheDigest(sql, "weekly", "Weekly content")`.
- **Action (When):** Call `getLatestDigest(sql, "daily")` and `getLatestDigest(sql, "weekly")`.
- **Assertion (Then):**
  - Daily returns `{ content: "Daily content", ... }`
  - Weekly returns `{ content: "Weekly content", ... }`
  - Both coexist (2 rows in digests table)

## Fixtures & Test Data

### Constants

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
```

### Mock SQL

Unit tests use a mock `sql` object (never called directly — all queries go through mocked query functions):

```typescript
const mockSql = {} as any;
```

### Mock Broadcaster

```typescript
function createMockBroadcaster(): SSEBroadcaster {
  return {
    subscribe: vi.fn().mockReturnValue(() => {}),
    broadcast: vi.fn(),
  };
}
```

### Entry Seeding Helper (integration)

```typescript
async function seedEntry(sql: Sql, overrides: Partial<{
  id: string;
  name: string;
  content: string | null;
  category: string | null;
  fields: Record<string, unknown>;
  embedding: number[] | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  const fields = overrides.fields ?? {};
  const embeddingLiteral = overrides.embedding
    ? `[${overrides.embedding.join(",")}]`
    : null;
  await sql`
    INSERT INTO entries (id, name, content, category, fields, embedding, deleted_at, created_at, updated_at)
    VALUES (
      ${id},
      ${overrides.name ?? "Test Entry"},
      ${overrides.content ?? null},
      ${overrides.category ?? null},
      ${sql.json(fields)},
      ${embeddingLiteral}::vector(4096),
      ${overrides.deleted_at ?? null},
      ${overrides.created_at ?? new Date()},
      ${overrides.updated_at ?? overrides.created_at ?? new Date()}
    )
  `;
  return id;
}
```

Note: Uses `sql.json(fields)` for JSONB columns (avoids the double-stringify bug documented in MCP server implementation).

### Date Helpers (integration)

```typescript
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function yesterday(): Date {
  return daysAgo(1);
}
```

### Mocking Strategy

**Unit tests mock five layers:**

1. **Digest queries** — via `vi.mock()` on `digests-queries`:
   ```typescript
   vi.mock("../../src/digests-queries.js", () => ({
     getDailyDigestData: vi.fn().mockResolvedValue({
       activeProjects: [], pendingFollowUps: [],
       upcomingTasks: [], yesterdayEntries: [],
     }),
     getWeeklyReviewData: vi.fn().mockResolvedValue({
       weekEntries: [], dailyCounts: [],
       categoryCounts: [], stalledProjects: [],
     }),
     cacheDigest: vi.fn().mockResolvedValue(undefined),
     getLatestDigest: vi.fn().mockResolvedValue(null),
     getEntriesNeedingRetry: vi.fn().mockResolvedValue([]),
   }));
   ```

2. **LLM provider** — via `vi.mock()` on `llm/index`:
   ```typescript
   const mockChat = vi.fn().mockResolvedValue("  Mock digest response  ");
   vi.mock("../../src/llm/index.js", () => ({
     createLLMProvider: vi.fn().mockReturnValue({ chat: mockChat }),
   }));
   ```

3. **Email** — via `vi.mock()` on `email`:
   ```typescript
   vi.mock("../../src/email.js", () => ({
     sendDigestEmail: vi.fn().mockResolvedValue(undefined),
     isSmtpConfigured: vi.fn().mockReturnValue(false),
   }));
   ```

4. **Config resolution** — via `vi.mock()` on `config`:
   ```typescript
   vi.mock("../../src/config.js", () => ({
     config: {
       llmModel: "claude-sonnet-4-20250514",
       llmProvider: "anthropic",
       llmApiKey: "test-key",
       timezone: "Europe/Berlin",
       dailyDigestCron: "30 7 * * *",
       weeklyDigestCron: "0 16 * * 0",
     },
     resolveConfigValue: vi.fn().mockResolvedValue(undefined),
   }));
   ```

5. **Embed/classify** (for retry tests) — via `vi.mock()`:
   ```typescript
   vi.mock("../../src/embed.js", () => ({
     embedEntry: vi.fn().mockResolvedValue(undefined),
   }));
   vi.mock("../../src/classify.js", () => ({
     classifyEntry: vi.fn().mockResolvedValue(undefined),
   }));
   ```

**Integration tests mock only external services** (Ollama fetch, LLM API) — all DB queries hit real PostgreSQL via testcontainers.

### Setup / Teardown

```typescript
// Unit tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Integration tests
let sql: Sql;
let container: StartedTestContainer;

beforeAll(async () => {
  const db = await startTestDb();
  container = db.container;
  sql = db.sql;
  await runMigrations(db.url);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

beforeEach(async () => {
  await sql`TRUNCATE entries CASCADE`;
  await sql`TRUNCATE digests`;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

## Open Decisions for Phase 5

1. **Prompt loading pattern:** Whether to use `fs.readFileSync` inline (like `classify.ts`) or export a `loadPrompt(name)` function. Either way, unit tests mock the LLM provider, not the prompt loading.

2. **Structured logging:** The pipeline uses `console.error`/`console.warn` for error logging. If the project adopts a logger (e.g., `pino`), adjust the spy targets. Tests spy on `console.error` and `console.warn`.

3. **`node-cron` scheduling options:** The exact options object passed to `cron.schedule()` (e.g., `{ scheduled: true, timezone }`) will be determined during implementation. Tests verify the cron expression and timezone are passed correctly.

4. **Background retry entry processing:** Whether `runBackgroundRetry` calls `embedEntry`/`classifyEntry` (existing module functions that handle the full flow) or calls lower-level functions. Tests mock at the module level (`embed.js`, `classify.js`), so either approach works.

5. **Digest cache migration:** The `digests` table needs to be added to `src/db/index.ts` schema creation. Integration tests depend on `runMigrations` creating this table.

## Alignment Check

**Status: Full alignment.**

All 42 test scenarios from the test specification are mapped to test functions with setup, action, and assertion strategies defined.

| Check | Result |
|-------|--------|
| Every TS-ID mapped to a test function | Yes (42/42) |
| One behavior per test | Yes |
| All tests will initially fail | Yes — `src/digests.ts`, `src/digests-queries.ts`, `src/email.ts` do not exist |
| Test isolation verified | Yes (per-test `vi.clearAllMocks()`, `TRUNCATE` between integration tests) |
| No implementation coupling | Yes (tests verify observable behavior via mock calls + return values) |

Split: **35 unit tests + 7 integration tests = 42 test functions**.

### Notes

1. **TS-1.4 and TS-2.4** (cache tests) are integration because they verify actual PostgreSQL upsert behavior (ON CONFLICT DO UPDATE). Unit tests mock `cacheDigest` and only verify it's called with correct arguments.

2. **TS-4.1, TS-4.2, TS-4.4** (retry query tests) are integration because the query logic (null checks, soft-delete exclusion, ordering, LIMIT) is best verified against real PostgreSQL. The retry pipeline itself (calling embedEntry/classifyEntry per entry) is tested in unit tests.

3. **Background retry** reuses `embedEntry` from `src/embed.ts` and `classifyEntry` from `src/classify.ts`. Unit tests mock these modules. The retry module adds orchestration (query, iterate, handle errors) — that's what the unit tests verify.

4. **Scheduler tests** mock `node-cron` entirely. The scheduler's responsibility is resolving configuration and wiring cron jobs — not the cron library's timer behavior.

5. **Email tests** are all unit. `nodemailer` is mocked at the module level. The email module is thin (create transport, send mail) — integration testing against a real SMTP server is out of scope.

6. **`isSmtpConfigured`** checks env vars (`SMTP_HOST` is set and non-empty). Tests use `withEnv` to control this.
