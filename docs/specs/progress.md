# Spec-DD Progress Tracker

Last updated: 2026-03-05

## Feature Status

| Feature | Phase 1: Spec | Phase 2: Test Spec | Phase 3: Test Impl Spec | Phase 4: Tests | Phase 5: Code | Phase 6: Review |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| foundation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| embedding | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| classification | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| telegram-bot | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| web-auth | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| web-dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| web-browse | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| web-entry | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| web-new-note | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
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

**Web Dashboard Phase 2 complete.** Test specification with 31 scenarios derived from behavioral spec. Full traceability: all acceptance criteria, constraints, and edge cases covered across 7 groups (digest, entries, stats, capture, SSE, constraints, edge cases). Design doc at `docs/plans/2026-03-05-web-dashboard-design.md`.

**Web Dashboard Phase 3 complete.** Test implementation specification with all 31 scenarios mapped to test functions. Split: 22 unit tests (mocked query layer, classify, embed) + 9 integration tests (testcontainers). Key decisions: factory pattern `createDashboardRoutes(sql, broadcaster)`, SSE via in-memory `SSEBroadcaster` event bus, query functions mockable via `vi.mock()`, capture pipeline mocks classify/embed modules. Helpers: `createTestDashboard()`, `readSSEEvent()`, `createMockEntry()`, `seedEntry()`.

**Web Dashboard Phase 4 complete.** 31 tests implemented (22 unit + 9 integration), 29 failing against stubs as expected, 2 passing (TS-6.2/TS-6.3 auth middleware enforcement — already implemented). Files: `tests/unit/web-dashboard.test.ts`, `tests/integration/web-dashboard-integration.test.ts`. Stubs: `src/web/dashboard.ts`, `src/web/dashboard-queries.ts`, `src/web/sse.ts` (SSE broadcaster fully implemented). Key decisions: `classifyText` (not `classifyEntry`) for capture pipeline, `insertEntry` in dashboard-queries for mockable DB inserts, TS-4.3 moved from integration to unit (only checks 2xx response). Total: 144/164 unit tests passing, 61/70 integration tests passing across all features.

**Web Dashboard complete.** All 6 phases done, 31/31 tests pass (22 unit + 9 integration), review report at `web-dashboard-implementation-review.md`. 0 CRITICAL findings. All 3 WARNINGs and 1 INFO resolved: context-aware classification wired via `assembleContext`, client-side SSE DOM manipulation for all 4 event types (no reload), markdown rendering for digest. Implementation: `src/web/dashboard.ts`, `src/web/dashboard-queries.ts`, `src/web/layout.ts`. Total: 234/234 tests passing across all features.

**Web Browse Phase 2 complete.** Test specification with 33 scenarios derived from behavioral spec. Full traceability: all acceptance criteria, constraints, edge cases, and 4 resolved questions covered across 6 groups (category browsing, semantic search, text search, tag filtering, constraints, edge cases). Resolved: fallback notice shown, query params + reload, single tag selection + deselect, max 10 tags with collapse. Review: split TS-5.3 (two-When violation), added tag deselect scenario (TS-4.6), fixed constraint numbering.

Next: **web-browse** — Phase 3 (test implementation specification). Run `spec-dd web-browse` to continue.

## Spec Files

| Feature | Files |
|---------|-------|
| foundation | `foundation-specification.md`, `foundation-test-specification.md`, `foundation-test-implementation-specification.md` |
| embedding | `embedding-specification.md`, `embedding-test-specification.md`, `embedding-test-implementation-specification.md` |
| classification | `classification-specification.md`, `classification-test-specification.md`, `classification-test-implementation-specification.md` |
| telegram-bot | `telegram-bot-specification.md`, `telegram-bot-test-specification.md`, `telegram-bot-test-implementation-specification.md` |
| web-auth | `web-auth-specification.md`, `web-auth-test-specification.md`, `web-auth-test-implementation-specification.md` |
| web-dashboard | `web-dashboard-specification.md`, `web-dashboard-test-specification.md`, `web-dashboard-test-implementation-specification.md` |
| web-browse | `web-browse-specification.md`, `web-browse-test-specification.md` |
| web-entry | `web-entry-specification.md` |
| web-new-note | `web-new-note-specification.md` |
| web-settings | `web-settings-specification.md` |
| mcp-server | `mcp-server-specification.md` |
| digests | `digests-specification.md` |

## Other Documents

- `cortex-srs.md` — Software Requirements Specification (96 requirements)
- `implementation-plan.md` — Phased implementation plan with dependency graph
