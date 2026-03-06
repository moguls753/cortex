# Spec-DD Progress Tracker

Last updated: 2026-03-06

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
| web-new-note | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| web-settings | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| mcp-server | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| digests | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

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

Next: **web-new-note** — Phase 4 (test implementation). Run `spec-dd web-new-note` to continue.

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
| web-new-note | `web-new-note-specification.md`, `web-new-note-test-specification.md`, `web-new-note-test-implementation-specification.md` |
| web-settings | `web-settings-specification.md` |
| mcp-server | `mcp-server-specification.md` |
| digests | `digests-specification.md` |

## Other Documents

- `cortex-srs.md` — Software Requirements Specification (96 requirements)
- `implementation-plan.md` — Phased implementation plan with dependency graph
