# System Status — Implementation Review

| Field | Value |
|-------|-------|
| Feature | system-status |
| Date | 2026-04-15 |
| Status | PASS |

## Scope

- Feature: surface the readiness of Cortex's internal dependencies (PostgreSQL, Ollama, Whisper, Telegram) via a refactored `/health` endpoint, footer status dots on every authenticated page, and a server-rendered dismissable "warming up" banner when services are still loading.
- Implementation files: `src/web/service-checkers.ts` (new, 229 lines), `src/web/health.ts` (updated, 39 lines), `src/web/layout.ts` (updated, 251 lines), `src/web/system-status-client.src.js` (new, 92 lines), `docker-compose.yml` (updated). Page handlers updated to pass `healthStatus` to `renderLayout`: `dashboard.ts`, `browse.ts`, `entry.ts`, `new-note.ts`, `settings.ts`. Wired in `src/index.ts` via `createServiceCheckers`.
- Spec artifacts: `system-status-specification.md` (5 user stories, 22 ACs, 16 ECs, 10 NGs, 8 constraints), `system-status-test-specification.md` (45 scenarios, full coverage matrix), `system-status-test-implementation-specification.md` (6 test files, sandbox helper, mock-sql helper).
- Tests: 60 total -- 30 unit (`health.test.ts`) + 14 unit (`layout-status.test.ts`) + 8 unit (`system-status-client.test.ts`) + 3 unit (`docker-compose.test.ts`) + 2 unit (`system-status-constraints.test.ts`) + 3 integration (`system-status-integration.test.ts`). All passing.

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec -> Test Spec coverage | PASS | All 22 ACs (AC-1.1 through AC-5.3), all 16 ECs (EC-1 through EC-16), all 8 testable constraints (C-1 through C-8), and the testable non-goals (NG-1, NG-3, NG-6) map to at least one TS scenario in the coverage matrix. The remaining NGs (NG-2, NG-4, NG-5, NG-7, NG-8, NG-9, NG-10) are verified by absence of corresponding code. |
| Test Spec -> Spec traceability | PASS | All 45 TS scenarios (TS-1.1 through TS-10.7) trace to specific ACs, ECs, Cs, or NGs. No orphan scenarios. The test spec's traceability section explicitly asserts completeness. |
| Test Spec -> Test Impl Spec coverage | PASS | Every TS-x.x has a corresponding subsection in the test impl spec with concrete setup, action, and assertion patterns. All 6 test files planned in the impl spec were created. |
| Test Impl Spec -> Test Spec (no orphans) | PASS | All test impl entries use exact TS IDs as section headers. No extraneous entries. |
| Spec constraints respected | PASS | C-1 (vanilla JS only): client script uses no framework imports. C-2 (footer in layout.ts, banner inline): footer and banner rendered in `layout.ts` on every server-side page. C-3 (no new npm deps): verified by TS-10.3 snapshot test. C-4 (no inline styles): no `style="` in `layout.ts`, `service-checkers.ts`, or `system-status-client.src.js`. C-5 (`/health` is single source of truth): client script polls `/health`, layout reads from health status object. C-6 (server-render bounded by 3s timeout): `getServiceStatus` uses `withTimeout` at 3s per check, parallel execution. C-7 (independent 3s timeouts): each checker uses `AbortSignal.timeout(3000)` for fetch plus `withTimeout` wrapper. C-8 (old health tests updated): legacy `health.test.ts` fully replaced. |
| Non-goals respected | PASS | NG-1 (no persistent dismissal): dismissal is DOM-only, per page load. NG-2 (no SSE): polling only. NG-3 (no tri-state): binary ready/not-ready. NG-4 (no history): stateless checks. NG-5 (no docker socket): HTTP checks only. NG-6 (no new tables): verified by TS-10.7. NG-7 (no configurable interval): 10s hardcoded. NG-8 (no dismissible footer): footer always rendered. NG-9 (no retry/backoff): same 10s interval on failure. NG-10 (no caching): verified by integration test. |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Spec | PASS | All 45 TS scenarios are implemented as test functions with their exact TS IDs in the `it()` description. Test file groupings match the test spec's file plan. TS-7.1 is tested both at the checker level (health.test.ts) and the endpoint level (extra test in Group 8) for defense in depth. |
| Test code vs Test Impl Spec | PASS | Test functions follow the setup/action/assertion patterns specified. The `vm` sandbox approach, mock-sql helper, and fake-health factory all match the impl spec. Minor acceptable deviation: `layout-footer.ts` was not created as a separate module (spec planned it as extracted); instead footer/banner rendering is inlined in `layout.ts`. This is a simplification that does not affect test coverage. |
| Feature code vs Behavioral Spec | PASS | All ACs verified. See detailed walkthrough below. |
| Undocumented behavior | PASS | No significant undocumented behavior. The `getServiceStatus` aggregate helper creates a fresh `createServiceCheckers` instance on each call rather than reusing the app-level instance, which is a minor implementation choice consistent with the spec's NG-10 (no caching). |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests (feature) | 60 |
| Passed | 60 |
| Failed | 0 |
| Skipped | 0 |
| Full-suite regression | 824/824 passing (667 unit + 157 integration) |
| TypeScript | `tsc --noEmit` clean |

## Detailed AC Walkthrough

### US-1: First-boot visibility

- **AC-1.1 (footer indicators):** `renderFooter()` in `layout.ts` iterates `SERVICE_ORDER = ["postgres", "ollama", "whisper", "telegram"]`, rendering a colored dot with `data-status-dot="<service>"` and the service label. Telegram is conditionally filtered when `healthStatus.telegram === undefined`. Tested by TS-1.1, TS-1.2.
- **AC-1.2 (ready vs not-ready styling):** Ready dot uses `bg-primary animate-pulse`, not-ready uses `bg-destructive` (no pulse). Constants `READY_DOT_CLASS` and `NOT_READY_DOT_CLASS` enforce this. Tested by TS-1.3, TS-1.4.
- **AC-1.3 (dismissable banner with details):** `renderBanner()` calls `collectNotReady()` which iterates `SERVICE_ORDER`, skipping undefined telegram, collecting `{key, detail}` pairs for not-ready services. Banner renders with `data-status-banner="true"`, each service on its own line with the detail string. Tested by TS-2.1, TS-2.2, TS-2.9.
- **AC-1.4 (dismiss control):** Banner contains `<button id="status-banner-dismiss">` which the client script wires via `wireDismiss()`. Click detaches the banner via `removeChild`. Tested by TS-2.3, TS-2.4.
- **AC-1.5 (footer updates after dismiss):** Client script's `applyHealth()` function updates dots independently of banner existence. Tested by TS-2.5.

### US-2: Continuous updates

- **AC-2.1 (10s polling):** Client script sets `setInterval(poll, 10000)`. Tested by TS-3.1.
- **AC-2.2 (poll updates dots):** `applyHealth()` iterates `body.services`, calling `updateDot(key, entry.ready === true)`. Tested by TS-3.2.
- **AC-2.3 (failed poll retains state):** `poll()` wraps fetch in try/catch with empty catch body. `.then()` chain has `.catch(() => {})`. Tested by TS-3.3 (network error) and TS-3.4 (HTTP 500).
- **AC-2.4 (update within 100ms):** DOM updates are synchronous within the fetch `.then()` chain -- no `setTimeout` or microtask delay. Tested by TS-3.5.

### US-3: Per-service readiness semantics

- **AC-3.1 (Postgres):** `checkPostgres()` runs `sql\`SELECT 1\`` with try/catch. Returns `"Database unreachable"` on failure. Tested by TS-4.1, TS-4.2.
- **AC-3.2 (Ollama embedding model):** `checkOllama()` fetches `${ollamaUrl}/api/tags` with `AbortSignal.timeout(3000)`, parses `models` array, checks for `name.includes("qwen3-embedding")`. Tested by TS-5.1, TS-5.2, TS-5.3, TS-5.4.
- **AC-3.3 (conditional classification model):** `isSameHost()` compares `new URL(ollamaUrl).host` with `new URL(llmBaseUrl).host`. When hosts match and `llmModel` is non-empty, checks for `name.includes(llmModel)`. Embedding-missing takes precedence (checked first). Tested by TS-5.5, TS-5.6, TS-5.7.
- **AC-3.4 (unrelated LLM):** When `llmBaseUrl` is empty or points to a different host, classification check is skipped. `isSameHost` returns false for empty strings or different hosts. Tested by TS-5.8, TS-5.9.
- **AC-3.5 (no llm_model):** The `deps.llmModel &&` guard short-circuits the classification check when model is empty. Tested by TS-5.10.
- **AC-3.6 (Whisper):** `checkWhisper()` fetches `${whisperUrl}/health` with `AbortSignal.timeout(3000)`. Returns "Loading Whisper model..." on any fetch exception (ECONNREFUSED, timeout), "Whisper unreachable" on non-200 status. Tested by TS-6.1, TS-6.2, TS-6.3.
- **AC-3.7 (Telegram):** `checkTelegram()` returns `null` when `telegramBotToken` is empty. Returns `ready: true` when `isBotRunning()` is true, otherwise not-ready with `"Telegram bot stopped or crashed"`. Null is filtered by health endpoint (`if (telegram !== null)`) and by layout rendering (`filter`). Tested by TS-7.1, TS-7.2, TS-7.3.

### US-4: Health endpoint

- **AC-4.1 (response shape):** Returns `{ status, services, uptime }`. Tested by TS-8.1.
- **AC-4.2 (services shape):** Each value has `{ ready: boolean, detail: string | null }`. Telegram omitted when null. Tested by TS-8.2.
- **AC-4.3 (status logic):** `const status = postgres.ready ? "ok" : "degraded"`. This correctly implements the spec: status is "degraded" only when Postgres is down; non-Postgres service failures do not affect status. Tested by TS-8.4, TS-8.5, TS-8.6.
- **AC-4.4 (no auth required):** `/health` is exempted in `auth.ts` via `if (path === "/health")` check. Tested by TS-8.7.
- **AC-4.5 (3s timeout, parallel):** `withTimeout()` wraps each checker promise with a 3s fallback. `Promise.all()` runs checks in parallel. Tested by TS-8.8 (slow check), TS-8.9 (parallel proof).
- **AC-4.6 (uptime):** `getUptime()` returns `Math.floor((Date.now() - startTime) / 1000)`. Tested by TS-8.10.

### US-5: Docker Compose

- **AC-5.1 (PRELOAD_MODELS):** `docker-compose.yml` whisper service has `PRELOAD_MODELS: '["Systran/faster-whisper-medium"]'`. Tested by TS-9.1.
- **AC-5.2 (healthcheck block):** Present with correct test command, interval 15s, timeout 10s, retries 20, start_period 300s. Tested by TS-9.2.
- **AC-5.3 (service_started condition):** `depends_on.whisper.condition: service_started`. Tested by TS-9.3.

## Coverage Report

### Gaps

None. All 22 ACs, 16 ECs, 8 testable constraints, and 3 testable non-goals have corresponding test scenarios that are implemented and passing.

### Misalignments

- **Test impl spec planned `src/web/layout-footer.ts` as a separate extracted module.** The implementation keeps `renderFooter()` and `renderBanner()` as private functions within `layout.ts` rather than extracting them. This is a simplification that does not affect test coverage or spec compliance. The test impl spec's TS-10.2 assertion (`expect(readFile("src/web/layout.ts")).toContain("renderFooter")`) passes correctly.

### Unresolved Items

None. No `[NEEDS CLARIFICATION]` markers in any spec artifact.

## Findings

| # | Severity | Layer | Description | Status |
|---|----------|-------|-------------|--------|
| F-1 | INFO | Feature code | **`getServiceStatus` creates a fresh `createServiceCheckers` instance on each call** rather than accepting the app-level `checkers` instance. This means each page render creates new closures and re-reads LLM config / settings from DB. This is functionally correct (consistent with NG-10: no caching) but adds a small per-request overhead. For the current single-user use case, this is negligible. If performance becomes a concern, the function signature could accept an existing `ServiceCheckers` instance. | DOCUMENTED |
| F-2 | INFO | Feature code | **`isSameHost()` compares `URL.host` (host+port) not `URL.hostname` (host only).** This is correct per AC-3.3 which explicitly says "host+port equals the host+port of OLLAMA_URL". The implementation matches the spec. | VERIFIED |
| F-3 | INFO | Feature code | **The `withTimeout` wrapper in `service-checkers.ts` duplicates the `TIMEOUT_STATUS` constant also defined in `health.ts`.** Both files define `const TIMEOUT_STATUS: ServiceStatus = { ready: false, detail: "Service check timed out" }`. Minor DRY violation. Consider exporting it from one location. | DOCUMENTED |
| F-4 | INFO | Test code | **Test impl spec planned `tests/helpers/fake-health.ts` with 3 factory functions**; the implementation provides 7 (`fakeHealthAllReady`, `fakeHealthWhisperLoading`, `fakeHealthOllamaDownloading`, `fakeHealthBothDownloading`, `fakeHealthPostgresDown`, `fakeHealthNoTelegram`, `fakeHealthNoTelegramWhisperLoading`). The additional factories are helpful for test clarity. No downside. | DOCUMENTED |
| F-5 | INFO | Feature code | **`browse.ts` calls `getServiceStatus` after the main query work is complete** (line 318) rather than in parallel with other async calls. This adds the health-check latency to the browse page load sequentially. The dashboard handler (`dashboard.ts` line 562) correctly runs `getServiceStatus` in `Promise.all` alongside other data fetches. The browse handler could be optimized similarly, though the impact is minimal given the 3s timeout and typical sub-100ms check response times. | DOCUMENTED |
| F-6 | INFO | Spec deviation | **`layout-footer.ts` not created as a separate module.** The test impl spec (line 51) planned `src/web/layout-footer.ts` as a "new (extracted)" module exporting `renderFooter(healthStatus)` and `renderBanner(healthStatus)`. The implementation inlines these as private functions in `layout.ts`. This is an acceptable simplification -- all tests pass, and the functions are testable through the public `renderLayout` interface. | DOCUMENTED |
| F-7 | INFO | Feature code | **Client script calls `poll()` immediately on init** (line 83 of `system-status-client.src.js`), then sets up the interval. This means the first poll happens at T=0, not T=10s. This is a good UX choice -- the server-rendered state is immediately verified. The test spec TS-3.1 accounts for this by expecting `fetch` to be called once before the first interval tick. | VERIFIED |

## Summary

The system-status feature is well-implemented and fully aligned with all three specification artifacts. All 22 acceptance criteria are correctly implemented. All 60 tests pass, covering every scenario in the test specification. The code follows the project's established patterns (dependency injection, Tailwind-only styling, vanilla JS client, no new dependencies). The `withTimeout` + `Promise.all` approach correctly bounds health check latency to 3 seconds even when services are unreachable.

No CRITICAL or WARNING findings. All findings are INFO-level documentation notes or minor observations.
