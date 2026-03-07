# Web New Note — Implementation Review

| Field | Value |
|-------|-------|
| Feature | web-new-note |
| Date | 2026-03-07 |
| Status | PASS |

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec -> Test Spec coverage | PASS | All 15 ACs, 7 constraints, 9 edge cases, 4 resolved questions mapped to 24 test scenarios |
| Test Spec -> Spec traceability | PASS | All 24 scenarios trace to spec requirements — no orphans |
| Test Spec -> Test Impl Spec coverage | PASS | All 24 scenarios mapped to test functions (20 unit + 4 integration) |
| Test Impl Spec -> Test Spec (no orphans) | PASS | No orphan test implementations |
| Spec constraints respected | PASS | Server-rendered HTML, auth required, name required, content optional |
| Non-goals respected | PASS | No auto-save, no file attachments, no markdown preview, no templates |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Impl Spec | PASS | All 24 test functions match spec (20 in unit, 4 in integration) |
| Feature code vs Behavioral Spec | PASS | All acceptance criteria implemented |
| Undocumented behavior | PASS | No untested code paths found |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests | 24 |
| Passed | 24 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npx vitest run tests/unit/web-new-note.test.ts tests/integration/web-new-note-integration.test.ts` |

### Failures

None.

## Coverage Report

### Gaps

None.

### Misalignments

None.

### Unresolved Items

None. All 4 open questions from the behavioral spec were resolved before Phase 2.

## Findings

| # | Severity | Layer | Description | Resolution |
|---|----------|-------|-------------|------------|
| 1 | CRITICAL | Code Alignment | `createNewNoteRoutes` was not wired in `src/index.ts` — new note page would not be accessible in the running app | **Fixed.** Added import and `app.route("/", createNewNoteRoutes(sql))` to `src/index.ts` |
| 2 | INFO | Code Alignment | `CATEGORY_FIELDS`, `CATEGORIES`, `escapeHtml`, `parseTags` are duplicated between `src/web/new-note.ts` and `src/web/entry.ts` | Non-blocking. Could be extracted to a shared module in a future refactor. Both copies are identical in behavior (new-note's `parseTags` adds `.toLowerCase()` normalization per EC-9). |
| 3 | INFO | Code Alignment | `parseTags` in new-note.ts normalizes to lowercase (`.toLowerCase()`), while entry.ts does not | Intentional per EC-9 (tag normalization on new note creation). Entry edit preserves existing tag casing. Consistent with test expectations. |

## Recommendations

- No blocking issues remain. All 24 tests pass, CRITICAL-1 fixed during review.
- Consider extracting shared constants (`CATEGORY_FIELDS`, `CATEGORIES`, `CATEGORY_LABELS`) to a shared module to reduce duplication (INFO-2). Low priority.
