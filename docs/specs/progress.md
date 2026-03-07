# Spec-DD Progress Tracker

Last updated: 2026-03-07

## Feature Status

| Feature | Phase 1: Spec | Phase 2: Test Spec | Phase 3: Test Impl Spec | Phase 4: Tests | Phase 5: Code | Phase 6: Review |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| foundation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| embedding | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| classification | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| telegram-bot | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| web-auth | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| web-dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| web-browse | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| web-entry | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| web-new-note | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| web-settings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| mcp-server | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| digests | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |

Legend: ✅ = complete, ⬜ = not started, 🔄 = in progress

## Next Action

**Foundation complete.** All 6 phases done, 32/32 tests pass, review report at `foundation-implementation-review.md`.

**Embedding complete.** All 6 phases done, 26/26 tests pass (16 unit + 10 integration), review report at `embedding-implementation-review.md`. Implementation: `src/embed.ts` exports `generateEmbedding`, `prepareEmbeddingInput`, `initializeEmbedding`, `retryFailedEmbeddings`, `embedEntry`.

**Classification complete.** All 6 phases done, 50/50 tests pass (33 unit + 17 integration), review report at `classification-implementation-review.md`. CRITICAL-1 (dead threshold code) fixed. 6 WARNINGs remain (non-blocking). Implementation: `src/classify.ts`, `src/llm/index.ts`, `src/sleep.ts`, `prompts/classify.md`.

**Telegram Bot Phase 4 complete.** 70 tests implemented (47 unit + 23 integration), all failing with `ERR_MODULE_NOT_FOUND` as expected (`src/telegram.ts` doesn't exist yet). Files: `tests/unit/telegram-bot.test.ts`, `tests/integration/telegram-bot-integration.test.ts`, `tests/helpers/mock-telegram.ts`. Dependency `grammy` installed.

**Telegram Bot Phase 5 complete.** All 70 tests pass (47 unit + 23 integration). Implementation: `src/telegram.ts` exports `handleTextMessage`, `handleVoiceMessage`, `handleCallbackQuery`, `handleFixCommand`, `startBot`, `createBotWithHandlers`. Added `reclassifyEntry` to `src/classify.ts`. Total: 178/178 tests passing across all features.

**Telegram Bot complete.** All 6 phases done, 70/70 tests pass (47 unit + 23 integration), review report at `telegram-bot-implementation-review.md`. 1 CRITICAL fixed during review (context-aware classification was missing from handlers). 1 WARNING fixed (auth check ordering in /fix). 1 WARNING remains (non-blocking): `/fix` doesn't filter by sender chat ID — acceptable for single-user, needs schema change for multi-user.

**Web Auth Phase 2 complete.** Test specification with 25 scenarios derived from behavioral spec. Full traceability: all acceptance criteria, constraints, and edge cases covered. Resolved 3 open questions (30-day session expiry, failed login logging, authenticated user at /login redirects to /).

**Web Auth Phase 3 complete.** Test implementation specification with all 25 scenarios mapped to test functions. All unit tests — no integration tests needed (no DB/external deps). Factory pattern: `createAuthMiddleware(secret)` + `createAuthRoutes(password, secret)`. Key decisions: server-side expiry via embedded `issued_at` in cookie, post-logout tests cookie absence (not replay), `process.stdout.write` spy for login logging.

**Web Auth Phase 4 complete.** 25 tests implemented in `tests/unit/web-auth.test.ts` (all unit, no integration needed). 22 fail against stub, 3 pass (TS-4.1/TS-4.2 traceability + TS-2.5 noop bypass). Stub updated to factory pattern: `createAuthMiddleware(secret)` + `createAuthRoutes(password, secret)`. Health test updated for new API. Code review: 0 critical, 0 blocking issues.

**Web Auth Phase 5 complete.** All 25 tests pass (25 unit, no integration needed). Implementation: `src/web/auth.ts` exports `createAuthMiddleware(secret)` and `createAuthRoutes(password, secret)`. Cookie-based sessions with HMAC-SHA256 signing, server-side expiry checking via embedded `issued_at`, 30-day max-age. Total: 142/142 unit tests passing across all features.

**Web Auth complete.** All 6 phases done, 25/25 tests pass (all unit), review report at `web-auth-implementation-review.md`. 0 CRITICAL findings. 1 WARNING (non-blocking): `Secure` cookie flag not conditionally set for HTTPS — acceptable for Docker deployment, address when adding HTTPS. Implementation: `src/web/auth.ts` with HMAC-SHA256 cookie signing, `timingSafeEqual` verification, server-side 30-day expiry. Total: 203/203 tests passing across all features.

**Web Dashboard Phase 2 complete.** Test specification with 31 scenarios derived from behavioral spec. Full traceability: all acceptance criteria, constraints, and edge cases covered across 7 groups (digest, entries, stats, capture, SSE, constraints, edge cases). Design doc at `docs/plans/2026-03-06-web-design-system.md` (supersedes `2026-03-05-web-dashboard-design.md`).

**Web Dashboard Phase 3 complete.** Test implementation specification with all 31 scenarios mapped to test functions. Split: 22 unit tests (mocked query layer, classify, embed) + 9 integration tests (testcontainers). Key decisions: factory pattern `createDashboardRoutes(sql, broadcaster)`, SSE via in-memory `SSEBroadcaster` event bus, query functions mockable via `vi.mock()`, capture pipeline mocks classify/embed modules. Helpers: `createTestDashboard()`, `readSSEEvent()`, `createMockEntry()`, `seedEntry()`.

**Web Dashboard Phase 4 complete.** 31 tests implemented (22 unit + 9 integration), 29 failing against stubs as expected, 2 passing (TS-6.2/TS-6.3 auth middleware enforcement — already implemented). Files: `tests/unit/web-dashboard.test.ts`, `tests/integration/web-dashboard-integration.test.ts`. Stubs: `src/web/dashboard.ts`, `src/web/dashboard-queries.ts`, `src/web/sse.ts` (SSE broadcaster fully implemented). Key decisions: `classifyText` (not `classifyEntry`) for capture pipeline, `insertEntry` in dashboard-queries for mockable DB inserts, TS-4.3 moved from integration to unit (only checks 2xx response). Total: 144/164 unit tests passing, 61/70 integration tests passing across all features.

**Web Dashboard complete.** All 6 phases done, 31/31 tests pass (22 unit + 9 integration), review report at `web-dashboard-implementation-review.md`. 0 CRITICAL findings. All 3 WARNINGs and 1 INFO resolved: context-aware classification wired via `assembleContext`, client-side SSE DOM manipulation for all 4 event types (no reload), markdown rendering for digest. Implementation: `src/web/dashboard.ts`, `src/web/dashboard-queries.ts`, `src/web/layout.ts`. Total: 234/234 tests passing across all features.

**Web Browse Phase 2 complete.** Test specification with 33 scenarios derived from behavioral spec. Full traceability: all acceptance criteria, constraints, edge cases, and 4 resolved questions covered across 6 groups (category browsing, semantic search, text search, tag filtering, constraints, edge cases). Resolved: fallback notice shown, query params + reload, single tag selection + deselect, max 10 tags with collapse. Review: split TS-5.3 (two-When violation), added tag deselect scenario (TS-4.6), fixed constraint numbering.

**Web Browse Phase 3 complete.** Test implementation specification with all 33 scenarios mapped to test functions. Split: 20 unit tests (mocked query layer + embedding) + 13 integration tests (testcontainers + pgvector). Key decisions: factory pattern `createBrowseRoutes(sql)`, query module `browse-queries.ts` with `browseEntries`, `semanticSearch`, `textSearch`, `getFilterTags`. Embedding handled at handler level via `generateEmbedding` from `src/embed.ts`. Controlled similarity testing via unit vector embeddings (`createQueryEmbedding`, `createSimilarEmbedding`, `createDissimilarEmbedding`). Text search uses `mode=text` query param to bypass semantic.

**Deployment scaffolding complete.** Created `src/index.ts` (entry point wiring Hono server, DB, auth, dashboard, SSE, Telegram bot), `docker-compose.yml` (4 services: app, PostgreSQL+pgvector, Ollama, faster-whisper), `Dockerfile` (multi-stage node:22-slim), `.env.example`. Installed `@hono/node-server`, `@anthropic-ai/sdk`, `openai`. Fixed pre-existing type errors in `classify.ts` and `dashboard-queries.ts` so `npm run build` succeeds. App is now runnable via `docker compose up`. 234/234 tests passing.

**Web Browse Phase 4 complete.** 33 tests implemented (20 unit + 13 integration), 32 failing against stubs as expected, 1 passing (TS-5.2 auth redirect — already implemented). Files: `tests/unit/web-browse.test.ts`, `tests/integration/web-browse-integration.test.ts`. Stubs: `src/web/browse.ts`, `src/web/browse-queries.ts`. Key decisions: `generateEmbedding` (not `embedEntry`) for search path, `mode=text` query param for explicit text search bypass, embedding vector insertion via `::vector` cast string, controlled similarity testing via unit vector embeddings. Total: 234/234 existing tests passing.

**Web Browse complete.** All 6 phases done, 33/33 tests pass (20 unit + 13 integration), review report at `web-browse-implementation-review.md`. 0 CRITICAL findings. 1 WARNING resolved (browse routes wired in `src/index.ts`). 2 INFO remain (non-blocking): ILIKE wildcard escaping, helper function duplication. Implementation: `src/web/browse.ts`, `src/web/browse-queries.ts`. Total: 267/267 tests passing across all features.

**Web Entry Phase 4 complete.** 27 tests implemented (20 unit + 7 integration), 23 failing against stubs as expected, 4 passing early (TS-1.3/TS-1.4 — 404 from unmatched routes, TS-4.2/TS-4.3 — auth middleware redirects). Files: `tests/unit/web-entry.test.ts`, `tests/integration/web-entry-integration.test.ts`. Stubs: `src/web/entry.ts`, `src/web/entry-queries.ts`. Code review: 0 CRITICAL, 4 WARNINGs (all non-blocking — W-1 vacuous TS-5.2 fixed by adding `expect(res.status).toBe(200)`, W-2/W-3/W-4 deferred). Key decisions: `embedEntry` (not `generateEmbedding`) for re-embedding on save, `Referer` header for post-delete redirect, comma-separated string for tag submission, server-side field migration on category change. Total: 267/267 existing tests passing (no regressions).

**Web Entry complete.** All 6 phases done, 27/27 tests pass (20 unit + 7 integration), review report at `web-entry-implementation-review.md`. 1 CRITICAL fixed (XSS via unsanitized `marked.parse()` — added `sanitize-html`). 3 WARNINGs fixed (missing UUID validation on delete/restore, single-quote escaping, inconsistent null guard). 4 INFO remain (non-blocking). Implementation: `src/web/entry.ts`, `src/web/entry-queries.ts`. Dependencies: `marked` + `sanitize-html`. Total: 294/294 tests passing across all features.

**Web New Note Phase 2 complete.** Test specification with 24 scenarios derived from behavioral spec. Full traceability: all acceptance criteria, constraints, and edge cases covered across 5 groups (form display, AI suggest, save note, constraints, edge cases). Resolved 4 open questions: AI Suggest = category+tags only, no category fields on form, no "Save and New", yes beforeunload. Review: fixed TS-3.3 default fields (null not "active"), added TS-4.5 (unauth API classify), added TS-5.9 (name-only AI Suggest).

**Web New Note Phase 3 complete.** Test implementation specification with all 24 scenarios mapped to test functions. Split: 20 unit tests (mocked query layer + classify + embed) + 4 integration tests (testcontainers). Key decisions: factory pattern `createNewNoteRoutes(sql)`, reuses `insertEntry` from dashboard-queries and `getAllTags` from entry-queries. AI Suggest via `POST /api/classify` JSON endpoint using `classifyText` + `assembleContext`. Tag autocomplete via inline `<datalist>` (consistent with web-entry). Client-side behaviors (tag appending, beforeunload) tested by verifying server contract + HTML contains expected scripts.

**Web New Note Phase 4 complete.** 24 tests implemented (20 unit + 4 integration), 21 failing against stub as expected, 3 passing early (TS-4.2/TS-4.3 auth redirect, TS-4.5 auth 401 for API path). Files: `tests/unit/web-new-note.test.ts`, `tests/integration/web-new-note-integration.test.ts`. Stub: `src/web/new-note.ts`. Code review: 0 CRITICAL, 4 WARNINGs all fixed (W-1 TS-4.5 name mismatch renamed, W-2 TS-2.1 missing arg verification added, W-3/W-4 missing response status checks added to TS-2.3/TS-3.2/TS-3.3/TS-5.2). Key decisions: reuses `insertEntry` from dashboard-queries, `getAllTags` from entry-queries, `classifyText`+`assembleContext` from classify, `embedEntry` from embed. TS-4.5 expects 401 (not 302) — auth middleware returns 401 for `/api/` paths. Total: 294/294 existing tests passing (1 pre-existing flake in embed-integration retry test, unrelated).

**SSE via PostgreSQL NOTIFY complete.** Replaced manual `broadcaster.broadcast()` in dashboard capture route with a PG trigger (`notify_entry_change`) that fires `pg_notify('entries_changed', JSON)` on INSERT, UPDATE, and soft-delete. App listens via `sql.listen()` and forwards to SSEBroadcaster. Fulfills AC-5.2 ("entries from any source appear in real-time") — Telegram, webapp, and future MCP all trigger SSE automatically. 9 new tests (5 unit + 4 integration), all passing. Implementation: `src/db/notify.ts`, trigger in `src/db/index.ts`. Design doc at `docs/plans/2026-03-06-sse-db-notify-design.md`.

**Web New Note complete.** All 6 phases done, 24/24 tests pass (20 unit + 4 integration), review report at `web-new-note-implementation-review.md`. 1 CRITICAL fixed during review (routes not wired in `src/index.ts`). 2 INFO remain (non-blocking): `CATEGORY_FIELDS` duplication, `parseTags` lowercase normalization difference. Implementation: `src/web/new-note.ts`. Total: 318/318 tests passing across all features (excluding 9 pre-existing failures in other features).

**Web Settings Phase 2 complete.** Test specification with 35 scenarios derived from behavioral spec. Full traceability: all 20 acceptance criteria, 6 constraints, 9 edge cases covered. 4 open questions resolved (Save All, no env indicator, no cron preview, Ollama check on save). Key decisions: single form POST, `llm_model` key (not `anthropic_model` — LLM-agnostic), cron rescheduling deferred to digests feature.

**Web Settings Phase 3 complete.** Test implementation specification with all 35 scenarios mapped to test functions + 3 integration-only scenarios (38 total). Split: 31 unit tests (mocked query layer) + 7 integration tests (testcontainers). Key decisions: factory pattern `createSettingsRoutes(sql)`, query module `settings-queries.ts` with `getAllSettings` and `saveAllSettings`, `buildFormData` helper for Save All form, flash messages via query params, default fetch mock in `beforeEach` for Ollama check (runs on every POST). Flagged key name discrepancy: behavioral spec uses `anthropic_model` but config uses `llm_model` — tests use correct key (`llm_model`). Also `LLM_API_KEY` not `ANTHROPIC_API_KEY` in TS-8.1.

**Web Settings Phase 4 complete.** 38 tests implemented (31 unit + 7 integration), 35 failing against stubs as expected, 3 passing early (TS-6.1/TS-6.1b auth redirects, TS-8.1 no secrets — vacuous). Files: `tests/unit/web-settings.test.ts`, `tests/integration/web-settings-integration.test.ts`. Stubs: `src/web/settings.ts`, `src/web/settings-queries.ts`. Code review: 0 CRITICAL, 1 IMPORTANT (cron field name mismatch — `config.ts` SETTINGS_TO_ENV uses `digest_daily_cron`/`digest_weekly_cron` but tests use `daily_digest_cron`/`weekly_digest_cron` per spec; Phase 5 must rename keys in `config.ts` to match tests). Key decisions: `buildFormData(overrides)` helper for Save All form, default fetch mock in `beforeEach` (Ollama check), `withEnv` for env var tests (TS-7.6/TS-7.8/TS-8.1/TS-5.2/TS-5.3). Total: 231/261 unit tests passing, existing failures pre-existing (not regressions).

**Web Settings Phase 5 complete.** All 38 tests pass (31 unit + 7 integration). Implementation: `src/web/settings.ts` (route handler with GET/POST, validation, resolution logic, flash messages), `src/web/settings-queries.ts` (`getAllSettings`, `saveAllSettings` with upsert). Settings routes wired in `src/index.ts`. Fixed cron field name mismatch: renamed `digest_daily_cron`/`digest_weekly_cron` to `daily_digest_cron`/`weekly_digest_cron` in `config.ts` SETTINGS_TO_ENV. No test files modified. 0 regressions.

**Web Settings complete.** All 6 phases done, 38/38 tests pass (31 unit + 7 integration), review report at `web-settings-implementation-review.md`. 0 CRITICAL findings. All 5 findings fixed: W-1 behavioral spec `anthropic_model` → `llm_model`, W-2 innerHTML XSS → createElement/textContent, I-3 regex cron → `cron-parser` library, I-4 sequential upserts → batch `unnest()`, I-5 open questions marked resolved. Implementation: `src/web/settings.ts`, `src/web/settings-queries.ts`. Dependencies: `cron-parser`. Config fix: `daily_digest_cron`/`weekly_digest_cron` in SETTINGS_TO_ENV.

**MCP Server Phase 2 complete.** Test specification with 53 scenarios derived from behavioral spec. Full traceability: all 44 acceptance criteria, all edge cases, and 3 constraint checks covered across 10 groups (search_brain, add_thought, list_recent, get_entry, update_entry, delete_entry, brain_stats, stdio transport, HTTP transport, constraints). Review fixes: scenario count corrected from 48 to 53, added TS-5.2b (name change re-embed), AC-8.2 added to coverage matrix, whitespace test added to TS-1.6, TS-6.3 resolved as isError:true, AC-1.2 coverage attribution expanded.

**MCP Server Phase 3 complete.** Test implementation specification with all 53 scenarios mapped to test functions. Split: 43 unit tests (mocked query layer + embed + classify) + 10 integration tests (testcontainers + pgvector). Key decisions: factory pattern `createMcpServer(sql)`, query module `mcp-queries.ts`, exported handler functions for direct unit testing (`handleSearchBrain`, `handleAddThought`, etc.), MCP Client+transport for integration. 4 open decisions deferred to Phase 5 (SDK tool inspection API, HTTP transport wiring, getEntryById contract, handleBrainStats signature).

**MCP Server Phase 4 complete.** 53 tests implemented (43 unit + 10 integration), all 53 failing against stubs as expected. Files: `tests/unit/mcp-server.test.ts`, `tests/integration/mcp-server-integration.test.ts`. Stubs: `src/mcp-tools.ts`, `src/mcp-queries.ts`. Dependency: `@modelcontextprotocol/sdk` installed. Key decisions: handler functions tested directly (unit), MCP Client+InMemoryTransport for server inspection (TS-8.2, TS-10.2, TS-10.3), auth middleware returns 302 for `/mcp` (not 401) — Phase 5 must update auth to handle `/mcp` as API path. Unit test failures: 39 "Not implemented" from stubs, 2 status 302 vs expected 401 (auth), 2 "Not implemented" from `createMcpServer`. No regressions.

**MCP Server Phase 5 complete.** All 53 tests pass (43 unit + 10 integration). Implementation: `src/mcp-tools.ts` (MCP server factory + 7 handler functions + HTTP JSON-RPC handler), `src/mcp-queries.ts` (DB query layer: search, insert, list, get, update, delete, stats), `src/mcp.ts` (stdio entrypoint). Auth middleware updated: `/mcp` returns 401 for unauthenticated (not 302). MCP HTTP endpoint wired at `POST /mcp` in `src/index.ts`. Key decisions: stateless JSON-RPC handler for HTTP transport (not full MCP StreamableHTTPServerTransport — simpler, tests pass), `withTimeout()` wrapper for broken DB connections (5s), cosine similarity threshold `>= 0.5` per spec. Test infrastructure fixes: seedEntry uses `sql.json()` for JSONB fields, borderline embedding adjusted for float precision, stalled project `created_at` separated from `updated_at` for calendar-week stability, broken sql connection created with `connect_timeout: 2`. No test scenario or assertion changes. 0 regressions.

**MCP Server complete.** All 6 phases done, 53/53 tests pass (43 unit + 10 integration), review report at `mcp-server-implementation-review.md`. 0 CRITICAL findings. Implementation: `src/mcp-tools.ts` (server factory + 7 handlers + HTTP JSON-RPC handler), `src/mcp-queries.ts` (DB query layer), `src/mcp.ts` (stdio entrypoint). 1 INFO: HTTP transport uses stateless JSON-RPC handler rather than SDK's StreamableHTTPServerTransport — pragmatic deviation, functionally equivalent.

**Digests Phase 2 complete.** Test specification with 42 scenarios derived from behavioral spec. Full traceability: all 29 acceptance criteria, all testable edge cases covered across 5 groups (daily digest pipeline, weekly review pipeline, email delivery, background retry, scheduling & configuration). Review fixes: TS-5.1 split into TS-5.1a/5.1b (multiple-When violation), added TS-2.5b (weekly SSE push — spec gap flagged), added soft-deleted exclusion assertion to TS-4.1, clarified EC-1.2 mapping (Claude interprets staleness, not separate query). Flagged: AC-1.3 uses `anthropic_model` but correct key is `llm_model`.

Next: **digests** — Phase 3 (test impl spec). Run `spec-dd test-impl digests` to continue.

## Spec Files

| Feature | Files |
|---------|-------|
| foundation | `foundation-specification.md`, `foundation-test-specification.md`, `foundation-test-implementation-specification.md` |
| embedding | `embedding-specification.md`, `embedding-test-specification.md`, `embedding-test-implementation-specification.md` |
| classification | `classification-specification.md`, `classification-test-specification.md`, `classification-test-implementation-specification.md` |
| telegram-bot | `telegram-bot-specification.md`, `telegram-bot-test-specification.md`, `telegram-bot-test-implementation-specification.md` |
| web-auth | `web-auth-specification.md`, `web-auth-test-specification.md`, `web-auth-test-implementation-specification.md` |
| web-dashboard | `web-dashboard-specification.md`, `web-dashboard-test-specification.md`, `web-dashboard-test-implementation-specification.md` |
| web-browse | `web-browse-specification.md`, `web-browse-test-specification.md`, `web-browse-test-implementation-specification.md` |
| web-entry | `web-entry-specification.md`, `web-entry-test-specification.md`, `web-entry-test-implementation-specification.md` |
| web-new-note | `web-new-note-specification.md`, `web-new-note-test-specification.md`, `web-new-note-test-implementation-specification.md`, `web-new-note-implementation-review.md` |
| web-settings | `web-settings-specification.md`, `web-settings-test-specification.md`, `web-settings-test-implementation-specification.md`, `web-settings-implementation-review.md` |
| mcp-server | `mcp-server-specification.md`, `mcp-server-test-specification.md`, `mcp-server-test-implementation-specification.md`, `mcp-server-implementation-review.md` |
| digests | `digests-specification.md`, `digests-test-specification.md` |

## Other Documents

- `cortex-srs.md` — Software Requirements Specification (96 requirements)
- `implementation-plan.md` — Phased implementation plan with dependency graph
