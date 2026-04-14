# Embedding — Implementation Review

| Field | Value |
|-------|-------|
| Feature | Embedding |
| Date | 2026-03-04 |
| Status | PASS |

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec → Test Spec coverage | PASS | All 26 acceptance criteria, constraints, edge cases, and non-goals mapped to test scenarios |
| Test Spec → Spec traceability | PASS | All 26 test scenarios trace to numbered spec requirements — no orphans |
| Test Spec → Test Impl Spec coverage | PASS | All 26 test scenarios mapped to concrete test functions with setup/action/assertion |
| Test Impl Spec → Test Spec (no orphans) | PASS | No orphan test implementations |
| Spec constraints respected | PASS | Model fixed to qwen3-embedding, 4096 dims, 30s timeout, sequential retry, OLLAMA_URL override |
| Non-goals respected | PASS | No batch embedding, no caching, no model switching at runtime |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Impl Spec | PASS | All 26 test functions match the test impl spec (16 unit, 10 integration) |
| Feature code vs Behavioral Spec | PASS | All exports match spec: `generateEmbedding`, `prepareEmbeddingInput`, `initializeEmbedding`, `retryFailedEmbeddings`, `embedEntry` |
| Undocumented behavior | PASS | No untested code paths; internal `ensureModel` and `doGenerateEmbedding` are tested transitively |

### Feature Code → Spec Requirement Mapping

| Spec Requirement | Implementation |
|------------------|----------------|
| AC-1.1–1.4: Ollama /api/embed, 4096-dim | `generateEmbedding()` calls `/api/embed` with model `qwen3-embedding`, validates 4096 dimensions |
| C-3: Concatenate name + content | `prepareEmbeddingInput()` returns `"${name} ${content}"` |
| AC-2.1–2.3: Startup model check/pull | `initializeEmbedding()` → `ensureModel()` checks `/api/tags`, pulls via `/api/pull` if missing |
| AC-2.3: Unreachable → warn, no crash | `initializeEmbedding()` catches all errors, logs warning |
| AC-3.1: Failed → null embedding | `embedEntry()` catches errors from `generateEmbedding()`, leaves embedding null |
| AC-3.2–3.4: Retry cron | `retryFailedEmbeddings()` queries `WHERE embedding IS NULL`, processes sequentially by `created_at ASC` |
| C-2: OLLAMA_URL config + DB override | Module-level `defaultOllamaUrl` from env; `retryFailedEmbeddings()` uses `resolveConfigValue("ollama_url", sql)` |
| C-4: 30-second timeout | `doGenerateEmbedding()` uses `setTimeout(30_000)` with `Promise.race` pattern |
| EC-2: Long text truncation | `prepareEmbeddingInput()` truncates at 32,000 chars at word boundary |
| EC-5: Empty input | `prepareEmbeddingInput()` returns null with warning log for empty name + null content |
| EC-8: Wrong dimensions | `doGenerateEmbedding()` validates `embedding.length !== 4096`, returns null with error log |
| EC-4/EC-8: Model deleted / re-pull on retry | `retryFailedEmbeddings()` calls `ensureModel()` before processing entries |
| NG-5: Re-embed on update | `embedEntry()` reads current content from DB, generates new embedding |
| NG-3: No caching | `generateEmbedding()` makes a fresh fetch call every time |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests | 58 |
| Passed | 58 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npm test` (vitest run) |

### Embedding-specific tests

| Suite | Tests | Status |
|-------|-------|--------|
| `tests/unit/embed.test.ts` | 16 | All pass |
| `tests/integration/embed-integration.test.ts` | 10 | All pass |

No regressions in foundation tests (32 tests still passing).

## Coverage Report

### Gaps
None.

### Misalignments
None.

### Unresolved Items
None. No `[NEEDS CLARIFICATION]` markers in any spec document.

## Findings

| # | Severity | Layer | Description |
|---|----------|-------|-------------|
| 1 | INFO | Implementation | `Response.clone()` used in `doGenerateEmbedding` and `ensureModel` to handle test mocks that reuse the same Response object. This is harmless in production (each fetch returns a fresh Response) and necessary for test compatibility. |
| 2 | INFO | Implementation | `promise.catch(() => {})` in `generateEmbedding` wrapper prevents false-positive unhandled rejection warnings during vitest fake timer advancement. The caller still observes the rejection normally. |

## Recommendations

None. All 26 embedding test scenarios pass. Implementation aligns with the behavioral specification, test specification, and test implementation specification. The feature is complete.
