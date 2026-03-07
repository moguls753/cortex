# Digests - Test Specification

| Field | Value |
|-------|-------|
| Feature | Digests |
| Phase | 2 |
| Date | 2026-03-07 |
| Status | Draft |
| Source | `digests-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|-----------------|------------------|
| AC-1.1: Daily cron at configured schedule | TS-5.1a, TS-5.1b, TS-5.2, TS-5.3 |
| AC-1.2: Daily digest queries correct data | TS-1.1 |
| AC-1.3: Data sent to Claude with daily prompt and configured model | TS-1.2 |
| AC-1.4: Claude response used as-is (trimmed) | TS-1.3 |
| AC-1.5: Digest cached (latest only) | TS-1.4 |
| AC-1.6: Digest pushed via SSE | TS-1.5 |
| AC-1.7: Digest sent via email | TS-1.6 |
| AC-2.1: Weekly cron at configured schedule | TS-5.1a, TS-5.1b, TS-5.2, TS-5.3 |
| AC-2.2: Weekly review queries correct data | TS-2.1 |
| AC-2.3: Data sent to Claude with weekly prompt | TS-2.2 |
| AC-2.4: Claude response used as-is | TS-2.3 |
| AC-2.5: Review cached separately from daily | TS-2.4, TS-2.5b |
| AC-2.6: Review sent via email | TS-2.5 |
| AC-3.1: SMTP config (host, port, user, pass, from, to) | TS-3.1, TS-3.5 |
| AC-3.2: Daily email subject format | TS-3.2 |
| AC-3.3: Weekly email subject format | TS-3.3 |
| AC-3.4: Email body is plain text | TS-3.4 |
| AC-3.5: SMTP failure logged, digest still cached/SSE'd | TS-3.6 |
| AC-3.6: Failed emails not retried | TS-3.6 |
| AC-4.1: Retry job runs every 15 minutes | TS-4.1 (implicit — schedule is hardcoded) |
| AC-4.2: Entries with null embedding get embeddings | TS-4.1 |
| AC-4.3: Entries with null category get reclassified | TS-4.2 |
| AC-4.4: Embedding/classification updates independent | TS-4.3 |
| AC-4.5: Failed entries logged, left for next cycle | TS-4.5 |
| AC-4.6: Max 50 per cycle, oldest first | TS-4.4 |
| AC-5.1: Cron from env vars | TS-5.1b |
| AC-5.2: Settings override env vars | TS-5.1a |
| AC-5.3: Live rescheduling without restart | TS-5.4 |
| AC-5.4: Default schedules | TS-5.2 |
| EC-1.1: Empty database daily | TS-1.7 |
| EC-1.2: All projects stalled | TS-1.1 (active projects included in data — Claude interprets staleness) |
| EC-1.3: No tasks due | TS-1.1 (query returns empty for tasks, included in payload) |
| EC-1.4: No stuck items | TS-1.1 (query returns empty, included in payload) |
| EC-2.1: Week with zero entries | TS-2.6 |
| EC-2.2: Very busy week | TS-2.1 (all entries included regardless of count) |
| EC-3.1: SMTP not configured | TS-3.7 |
| EC-3.2: Recipient empty | TS-3.8 |
| EC-3.3: SMTP connection timeout | TS-3.6 |
| EC-3.4: SMTP auth failure | TS-3.6 |
| EC-4.1: Claude down during daily | TS-1.8 |
| EC-4.2: Claude down during weekly | TS-2.7 |
| EC-4.3: Claude malformed/empty response | TS-1.9 |
| EC-5.1: >50 entries need retry | TS-4.4 |
| EC-5.2: Claude down during classification retry | TS-4.8 |
| EC-5.3: Ollama down during embedding retry | TS-4.7 |
| EC-5.4: Entry needs both embedding and classification | TS-4.6 |
| EC-5.5: No entries need retry | TS-4.9 |
| EC-6.1: Invalid cron expression | Covered by web-settings validation (not digests) |
| EC-6.2: App starts after digest time | TS-5.6 |
| EC-6.3: App restarts during generation | Not testable (OS-level) |
| EC-6.4: Timezone change | TS-5.5 |
| EC-6.5: Two jobs fire simultaneously | TS-5.7 |
| Objective: Weekly review pushed via SSE | TS-2.5b (spec gap — objective says SSE, no AC) |
| EC-7.1: No SSE clients connected | TS-1.5, TS-2.5b (SSE push is no-op, digest still cached) |
| EC-7.2: Client disconnects during push | Covered by SSE broadcaster (already tested) |
| C-1: Plain text only | TS-3.4 |
| C-2: Word limits via prompt, not code | TS-1.2, TS-2.2 (prompt sent with limits) |
| C-3: Fixed sections per prompt | TS-1.2, TS-2.2 |
| C-4: Max 50 entries per retry cycle | TS-4.4 |

## Test Scenarios

### Group 1: Daily Digest Pipeline

**TS-1.1: Assembles correct daily data from database**
- Given entries exist in the database: active projects with next actions, people with pending follow-ups, tasks due within 7 days (pending status), entries captured yesterday, and soft-deleted entries
- When the daily digest generation runs
- Then the data payload includes active projects where `fields->>'status'` is `'active'` and `fields->>'next_action'` is not null/empty
- And includes people where `fields->>'follow_ups'` is not null/empty
- And includes tasks where `fields->>'status'` is `'pending'` and `fields->>'due_date'` is within the next 7 days
- And includes entries with `created_at` within the previous calendar day
- And soft-deleted entries are excluded from all queries

**TS-1.2: Sends assembled data to Claude with daily prompt and configured model**
- Given daily data has been assembled
- When the data is sent to Claude
- Then the LLM is called with the daily digest prompt template
- And the model used is the one configured by the `llm_model` setting (default `claude-sonnet-4-20250514`)
- And the prompt instructs a maximum of 150 words with sections TOP 3 TODAY, STUCK ON, SMALL WIN

**TS-1.3: Uses Claude's response as-is with whitespace trimmed**
- Given Claude returns a daily digest response with leading/trailing whitespace
- When the response is processed
- Then the digest content is the response with whitespace trimmed
- And no other post-processing is applied

**TS-1.4: Caches latest daily digest, overwriting previous**
- Given a previous daily digest is cached
- When a new daily digest is generated
- Then the new digest overwrites the previous cached digest
- And the cache stores the content and generation timestamp
- And only the most recent daily digest is kept

**TS-1.5: Pushes digest to connected SSE clients**
- Given dashboard clients are connected via SSE
- When a daily digest is generated
- Then the digest is pushed to all connected clients via SSE
- And if no clients are connected, the push is a no-op (digest is still cached)

**TS-1.6: Sends digest via email**
- Given SMTP is configured and a daily digest is generated
- When the email delivery step runs
- Then an email is sent with the digest content
- And the email uses the daily subject format

**TS-1.7: Empty database — prompt still runs with zero items**
- Given no entries exist in the database
- When the daily digest generation runs
- Then the data assembly returns empty results for all categories
- And the data is still sent to Claude (prompt runs with zero items)
- And a digest is cached and delivered normally

**TS-1.8: Claude API down — error logged, error message cached, no email**
- Given Claude is unreachable or returns an error
- When the daily digest generation runs
- Then the error is logged with structured JSON logging
- And an error message is cached on the dashboard (e.g., "Digest generation failed — will retry at next scheduled time")
- And no email is sent
- And no immediate retry is attempted

**TS-1.9: Claude returns empty or malformed response — treated as failure**
- Given Claude returns an empty string or invalid response
- When the daily digest generation runs
- Then it is treated the same as Claude being down (TS-1.8)
- And an error is logged and error message cached

### Group 2: Weekly Review Pipeline

**TS-2.1: Assembles correct weekly data from database**
- Given entries exist from the past 7 days across multiple categories, and stalled projects exist (active, updated > 5 days ago)
- When the weekly review generation runs
- Then the data payload includes all entries created in the past 7 days (any category, excluding soft-deleted)
- And includes activity statistics: count per day for past 7 days, count per category for past 7 days
- And includes stalled projects (active, updated > 5 days ago)
- And soft-deleted entries are excluded from all queries

**TS-2.2: Sends assembled data to Claude with weekly prompt**
- Given weekly data has been assembled
- When the data is sent to Claude
- Then the LLM is called with the weekly review prompt template
- And the prompt instructs a maximum of 250 words with sections WHAT HAPPENED, OPEN LOOPS, NEXT WEEK, RECURRING THEME

**TS-2.3: Uses Claude's response as-is with whitespace trimmed**
- Given Claude returns a weekly review response
- When the response is processed
- Then the review content is the response with whitespace trimmed

**TS-2.4: Caches review separately from daily digest**
- Given a daily digest is cached and a weekly review is generated
- When the review is cached
- Then the weekly review is stored separately from the daily digest
- And both can be displayed on the dashboard simultaneously
- And the weekly review overwrites only the previous weekly review

**TS-2.5: Sends review via email**
- Given SMTP is configured and a weekly review is generated
- When the email delivery step runs
- Then an email is sent with the review content
- And the email uses the weekly subject format

**TS-2.5b: Pushes weekly review to connected SSE clients**
- Given dashboard clients are connected via SSE
- When a weekly review is generated
- Then the review is pushed to all connected clients via SSE
- And if no clients are connected, the push is a no-op (review is still cached)

**TS-2.6: Zero entries in past week — prompt runs with empty data**
- Given no entries were created in the past 7 days
- When the weekly review generation runs
- Then the data assembly returns empty results
- And the data is still sent to Claude
- And a review is cached and delivered normally

**TS-2.7: Claude API down during weekly review — same behavior as daily failure**
- Given Claude is unreachable during weekly review generation
- When the weekly review generation runs
- Then the error is logged, error message cached, no email sent (same as TS-1.8)

### Group 3: Email Delivery

**TS-3.1: Uses SMTP env vars and sender defaults**
- Given `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` are set
- And `DIGEST_EMAIL_FROM` is not set
- When an email is sent
- Then the sender address defaults to the value of `SMTP_USER`

**TS-3.2: Daily email subject format**
- Given a daily digest is being emailed
- When the email is composed
- Then the subject is `"Cortex Daily — {YYYY-MM-DD}"` where the date is the current date

**TS-3.3: Weekly email subject format**
- Given a weekly review is being emailed
- When the email is composed
- Then the subject is `"Cortex Weekly — w/c {YYYY-MM-DD}"` where the date is the Monday of the current week

**TS-3.4: Email body is plain text content**
- Given a digest has been generated
- When the email is sent
- Then the body is the plain text content from Claude
- And no HTML formatting, headers, or footers are added

**TS-3.5: Recipient from settings overrides env var**
- Given `DIGEST_EMAIL_TO` env var is set to `env@example.com`
- And the `digest_email_to` setting is set to `settings@example.com`
- When an email is sent
- Then the recipient is `settings@example.com` (settings takes precedence)

**TS-3.6: SMTP failure — error logged, digest still delivered, no retry**
- Given SMTP sending fails (connection error, auth failure, or timeout)
- When the digest email delivery step runs
- Then the error is logged with structured JSON logging (module: `email`)
- And the digest is still cached on the dashboard
- And the digest is still pushed via SSE
- And the email is not retried

**TS-3.7: SMTP not configured — email skipped, no error logged**
- Given all `SMTP_*` environment variables are empty or unset
- When a digest is generated
- Then email sending is skipped entirely
- And no error is logged (this is a valid configuration)
- And the digest is still cached and pushed via SSE

**TS-3.8: Recipient empty — email skipped, warning logged**
- Given SMTP is configured but `DIGEST_EMAIL_TO` is empty and `digest_email_to` setting is not set
- When a digest is generated
- Then email sending is skipped
- And a warning is logged

### Group 4: Background Retry

**TS-4.1: Finds and embeds entries with null embedding**
- Given active entries exist with `embedding IS NULL`
- And a soft-deleted entry also has `embedding IS NULL`
- When the background retry job runs
- Then embeddings are generated for the active entries using Ollama
- And the embedding is computed from the entry's `content` (or `name` if content is empty)
- And the entries are updated in the database with the new embeddings
- And the soft-deleted entry is not processed

**TS-4.2: Finds and reclassifies entries with null category**
- Given active entries exist with `category IS NULL`
- When the background retry job runs
- Then classification is attempted using the context-aware pipeline
- And context includes last 5 recent entries and top 3 similar entries (if embedding exists)
- And if the entry has no embedding, only recent entries are used as context
- And successfully classified entries are updated in the database

**TS-4.3: Embedding and classification succeed/fail independently**
- Given an entry has both `embedding IS NULL` and `category IS NULL`
- And embedding generation succeeds but classification fails
- When the background retry job runs
- Then the entry's embedding is saved
- And the entry's category remains null
- And the entry is eligible for classification retry in the next cycle

**TS-4.4: Maximum 50 entries per cycle, oldest first**
- Given 60 active entries need processing (null embedding or null category)
- When the background retry job runs
- Then only the 50 oldest entries (by `created_at`) are processed
- And the remaining 10 are deferred to the next cycle

**TS-4.5: Failed entries logged, left for next cycle**
- Given entries need embedding but Ollama returns an error for some
- When the background retry job runs
- Then errors are logged with structured JSON logging
- And failed entries retain their null embedding/category
- And no entry is marked as permanently failed

**TS-4.6: Entry with both null embedding and null category — both attempted**
- Given an entry has `embedding IS NULL` and `category IS NULL`
- When the background retry job processes this entry
- Then embedding is attempted first
- And classification is attempted after
- And both can succeed independently

**TS-4.7: Ollama down — all embedding retries fail**
- Given entries need embedding and Ollama is unreachable
- When the background retry job runs
- Then all embedding attempts fail
- And entries retain `embedding IS NULL`
- And errors are logged
- And the retry job does not crash

**TS-4.8: Claude down — all classification retries fail**
- Given entries need classification and Claude is unreachable
- When the background retry job runs
- Then all classification attempts fail
- And entries retain `category IS NULL`
- And errors are logged

**TS-4.9: No entries need retry — job completes with no API calls**
- Given all entries have valid embeddings and categories
- When the background retry job runs
- Then no entries are found to process
- And no Ollama or Claude API calls are made
- And the job completes immediately

### Group 5: Scheduling & Configuration

**TS-5.1a: Settings value takes precedence over env var**
- Given the `digest_daily_cron` setting is `"0 8 * * *"`
- And the `DAILY_DIGEST_CRON` env var is `"0 9 * * *"`
- When the cron schedule is resolved
- Then the settings value `"0 8 * * *"` is used

**TS-5.1b: Env var used when no settings value exists**
- Given the `digest_daily_cron` setting does not exist in the settings table
- And the `DAILY_DIGEST_CRON` env var is `"0 9 * * *"`
- When the cron schedule is resolved
- Then the env var value `"0 9 * * *"` is used

**TS-5.2: Default schedules**
- Given neither settings nor env vars provide cron expressions
- When the cron schedules are resolved
- Then the daily schedule is `"30 7 * * *"` (07:30 daily)
- And the weekly schedule is `"0 16 * * 0"` (Sunday 16:00)

**TS-5.3: Cron runs in configured timezone**
- Given the `timezone` setting is `"America/New_York"`
- When the cron schedule fires
- Then the firing time is interpreted in the `America/New_York` timezone
- And not in UTC or the system's local timezone

**TS-5.4: Schedule change via settings reschedules without restart**
- Given the daily digest cron is running with schedule `"30 7 * * *"`
- When the `digest_daily_cron` setting is changed to `"0 8 * * *"`
- Then the old cron job is stopped
- And a new cron job is started with `"0 8 * * *"`
- And no application restart is needed

**TS-5.5: Timezone change reschedules cron**
- Given cron jobs are running in timezone `Europe/Berlin`
- When the `timezone` setting is changed to `America/New_York`
- Then the cron jobs are rescheduled with the new timezone
- And the next firing time is recalculated

**TS-5.6: App starts after digest time — no retroactive generation**
- Given the daily digest is scheduled for 07:30
- And the application starts at 10:00
- When the scheduler initializes
- Then the daily digest is NOT retroactively generated
- And the system waits for the next scheduled time (07:30 the next day)

**TS-5.7: Two jobs fire at the same time — run independently**
- Given the daily and weekly digests are both scheduled for 16:00 on Sunday
- When both cron jobs fire
- Then each runs independently
- And each makes its own database queries and Claude API call
- And no mutex or locking is needed

## Edge Case Scenarios

All edge cases from the behavioral specification are covered inline within their respective groups:

- **Daily digest:** TS-1.7 (empty DB), TS-1.8 (Claude down), TS-1.9 (empty response)
- **Weekly review:** TS-2.5b (SSE push), TS-2.6 (zero entries), TS-2.7 (Claude down)
- **Email:** TS-3.6 (SMTP failure), TS-3.7 (SMTP not configured), TS-3.8 (recipient empty)
- **Background retry:** TS-4.3 (independent success/failure), TS-4.4 (>50 entries), TS-4.6 (both null), TS-4.7 (Ollama down), TS-4.8 (Claude down), TS-4.9 (nothing to retry)
- **Scheduling:** TS-5.5 (timezone change), TS-5.6 (late start), TS-5.7 (simultaneous)

Edge cases NOT tested here (covered elsewhere or untestable):
- EC-6.1 (invalid cron expression) — covered by web-settings validation
- EC-6.3 (app restart during generation) — OS-level, not unit/integration testable
- EC-7.2 (client disconnect during SSE) — covered by SSE broadcaster tests

## Traceability

All 29 acceptance criteria (AC-1.1 through AC-5.4) are mapped to at least one test scenario. All testable edge cases are covered. Constraints are verified through the relevant scenarios (plain text via TS-3.4, word limits via TS-1.2/TS-2.2, max 50 via TS-4.4). Non-goals are enforced by the absence of corresponding features.

**Notes:**

1. AC-1.3 references `anthropic_model` setting but the correct key is `llm_model` (renamed during web-settings implementation for LLM-agnostic naming). Test scenarios use `llm_model`. The behavioral spec should be updated to match.
2. The spec objective says both daily and weekly digests are "pushed to connected browsers via SSE," but only AC-1.6 specifies SSE (for daily). TS-2.5b covers weekly SSE push based on the objective's intent. The behavioral spec should add an explicit AC for weekly SSE push.
3. EC-1.2/EC-1.3/EC-1.4 describe Claude's response to different data compositions. The testable code behavior is data assembly (TS-1.1) — Claude's interpretation is prompt-level, not code-level.

**Total: 42 test scenarios** across 5 groups.
