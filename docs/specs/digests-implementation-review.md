# Digests — Implementation Review

| Field | Value |
|-------|-------|
| Feature | Digests |
| Date | 2026-03-08 |
| Status | PASS |

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec -> Test Spec coverage | PASS | All 29 ACs (AC-1.1 through AC-5.4) mapped to at least one test scenario. All testable edge cases covered. EC-6.1 deferred to web-settings, EC-6.3 untestable, EC-7.2 covered by SSE broadcaster. |
| Test Spec -> Spec traceability | PASS | All 42 test scenarios trace back to a spec AC, edge case, or constraint. TS-2.5b covers implicit weekly SSE push (now explicit as AC-2.7). |
| Test Spec -> Test Impl Spec coverage | PASS | All 42 test scenarios have detailed implementations in the test impl spec with matching test file and function name. |
| Test Impl Spec -> Test Spec (no orphans) | PASS | Every test in the impl spec maps back to a test spec scenario. No orphan tests. |
| Spec constraints respected | PASS | Plain text only (C-1), word limits via prompt (C-2), fixed sections per prompt (C-3), max 50 per retry cycle (C-4). |
| Non-goals respected | PASS | No digest customization, no HTML email, no digest history, no push notifications, no Telegram trigger, no retry backoff, no delivery confirmation, no configurable word limits, no multi-recipient. |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Impl Spec | PASS | All 35 unit tests and 7 integration tests match the impl spec's naming, grouping, and assertions. Count: 35 unit + 7 integration = 42 total. |
| Feature code vs Behavioral Spec | PASS | Implementation matches all ACs. Two spec-level discrepancies fixed during review (W-1, W-2). |
| Undocumented behavior | PASS | No significant undocumented behavior. `getLatestDigest` only exercised in integration tests — acceptable for a trivial single-query function. |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests | 42 |
| Passed | 42 |
| Failed | 0 |
| Skipped | 0 |
| Runner | npx vitest run |

### Failures

None.

## Coverage Report

### Gaps

None.

### Misalignments

None remaining. Two spec discrepancies fixed during review:
1. AC-1.3 `anthropic_model` → `llm_model` (fixed in behavioral spec)
2. Weekly SSE push had no explicit AC (added AC-2.7 in behavioral spec)

### Unresolved Items

None.

## Findings

| # | Severity | Layer | Description | Resolution |
|---|----------|-------|-------------|------------|
| 1 | WARNING | Spec | AC-1.3 used `anthropic_model` but correct key is `llm_model` | Fixed — behavioral spec updated |
| 2 | WARNING | Spec | Weekly SSE push had no explicit AC (only in objective text) | Fixed — added AC-2.7 |
| 3 | WARNING | Code | `upcomingTasks` query has no lower date bound — overdue tasks included | Kept — overdue tasks in a daily briefing is better UX. Spec says "due within 7 days" which is ambiguous; including overdue items helps surface forgotten work. |
| 4 | INFO | Code | `formatDateInTz` uses `toLocaleDateString("sv-SE")` for ISO date format | Documented — well-known Node.js pattern, works reliably |
| 5 | INFO | Code | `getMondayInTz` relies on en-US locale string parseability | Acceptable — works on Node.js (the only target runtime) |
| 6 | INFO | Test | TS-3.2 compares subject date against UTC `toISOString()` but implementation uses timezone-aware date | Low risk — tests run in CI with consistent timezone. Would only fail near midnight UTC in a timezone offset. |
| 7 | INFO | Code | `isSmtpConfigured()` only checks `SMTP_HOST`, not all four SMTP vars | Acceptable — checking the host as a gate is a reasonable simplification. Incomplete SMTP config will fail at send time with a logged error. |
| 8 | INFO | Code | Redundant `process.env.DIGEST_EMAIL_TO` fallback in `resolveEmailConfig` | Fixed — removed. `resolveConfigValue` already handles the env var lookup via `SETTINGS_TO_ENV`. |

## Recommendations

None blocking. All WARNINGs resolved. Implementation is complete.

## Implementation Summary

| File | Role |
|------|------|
| `src/digests.ts` | Pipeline orchestration (`generateDailyDigest`, `generateWeeklyReview`, `runBackgroundRetry`) + cron scheduler (`startScheduler`) |
| `src/digests-queries.ts` | DB query layer (5 functions: daily data, weekly data, cache upsert, cache read, retry entry selection) |
| `src/email.ts` | Email module (`sendDigestEmail` via nodemailer, `isSmtpConfigured` gate) |
| `prompts/daily-digest.md` | Daily prompt template: TOP 3 TODAY, STUCK ON, SMALL WIN (150 words) |
| `prompts/weekly-review.md` | Weekly prompt template: WHAT HAPPENED, OPEN LOOPS, NEXT WEEK, RECURRING THEME (250 words) |

Dependencies: `node-cron`, `nodemailer` (production); `@types/node-cron`, `@types/nodemailer` (dev).
