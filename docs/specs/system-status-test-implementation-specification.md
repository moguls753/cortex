# System Status — Test Implementation Specification

Implements the test scenarios from `system-status-test-specification.md` on top of the project's existing Vitest + testcontainers + postgres.js stack.

## Test Framework & Conventions

- **Runtime:** Node 21.7.2, ESM (`"type": "module"` in package.json).
- **Framework:** [Vitest](https://vitest.dev) 3.x — already the project standard.
- **Assertion style:** `expect(...)` from Vitest. No Chai, no Jest-compat.
- **Mocking:**
  - `vi.mock("module-path", () => ({ ... }))` for module-level mocks of queries/config.
  - `vi.spyOn(globalThis, "fetch")` for HTTP mocking — established pattern, no MSW, no nock.
  - `vi.useFakeTimers()` for timing-sensitive tests.
- **Integration:** `testcontainers` running `pgvector/pgvector:pg16`. Matches `tests/helpers/pg-container.ts` (existing).
- **Test layout:** `tests/unit/*.test.ts` and `tests/integration/*.test.ts` (existing convention).
- **No new npm dependencies.** All tests use existing dev deps only.

## Test Structure

### Files

| File | Purpose | Scenarios |
|---|---|---|
| `tests/unit/health.test.ts` | `/health` route + all four service checkers + response shape (replaces existing file) | TS-4.1–4.2, TS-5.1–5.10, TS-6.1–6.3, TS-7.1–7.3, TS-8.1–8.10, TS-10.6 |
| `tests/unit/layout-status.test.ts` | Server-side footer + banner rendering via `renderLayout` | TS-1.1–1.4, TS-2.1–2.9, TS-10.1, TS-10.2, TS-10.4, TS-10.5 |
| `tests/unit/system-status-client.test.ts` | Client-side polling script executed in a Node `vm` sandbox with mocked `document`, `fetch`, `setInterval` | TS-3.1–3.5 |
| `tests/unit/docker-compose.test.ts` | Parses `docker-compose.yml` as text and asserts required keys/values | TS-9.1–9.3 |
| `tests/unit/system-status-constraints.test.ts` | Cross-cutting constraint and non-goal absence-checks | TS-10.3, TS-10.7 |
| `tests/integration/system-status-integration.test.ts` | End-to-end `/health` with real Postgres + mocked HTTP | TS-3.6 (confirms per-tab independence via sequential calls), smoke test |

TS-3.6 (multi-tab polling) is not testable as a browser concurrency scenario in a unit runner; the integration test exercises sequential client calls and confirms each call is independent and stateless (no cross-call deduplication), which is the underlying property.

### Naming

- Files: kebab-case, `*.test.ts`.
- `describe` blocks: one per Group from the test specification (e.g. `"Group 1 — Footer indicator rendering"`).
- `it` blocks: `"<TS-ID> — <scenario title>"`, e.g. `it("TS-1.1 — footer renders one indicator per configured service", ...)`.

This lets a failing test report its TS-ID so the mapping to the spec is one search away.

## Source Modules Under Test

Tests exercise these production modules — some existing, some new:

| Module | Status | Exports (planned) |
|---|---|---|
| `src/web/service-checkers.ts` | new | `type ServiceStatus = { ready: boolean; detail: string | null }`; `checkPostgres(sql)`, `checkOllama(deps)`, `checkWhisper(url)`, `checkTelegram(deps)`, `createServiceCheckers(deps)`, `getServiceStatus(sql)` (aggregate for render) |
| `src/web/health.ts` | updated | `createHealthRoute(checkers)` — response shape updated to `{ status, services, uptime }` |
| `src/web/layout.ts` | updated | `renderLayout(title, content, activePage, healthStatus)` — new optional parameter |
| `src/web/layout-footer.ts` | new (extracted) | `renderFooter(healthStatus)`, `renderBanner(healthStatus)` — pure functions returning HTML strings |
| `public/system-status-client.js` | new, gitignored build artifact | vanilla JS polling script, generated from `src/web/system-status-client.src.js` |
| `src/web/system-status-client.src.js` | new | the raw polling script loaded by `layout.ts` at render time via `readFileSync`, inlined into the `<script>` tag |
| `src/index.ts` | updated | imports `createServiceCheckers` and `getServiceStatus`, calls `getServiceStatus` in the page-render route handlers |
| `docker-compose.yml` | updated | new `PRELOAD_MODELS`, new `healthcheck` on whisper |

### Why inline the client script from a source file?

The polling script must be (a) unit-testable in Node and (b) identical to what ships to the browser. Options considered:

- Inline template literal in `layout.ts` → cannot be tested in isolation.
- Separate `.ts` module compiled to `dist/` → not served by the static file middleware.
- Standalone `.js` file in `public/` served via `<script src="/public/system-status-client.js">` → works, but then `layout.ts` can't pre-configure it.

Chosen approach: keep the raw JS in `src/web/system-status-client.src.js`, read it at module load time via `readFileSync`, inline it inside a `<script>` block in `layout.ts`. Unit tests read the exact same file and execute it in a Node `vm` sandbox. Drift is impossible because the same bytes are used on the server and in the test harness.

## Test Scenario Mapping

### Group 1: Footer indicator rendering (`tests/unit/layout-status.test.ts`)

| Scenario | Test function |
|---|---|
| TS-1.1 | `"TS-1.1 — footer renders one indicator per configured service"` |
| TS-1.2 | `"TS-1.2 — footer omits Telegram indicator when Telegram is unconfigured"` |
| TS-1.3 | `"TS-1.3 — ready indicator renders with pulsing primary dot"` |
| TS-1.4 | `"TS-1.4 — not-ready indicator renders with non-pulsing destructive dot"` |

**Setup:** Call `renderLayout("title", "<main>content</main>", "/", fakeHealthStatus)` directly. `fakeHealthStatus` is an object literal matching the `HealthStatus` type.

**Action:** None beyond the render call.

**Assertion:** Use `cheerio` — wait, that's a new dep. Use string matching against the rendered HTML via `toContain`, `toMatch(/regex/)`, or count occurrences via `(html.match(pattern) || []).length`. This project already parses HTML via string matching in `web-dashboard` and `web-entry` tests — consistent pattern.

**Concrete assertions:**
- TS-1.1: Assert `html` contains one span with text matching `/>\s*postgres\s*</`, one for `ollama`, one for `whisper`, one for `telegram`. Count via `.match(/\bpostgres\b/g)` then check exact four occurrences in the footer section.
- TS-1.2: Assert no substring `>telegram<` appears in the footer. Count `postgres|ollama|whisper` = 3.
- TS-1.3: When every service is `ready: true`, assert each dot's class string includes both `bg-primary` and `animate-pulse`.
- TS-1.4: When whisper is `ready: false`, assert the whisper dot class string includes `bg-destructive` and does NOT include `animate-pulse`. Other dots still include `bg-primary animate-pulse`.

### Group 2: Banner rendering and dismissal (`tests/unit/layout-status.test.ts`)

| Scenario | Test function |
|---|---|
| TS-2.1 | `"TS-2.1 — banner renders on initial page load with not-ready services"` |
| TS-2.2 | `"TS-2.2 — banner is present in server-rendered HTML above content"` |
| TS-2.3 | `"TS-2.3 — banner dismiss button removes banner from DOM"` |
| TS-2.4 | `"TS-2.4 — dismissed banner does not reappear during same page load"` |
| TS-2.5 | `"TS-2.5 — after dismissal, footer dots still update on state change"` |
| TS-2.6 | `"TS-2.6 — banner absent when all services ready"` |
| TS-2.7 | `"TS-2.7 — banner omits Telegram line when Telegram unconfigured"` |
| TS-2.8 | `"TS-2.8 — reloading after dismissal re-evaluates banner state"` |
| TS-2.9 | `"TS-2.9 — banner appears after onboarding redirect with downloads pending"` |

**Setup and strategy:**

- TS-2.1, TS-2.2, TS-2.6, TS-2.7, TS-2.8, TS-2.9 test the pure HTML output of `renderLayout`. Setup is a fake `healthStatus` object; assertion is substring/regex on the returned HTML.
- TS-2.3, TS-2.4, TS-2.5 test client-side dismiss behavior — they execute the client script in the `vm` sandbox and simulate `click` events on a mocked dismiss button. See Group 3 test infrastructure.

**Concrete assertions:**

- **TS-2.1:** `healthStatus = { whisper: {ready: false, detail: "Loading Whisper..."}, ollama: {ready: false, detail: "Downloading embedding model..."}, postgres: {ready: true, detail: null} }`. Assert HTML contains banner element (a `data-status-banner="true"` attribute on a `<div>`), and contains both detail strings verbatim.
- **TS-2.2:** Split rendered HTML at `<main`. Assert banner substring appears before `<main`. Also assert banner doesn't appear inside a `<script>` tag (sanity check that it's real DOM, not JS-injected).
- **TS-2.3:** Load script in sandbox, create mock DOM with banner + dismiss button. Fire click on the dismiss button. Assert `banner.parentNode.removeChild(banner)` was called OR banner element's parent children don't include banner anymore.
- **TS-2.4:** After dismiss (TS-2.3 setup), advance fake timers by 10s, let next poll return same state, assert banner NOT re-appended.
- **TS-2.5:** After dismiss, let next poll return whisper.ready=true, assert whisper dot's `classList.remove("bg-destructive")` AND `classList.add("bg-primary", "animate-pulse")` were called.
- **TS-2.6:** Call `renderLayout` with all ready=true. Assert rendered HTML contains no `data-status-banner` attribute.
- **TS-2.7:** `healthStatus` omits `telegram` key and has whisper not-ready. Assert banner contains one line for whisper, no line containing `/telegram/i`.
- **TS-2.8:** Two `renderLayout` calls with the same input. Assert the banner appears in both — rendering is pure, no state. (Dismissal state lives in the DOM at runtime, not in the server.)
- **TS-2.9:** `healthStatus = { whisper: not-ready, ollama: not-ready, postgres: ready }` — same as TS-2.1 but named to align with EC-16. Asserts the banner contains BOTH whisper and ollama lines. This test exists separately to guard against regressions where only one not-ready service is listed.

### Group 3: Client-side polling (`tests/unit/system-status-client.test.ts`)

| Scenario | Test function |
|---|---|
| TS-3.1 | `"TS-3.1 — client polls /health every 10 seconds"` |
| TS-3.2 | `"TS-3.2 — successful poll updates indicator colors"` |
| TS-3.3 | `"TS-3.3 — network-error poll retains previous state"` |
| TS-3.4 | `"TS-3.4 — HTTP 500 poll retains previous state"` |
| TS-3.5 | `"TS-3.5 — dot color update occurs within 100ms of poll response"` |

**Sandbox helper (`tests/helpers/status-client-sandbox.ts`):**

Provides `createStatusClientSandbox()` which:

1. Reads `src/web/system-status-client.src.js` from disk.
2. Builds a minimal mock DOM: a `document` object with `getElementById`, `querySelector`, `querySelectorAll`, and mock elements exposing `classList.add/remove/contains`, `addEventListener`, `parentNode.removeChild`, `appendChild`, `textContent`, and `dataset`.
3. Provides a mock `window` with `setInterval`/`clearInterval` backed by Vitest fake timers.
4. Provides a mock `fetch` (Vitest `vi.fn`) that the test controls per call.
5. Executes the script via `vm.runInNewContext(scriptText, sandbox)`.
6. Returns `{ document, fetch, advanceTime(ms), getDotState(serviceName), getBanner() }` for assertion.

**Concrete tests:**

- **TS-3.1:** Create sandbox. Execute first poll manually if required by the script's init. Advance fake timers by 10000ms. Assert `fetch` was called exactly twice (initial + one interval fire). Advance again, assert three calls total.
- **TS-3.2:** Initial state: all dots have `bg-primary animate-pulse`. `fetch` returns `{ ok: true, json: () => ({ status: "ok", services: { whisper: { ready: false, detail: "..." } } }) }`. Advance timers to trigger poll. Assert whisper mock element's `classList.remove("bg-primary")` was called and `classList.add("bg-destructive")` was called.
- **TS-3.3:** `fetch` returns `Promise.reject(new Error("network"))`. Initial state has all dots ready. Advance timers. Assert NO `classList.remove("bg-primary")` was called on any dot element.
- **TS-3.4:** `fetch` returns `{ ok: false, status: 500, json: async () => ({ error: "oops" }) }`. Same assertion as TS-3.3.
- **TS-3.5:** Record `Date.now()` before triggering poll. `fetch` resolves with state-changing payload. Use Vitest fake timer to advance response resolution. After the microtask flush, assert `classList.add("bg-destructive")` was called. The 100ms budget is guaranteed because fake timers run synchronously — a successful assertion after microtask flush means the update happened in the same tick as response resolution, i.e. far below 100ms.

**Note on TS-3.5 timing:** The 100ms acceptance criterion is a UX quality bar. With synchronous DOM updates on `fetch.then`, the actual delay is sub-millisecond. The test asserts the update happens immediately after the response resolves (no additional `setTimeout` or queue-microtask delay).

### Group 4: Postgres checker (`tests/unit/health.test.ts`)

| Scenario | Test function |
|---|---|
| TS-4.1 | `"TS-4.1 — postgres ready when SELECT 1 succeeds"` |
| TS-4.2 | `"TS-4.2 — postgres not-ready when SELECT 1 throws"` |

**Setup:** Mock `sql` as a tagged-template function (`vi.fn()` that returns a resolved promise, or rejects). Because `checkPostgres(sql)` calls `sql\`SELECT 1\``, the mock must behave like a postgres.js sql object: `sql(strings, ...values)` returns a promise. Use a thin helper `createMockSql(impl: (query: string) => Promise<any>)`.

**Assertion:**
- TS-4.1: `{ ready: true, detail: null }` returned.
- TS-4.2: `{ ready: false, detail: "Database unreachable" }` returned.

### Group 5: Ollama checker (`tests/unit/health.test.ts`)

| Scenario | Test function |
|---|---|
| TS-5.1 | `"TS-5.1 — ollama ready when tags include qwen3-embedding (no LLM check)"` |
| TS-5.2 | `"TS-5.2 — ollama not-ready when models list is empty"` |
| TS-5.3 | `"TS-5.3 — ollama not-ready when /api/tags unreachable"` |
| TS-5.4 | `"TS-5.4 — ollama ready with exact model name match"` |
| TS-5.5 | `"TS-5.5 — ollama ready when both embedding and classification models present"` |
| TS-5.6 | `"TS-5.6 — ollama not-ready when classification model missing"` |
| TS-5.7 | `"TS-5.7 — embedding-missing detail takes precedence"` |
| TS-5.8 | `"TS-5.8 — Anthropic provider skips classification check"` |
| TS-5.9 | `"TS-5.9 — non-Ollama openai base URL skips classification check"` |
| TS-5.10 | `"TS-5.10 — empty llm_model skips classification check"` |

**Setup:** `vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => { ... })`. The mock responds based on the requested URL. Each test builds a `deps = { ollamaUrl, llmBaseUrl, llmModel }` object and calls `checkOllama(deps)` directly — no Hono, no DB.

**Example (TS-5.6):**
```
fetch spy returns 200 on http://ollama:11434/api/tags with body
{ models: [{ name: "qwen3-embedding:latest" }] }
deps = { ollamaUrl: "http://ollama:11434", llmBaseUrl: "http://ollama:11434/v1", llmModel: "llama3.1:8b" }
const result = await checkOllama(deps)
expect(result).toEqual({ ready: false, detail: "Downloading classification model (llama3.1:8b)" })
```

### Group 6: Whisper checker (`tests/unit/health.test.ts`)

| Scenario | Test function |
|---|---|
| TS-6.1 | `"TS-6.1 — whisper ready when /health returns 200"` |
| TS-6.2 | `"TS-6.2 — whisper not-ready on ECONNREFUSED"` |
| TS-6.3 | `"TS-6.3 — whisper not-ready on HTTP 500"` |

**Setup:** `vi.spyOn(globalThis, "fetch")` returning the relevant Response. For TS-6.2, `.mockRejectedValue(new Error("ECONNREFUSED"))` — any rejection with a connection-error-like message/code is treated as "loading" per AC-3.6. For TS-6.3, `.mockResolvedValue(new Response("err", { status: 500 }))`.

### Group 7: Telegram checker (`tests/unit/health.test.ts`)

| Scenario | Test function |
|---|---|
| TS-7.1 | `"TS-7.1 — telegram key absent when token empty"` |
| TS-7.2 | `"TS-7.2 — telegram ready when bot polling"` |
| TS-7.3 | `"TS-7.3 — telegram not-ready when bot stopped"` |

**Setup:** `deps = { telegramBotToken: "", isBotRunning: () => false }` and variants. `checkTelegram(deps)` returns `null` to signal omission when token is empty — the caller (e.g. `getServiceStatus`) checks for `null` and excludes the key. Alternatively, returns `{ ready: boolean, detail, omit?: true }`; tests must verify the omission path at the aggregate layer.

**Preferred:** `checkTelegram` returns `ServiceStatus | null`. The aggregate helper `getServiceStatus` builds the `services` object by iterating `[postgres, ollama, whisper, telegram]` and skipping `null` entries.

**TS-7.1:** `expect(await checkTelegram({ telegramBotToken: "", isBotRunning: () => false })).toBe(null)`.

### Group 8: /health endpoint contract (`tests/unit/health.test.ts`)

| Scenario | Test function |
|---|---|
| TS-8.1 | `"TS-8.1 — response has status, services, uptime top-level keys"` |
| TS-8.2 | `"TS-8.2 — services values match ServiceStatus shape"` |
| TS-8.3 | `"TS-8.3 — ready field is strictly boolean"` |
| TS-8.4 | `"TS-8.4 — status is ok when all services ready"` |
| TS-8.5 | `"TS-8.5 — status is degraded when Postgres not ready"` |
| TS-8.6 | `"TS-8.6 — status is ok when only non-Postgres services are not-ready"` |
| TS-8.7 | `"TS-8.7 — /health accessible without authentication"` |
| TS-8.8 | `"TS-8.8 — single slow check does not exceed 3s total"` |
| TS-8.9 | `"TS-8.9 — checks run in parallel not sequentially"` |
| TS-8.10 | `"TS-8.10 — uptime is a non-negative integer"` |

**Setup:** Build `ServiceCheckers` using the same dependency-injection pattern as the existing file. Use `createHealthRoute(checkers)` and `app.request("/health")` via Hono's test request API.

**TS-8.8 / TS-8.9** use fake timers. Each checker returns a promise that resolves after `n` timer ticks. Advance timers and assert total elapsed fake-time is `max(per-check)` not `sum(per-check)`.

**TS-8.7:** Wrap `createHealthRoute` in `createAuthMiddleware` — same pattern as the existing file's "accessible without authentication" test.

### Group 9: docker-compose.yml (`tests/unit/docker-compose.test.ts`)

| Scenario | Test function |
|---|---|
| TS-9.1 | `"TS-9.1 — whisper service sets PRELOAD_MODELS"` |
| TS-9.2 | `"TS-9.2 — whisper service declares healthcheck block"` |
| TS-9.3 | `"TS-9.3 — app depends on whisper with service_started condition"` |

**Setup:** `const yamlText = await readFile("docker-compose.yml", "utf8")`. No YAML parser (C-3: no new deps). Use regex matchers tight enough to verify required fields without being over-specific about unrelated formatting.

**Assertions:**

- TS-9.1: `expect(yamlText).toMatch(/^\s{6}PRELOAD_MODELS:\s*'\[\"Systran\/faster-whisper-medium\"\]'\s*$/m)` (6-space indent under `whisper:` → `environment:`).
- TS-9.2: Assert the substring block between a `healthcheck:` line and the next service or top-level key contains `CMD-SHELL`, `curl -sf http://localhost:8000/health`, `interval: 15s`, `timeout: 10s`, `retries: 20`, `start_period: 300s`. Use a multi-line regex with `dotAll`.
- TS-9.3: Assert `yamlText` contains a substring matching `whisper:\s+condition:\s+service_started` inside the `app` service's `depends_on`.

### Group 10: Constraints and absence checks

- **TS-10.1** (no framework deps) → `tests/unit/system-status-constraints.test.ts`. Read `package.json`, assert neither `dependencies` nor `devDependencies` contain any key from `["react", "vue", "svelte", "alpinejs", "solid-js", "preact", "lit", "@angular/core", "ember-source"]`.
- **TS-10.2** (footer from layout.ts) → `tests/unit/layout-status.test.ts`. Render a layout and grep for the footer markup; separately, `expect(readFile("src/web/layout.ts")).toContain("renderFooter")` (or the inlined footer markup).
- **TS-10.3** (no new npm deps) → `tests/unit/system-status-constraints.test.ts`. Compare `package.json` dependencies against a pinned snapshot list stored in the test. If a dep is added, the test fails and must be updated with explicit reasoning. The snapshot is generated from `package.json` at the moment this feature begins Phase 5 implementation.
- **TS-10.4** (no inline styles) → `tests/unit/layout-status.test.ts`. For files `src/web/layout.ts`, `src/web/layout-footer.ts`, `src/web/system-status-client.src.js`: read text, assert no occurrence of `style="` substring.
- **TS-10.5** (page render latency bounded) → `tests/unit/layout-status.test.ts`. Mock `getServiceStatus` to take one checker hang for 5 seconds and others resolve instantly; measure `renderLayout` wall time with fake timers, assert ≤ 3.5 seconds (3s timeout + small slack).
- **TS-10.6** (no legacy strings) → `tests/unit/health.test.ts`. After calling `/health`, `JSON.stringify(response)` must not contain `"connected"`, `"disconnected"`, `"polling"`, or `"stopped"` as substrings.
- **TS-10.7** (no new tables) → `tests/unit/system-status-constraints.test.ts`. Read `src/db/index.ts`, extract table names via regex on `CREATE TABLE`, assert the set equals the pre-feature set (embedded as a constant in the test).

### Integration (`tests/integration/system-status-integration.test.ts`)

Two smoke tests using real testcontainers Postgres and mocked HTTP for Ollama/Whisper:

- **Integration 1 — Full shape with live DB:** Boot pgvector container, seed settings (`telegram_bot_token=""`, `llm_base_url=""`, `llm_model=""`), run migrations, wire `createHealthRoute` with `createServiceCheckers({ sql, startTime, isBotRunning: () => false })`, mock fetch for Ollama/Whisper, request `/health`, assert response has `services.postgres.ready === true`, Telegram key omitted, correct overall `status`.
- **Integration 2 — Transition over sequential calls:** Starting from Integration 1 state, change the fetch mock so whisper now reports ready, call `/health` a second time, assert `services.whisper.ready === true` on the second call. Demonstrates that each call runs checks fresh (NG-10: no server-side caching).

## Fixtures & Test Data

### Shared helpers

- **`tests/helpers/mock-sql.ts`** *(new)* — `createMockSql(options)` returns a fake postgres.js `Sql` instance. Supports `sql\`SELECT 1\`` resolving or rejecting, and `sql.unsafe(...)` behaviors needed by settings reads.
- **`tests/helpers/status-client-sandbox.ts`** *(new)* — helper for executing the client polling script in a Node `vm` sandbox. Exports `createStatusClientSandbox({ initialHealth, fetchResponses })`.
- **`tests/helpers/pg-container.ts`** *(existing)* — used unchanged for the integration tests.
- **`tests/helpers/mock-ollama.ts`** *(existing)* — may be extended with an `/api/tags` responder for this feature; otherwise ad-hoc `fetch` spy.

### Fake health status factory

```
tests/helpers/fake-health.ts (new):

export function fakeHealthAllReady(): HealthStatus { ... }
export function fakeHealthWhisperLoading(): HealthStatus { ... }
export function fakeHealthPostgresDown(): HealthStatus { ... }
```

Used by Group 1 and Group 2 tests to avoid duplicating object literals.

### Module mocks

- `vi.mock("../../src/db/settings.js")` (if needed) for `getAllSettings` when testing `createServiceCheckers` aggregate.
- `vi.mock("../../src/classify.js")` for `resolveLLMConfig` when testing the ollama-url/llm-url comparison in `createServiceCheckers` (NOT in the pure `checkOllama` tests — those pass deps directly).

### Setup / teardown

- `beforeEach`: `vi.restoreAllMocks()` to ensure fetch spies and module mocks are reset between tests.
- `vi.useFakeTimers()` + `vi.useRealTimers()` scoped per test for timing-sensitive tests (Group 3, TS-8.8, TS-8.9, TS-10.5).
- Each test builds its own fake health status and `ServiceCheckers` — no shared mutable state across tests.

## Initial Failure Verification

For every test in the mapping, confirm it will fail when the feature is not yet implemented:

- **Group 1 / Group 2** — `renderLayout` does not yet accept a `healthStatus` parameter. Passing an argument is allowed but ignored; the rendered HTML does not contain the new footer/banner markup, so substring assertions fail. ✅ Fails.
- **Group 3** — `src/web/system-status-client.src.js` does not exist. The sandbox helper throws on `readFileSync`. ✅ Fails.
- **Group 4** — `src/web/service-checkers.ts` does not exist (checker functions currently live inline in `src/index.ts`). Import fails. ✅ Fails.
- **Group 5-7** — same as Group 4. ✅ Fails.
- **Group 8** — `createHealthRoute` exists but returns the legacy shape. `TS-8.1` fails because the response doesn't have a nested `services` object. ✅ Fails.
- **Group 9** — `docker-compose.yml` does not yet contain `PRELOAD_MODELS` or a `healthcheck` block. ✅ Fails.
- **Group 10** — Most checks will fail because the files/modules they reference don't exist yet. TS-10.1 and TS-10.3 might accidentally pass if no forbidden deps are ever added — acceptable because they're guard-rails, not behavior tests.

## Alignment Check

**Full alignment.** Every scenario (TS-1.1 through TS-10.7) is mapped to a test function with concrete setup, action, and assertion. No coverage gaps. No design concerns about implementation coupling.

**Deferred to Phase 5 decisions:**
- Exact error-message strings for `"Database unreachable"`, `"Ollama unreachable"`, `"Loading Whisper model — first boot can take several minutes"`, `"Whisper unreachable"`, `"Downloading embedding model (qwen3-embedding)"`, `"Downloading classification model (<llm_model>)"`, `"Telegram bot stopped or crashed"`. Tests assert these exact strings because they are user-visible contract text in the banner. If Phase 5 wants to tweak wording, the tests and the spec must update in lock-step.
- The concrete class-name strings for ready / not-ready dots (`bg-primary animate-pulse` vs `bg-destructive`). These come from the existing Tailwind palette used in `src/web/layout.ts`. If the `frontend-design` skill recommends different classes for the banner during Phase 5, they must be reflected back into these tests.
- The `data-status-banner="true"` attribute selector used by tests — this is a test contract with the Phase 5 implementation. Alternatively, the test can match on a unique class like `class="…status-banner…"`. Either works; tests will settle on one choice once the banner markup is produced.
