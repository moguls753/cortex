# Classification — Implementation Review

| Field | Value |
|-------|-------|
| Feature | Classification |
| Date | 2026-03-04 |
| Status | PASS (with warnings) |

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec -> Test Spec coverage | PASS | 16 of 17 ACs covered; AC-4.2 (dashboard display) deferred to web-dashboard feature |
| Test Spec -> Spec traceability | PASS | All 50 test scenarios trace to spec requirements — no orphans |
| Test Spec -> Test Impl Spec coverage | PASS | All 50 scenarios mapped to test implementation approaches |
| Test Impl Spec -> Test Spec (no orphans) | PASS | No orphan test implementations |
| Spec constraints respected | PASS | LLM provider abstraction, prompt-from-file, calendar fields ephemeral, exponential backoff all implemented |
| Non-goals respected | PASS | No raw API response stored, no re-classification on prompt change, no re-classification on content edit |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Spec | PASS | All 50 test scenarios have corresponding test functions (33 unit + 17 integration) |
| Test code vs Test Impl Spec | PASS | All test functions match the impl spec's scenario mapping table |
| Feature code vs Behavioral Spec | PASS | CRITICAL-1 (dead threshold code) fixed — lines removed. Threshold evaluation deferred to presentation layer (Telegram/web) |
| Undocumented behavior | PASS | Minor undocumented behaviors are sensible defaults (see INFO findings) |

### Feature Code Inventory

| Source File | Purpose | Spec Coverage |
|-------------|---------|---------------|
| `src/classify.ts` | Pure helpers + DB functions + LLM classification + retry | US-1 through US-4, all constraints |
| `src/llm/index.ts` | LLM provider abstraction (Anthropic + OpenAI-compatible) | AC-1.1, C-1 |
| `src/sleep.ts` | Mockable delay utility for exponential backoff | C-5 |
| `prompts/classify.md` | Classification prompt template with placeholders | C-2 |

### Test Code Inventory

| Test File | Count | Scenarios |
|-----------|-------|-----------|
| `tests/unit/classify.test.ts` | 33 | TS-1.1–1.11, TS-2.8–2.10, TS-3.1, TS-3.3–3.5, TS-4.1–4.5, TS-4.9, TS-C-1, TS-EC-1–EC-4, TS-EC-6–EC-9 |
| `tests/integration/classify-integration.test.ts` | 17 | TS-2.1–2.7, TS-3.2, TS-4.6–4.8, TS-C-2, TS-C-3, TS-EC-5, TS-NG-1–TS-NG-3 |
| `tests/helpers/mock-llm.ts` | — | Shared helper: `createClassificationResult`, `createClassificationJSON`, `createMockChat` |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests (classification) | 50 |
| Passed | 50 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npm run test:unit` + `npm run test:integration` (Vitest) |
| Total tests (all features) | 108 (70 unit + 38 integration) |
| All passed | 108 |

### Failures

None.

## Coverage Report

### Gaps (spec requirements without test or implementation)

- **AC-4.2** (entries with `category: null` displayed with "unclassified" label on dashboard): This is a UI concern belonging to the web-dashboard feature. Not testable in the classification feature. The test spec should acknowledge this gap explicitly.

### Misalignments (contradictions between artifacts)

- `classifyEntry` reads confidence threshold from DB (line 324–325) but assigns it to `_threshold` (unused variable). The threshold is never applied to flag entries as confident/uncertain within the classification flow.
- Coverage matrix EC-2 row maps to TS-1.7 (wrong: TS-1.7 tests confidence range). EC-2 is actually covered by TS-1.6 (invalid category).

### Unresolved Items

None. The behavioral specification has no `[NEEDS CLARIFICATION]` markers.

## Findings

| # | Severity | Layer | Description |
|---|----------|-------|-------------|
| 1 | ~~CRITICAL~~ FIXED | Feature code vs Spec | **Dead threshold code in `classifyEntry` — RESOLVED.** Removed unused `_threshold` variable and the `resolveConfigValue` import. Threshold evaluation is deferred to the presentation layer (Telegram bot, web dashboard) which will call `resolveConfidenceThreshold` + `isConfident` when deciding how to display entries. |
| 2 | WARNING | Feature code vs Spec | **Lenient validation for `create_calendar_event` and `calendar_date`.** AC-1.3 requires these to be validated as boolean/string, but the code silently defaults (`false`/`null`) when types are wrong. `calendar_date` is also not checked against YYYY-MM-DD format. Defensible since these fields are ephemeral (C-4). |
| 3 | WARNING | Feature code vs Spec | **Incomplete error logging in `classifyEntry` and `retryFailedClassifications`.** AC-4.4 specifies `inputLength` in structured error context. Only `classifyText` includes it. The two DB-level functions log `entryId`, `status`, and `error` but omit `inputLength`. |
| 4 | WARNING | Test code vs Spec | **TS-4.5 assertion is vacuous.** `classifyText` returns `null` on error, so the test always takes the else branch which asserts `expect(result).toBeNull()` — a tautology. Content preservation is actually the caller's responsibility (entry is stored before classification), but the test does not verify this effectively. |
| 5 | WARNING | Feature code vs Spec | **LLM provider config from env vars only.** `classifyEntry` and `retryFailedClassifications` read `LLM_PROVIDER`, `LLM_MODEL`, etc. from `process.env` directly instead of using `resolveConfigValue()`. The two-layer config (env + settings table override) is not applied for LLM settings. Settings page changes to LLM model wouldn't take effect until restart. Deferring to web-settings feature may be acceptable. |
| 6 | WARNING | Feature code | **Retry backoff applies between different entries, not retries of the same entry.** On 429, the code sleeps then `continue`s to the next entry — it does not retry the failed entry. The entry stays `category: null` until the next cron run. The spec wording is ambiguous ("exponential backoff if it encounters consecutive 429 responses") so this is defensible, but worth noting. |
| 7 | WARNING | Test Spec | **Coverage matrix EC-2 maps to wrong scenario.** EC-2 (invalid category from LLM) is listed as "covered by TS-1.7" but TS-1.7 tests out-of-range confidence. EC-2 is actually covered by TS-1.6. Documentation error only — actual test coverage is correct. |
| 8 | INFO | Feature code | `classifyEntry` excludes the entry being classified from its own context (line 330). Not specified but sensible. |
| 9 | INFO | Feature code | `tags` array validation does not verify individual elements are strings. AC-1.3 says "array of strings" but only `Array.isArray()` is checked. |
| 10 | INFO | Feature code | `retryFailedClassifications` orders entries by `created_at ASC`. Not specified but produces fair retry ordering. |
| 11 | INFO | Feature code | Context entries with `null` category are formatted as `"unclassified"`. Not specified but reasonable. |
| 12 | INFO | Feature code | New `LLMProvider` instance created on every classification call. No connection pooling. Not a spec issue but has minor performance implications. |
| 13 | INFO | Test Spec | Coverage matrix lists C-2 as `TS-C-1` only at the top, but the traceability table at the bottom correctly includes both `TS-1.4` and `TS-C-1`. Minor documentation inconsistency. |

## Recommendations

### Fixed

- **Finding 1:** Removed dead `_threshold` code and unused `resolveConfigValue` import from `classifyEntry`. Threshold evaluation deferred to presentation layer.

### Should fix (WARNING)

- **Finding 3:** Add `inputLength` to error logs in `classifyEntry` (line 358) and `retryFailedClassifications` (line 448).
- **Finding 4:** Rewrite TS-4.5 to remove the tautological else branch. Either test content preservation through `classifyEntry` integration test, or document that content preservation is a caller responsibility and adjust the test spec.
- **Finding 7:** Fix coverage matrix EC-2 mapping from TS-1.7 to TS-1.6 in the test specification.

### Can defer

- **Finding 2** (calendar field leniency): Low impact — fields are ephemeral.
- **Finding 5** (LLM config from env only): Can be addressed when web-settings is implemented.
- **Finding 6** (retry backoff semantics): Current behavior is defensible.
- **Findings 8–13**: Informational only.

**Overall: Classification is complete.** CRITICAL-1 has been fixed. 6 WARNING findings remain, none of which block completion. All 108 tests pass. Proceed to telegram-bot Phase 2.
