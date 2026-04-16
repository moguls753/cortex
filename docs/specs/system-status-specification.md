# System Status — Behavioral Specification

## Objective

Surface the readiness of Cortex's internal dependencies (PostgreSQL, Ollama, Whisper, Telegram) so that first-boot model downloads, transient outages, and misconfigurations are visible and self-explanatory instead of resulting in silent failures or confusing user-facing errors.

The direct trigger is first-boot UX: downloading the Whisper medium model (~1.5 GB) and the Ollama embedding model (`qwen3-embedding`, ~4.7 GB) can take several minutes each on a fresh host. During that window, voice capture and semantic search do not work. Users need to see *why* without reading container logs. The feature applies to all other operational states as well — a crashed bot, a paused postgres, a purged model — so the same mechanism handles both onboarding and day-to-day diagnostics.

## User Stories & Acceptance Criteria

### US-1: First-boot visibility of model downloads

As a user who just ran `docker compose up` for the first time, I want to see at a glance which services are still downloading their models so I know when I can use voice capture and semantic search.

**Acceptance Criteria:**

- **AC-1.1:** On every authenticated page, the layout footer displays one indicator per expected service. An indicator is a colored dot plus the service label (e.g. `● postgres`, `● ollama`, `● whisper`, `● telegram`).
- **AC-1.2:** Each indicator reflects the service's current readiness: a pulsing primary-color dot when `ready === true`, a non-pulsing destructive-color dot when `ready === false`.
- **AC-1.3:** On the initial HTTP page load after boot or after the onboarding wizard completes, if any service is not ready, a dismissable banner is rendered above the main page content. The banner lists every not-ready service on its own line, each with a human-readable `detail` string explaining the impact (e.g. "Whisper: loading voice transcription model — voice messages cannot be processed until this finishes").
- **AC-1.4:** The banner includes a dismiss control. Activating it removes the banner from the current page for the remainder of the page load. The banner does NOT reappear until the page is reloaded.
- **AC-1.5:** After banner dismissal, footer indicators continue to update independently.

### US-2: Continuous status updates

As a user with the Cortex web UI open, I want the indicators to update without a manual refresh so I can see when a service becomes ready or fails while I'm working.

**Acceptance Criteria:**

- **AC-2.1:** Client-side JavaScript polls `GET /health` every 10 seconds as long as the page is visible.
- **AC-2.2:** On each successful poll response, indicator dot colors update to match the returned readiness.
- **AC-2.3:** If a poll fails (network error, non-2xx response, invalid JSON), the client retains the previously displayed state for all indicators. The footer does NOT flash all indicators red on a transient fetch failure.
- **AC-2.4:** A state transition on any individual indicator (ready ↔ not-ready) results in a color change within 100 ms of the poll response arriving in the client.

### US-3: Per-service readiness semantics

As a user, I want each service's "ready" state to mean "you can actually use this capability right now" — not just "the container is running".

**Acceptance Criteria:**

- **AC-3.1 (PostgreSQL):** `postgres.ready === true` iff `SELECT 1` executed via the app's postgres.js client resolves within 3 seconds without throwing. Otherwise `ready === false` with `detail` = `"Database unreachable"`.
- **AC-3.2 (Ollama — embedding model):** `ollama.ready` is first gated on `GET ${OLLAMA_URL}/api/tags` returning HTTP 200 within 3 seconds. The response body is parsed as JSON and the `models` array is extracted. The check passes iff at least one entry's `name` field contains the substring `qwen3-embedding` (matching `qwen3-embedding`, `qwen3-embedding:latest`, `qwen3-embedding:Q8_0`, etc.). If the base request fails, `detail` = `"Ollama unreachable"`. If the request succeeds but no matching model is present, `detail` = `"Downloading embedding model (qwen3-embedding)"`.
- **AC-3.3 (Ollama — conditional classification model):** In addition to AC-3.2, if the resolved `llm_base_url` setting is non-empty AND parses such that its host+port equals the host+port of `OLLAMA_URL`, the tags response MUST also contain a model whose `name` contains the resolved `llm_model` setting as a substring. If that model is missing, `ollama.ready === false` with `detail` = `"Downloading classification model (<llm_model>)"`. Embedding-model missing takes precedence over classification-model missing in the `detail` string (only one detail is reported).
- **AC-3.4 (Ollama — unrelated LLM):** If `llm_base_url` is empty OR resolves to a host+port different from `OLLAMA_URL`, the LLM model is NOT checked against Ollama tags. Only the embedding-model check (AC-3.2) determines Ollama readiness.
- **AC-3.5 (Ollama — no llm_model):** If `llm_base_url` points at Ollama but `llm_model` is empty, the classification-model check is skipped. Only the embedding-model check determines Ollama readiness.
- **AC-3.6 (Whisper):** `whisper.ready === true` iff `GET ${WHISPER_URL}/health` returns HTTP 200 within 3 seconds. Because `PRELOAD_MODELS` causes the server to bind port 8000 only after the model is loaded, an unreachable port and a still-loading model are indistinguishable and are both reported as not-ready with `detail` = `"Loading Whisper model — first boot can take several minutes"`. Any other non-2xx response reports `detail` = `"Whisper unreachable"`.
- **AC-3.7 (Telegram):** If the `telegram_bot_token` setting is empty, the `telegram` key is entirely omitted from the `/health` response, no footer indicator is rendered, and Telegram never contributes a line to the banner. If the token is present, `telegram.ready === true` iff the bot's in-process polling state (`isBotRunning()`) is true. When present but not polling, `detail` = `"Telegram bot stopped or crashed"`.

### US-4: Health endpoint as single source of truth

As a developer or operator integrating with Cortex, I want a single documented HTTP endpoint returning the readiness of all services in a machine-readable form.

**Acceptance Criteria:**

- **AC-4.1:** `GET /health` returns HTTP 200 with a JSON body of shape `{ status: "ok" | "degraded", services: ServiceStatusMap, uptime: number }`.
- **AC-4.2:** `services` is an object whose keys are a subset of `{ "postgres", "ollama", "whisper", "telegram" }`. `telegram` is present iff configured (per AC-3.7). Each value is of shape `{ ready: boolean, detail: string | null }` where `detail` is `null` when `ready === true` and a non-empty string when `ready === false`.
- **AC-4.3:** Top-level `status` is `"ok"` iff every present service has `ready === true`. If `services.postgres.ready === false`, `status` MUST be `"degraded"` regardless of other services. If any non-postgres service is not-ready but postgres is ready, `status` is `"ok"` (preserves existing behavior — postgres failures are the only "degraded" trigger).
- **AC-4.4:** `GET /health` is accessible without authentication (existing behavior preserved).
- **AC-4.5:** Each service check runs with an independent 3-second timeout. A timed-out check produces `{ ready: false, detail: <timeout detail> }` and does NOT cause the overall `/health` request to fail or exceed 3 seconds total for sequential checks, or to exceed 3 seconds total for parallel checks. Checks run in parallel.
- **AC-4.6:** `uptime` is an integer number of seconds since the Node process started (existing behavior preserved).

### US-5: Docker Compose first-boot behavior

As an operator running `docker compose up` on a fresh host, I want Whisper to download its model before accepting transcription requests, without blocking app startup.

**Acceptance Criteria:**

- **AC-5.1:** The `whisper` service in `docker-compose.yml` sets environment variable `PRELOAD_MODELS` to the JSON string `["Systran/faster-whisper-medium"]`. This causes the container to download and load the model during startup, before binding its HTTP port.
- **AC-5.2:** The `whisper` service in `docker-compose.yml` has a `healthcheck` block configured as: `test: ["CMD-SHELL", "curl -sf http://localhost:8000/health || exit 1"]`, `interval: 15s`, `timeout: 10s`, `retries: 20`, `start_period: 300s`. This surfaces health state in `docker compose ps` but does NOT gate any other service.
- **AC-5.3:** The `app` service's `depends_on.whisper` condition MUST remain `service_started` (not `service_healthy`). App startup is never gated on Whisper model download.

## Constraints

### Technical

- **C-1:** Client-side polling uses only vanilla JavaScript (no frontend frameworks; consistent with the existing Terminal / Command Center design system).
- **C-2:** The footer bar is rendered inside `src/web/layout.ts` on every server-side page. The banner is rendered inline by `src/web/layout.ts` during the initial page load — it is NOT created by client JavaScript after hydration.
- **C-3:** No new npm dependencies. Implementation uses the existing `fetch` API, `postgres.js`, Hono, and Tailwind utility classes. Adding a dependency requires explicit re-spec.
- **C-4:** All styling uses Tailwind utility classes. No inline `style=""` attributes (per CLAUDE.md "no inline styles" rule). The banner component's visual design is produced via the `frontend-design` skill during Phase 5 implementation because it is a net-new UI component not covered by the existing design doc.
- **C-5:** The `/health` endpoint's response contract is the source of truth for all UI indicators. The layout footer and banner read only from `/health`; they do not reach into the app's internal state directly.

### Operational

- **C-6:** Server-side page rendering awaits health checks via a shared `getServiceStatus(sql)` helper that runs all checkers in parallel with a per-check 3-second timeout (same timeout as the `/health` endpoint). Because checks run in parallel, total wall-clock overhead is bounded to at most 3 seconds on first boot while services are still starting. The result is used to render the footer and banner server-side with real state on the very first page load. Subsequent loads have near-zero overhead because responsive services return in milliseconds. No client-side banner injection is performed.
- **C-7:** The `/health` endpoint must not become a DoS amplifier. Each service check enforces an independent 3-second timeout. Total wall time for `/health` is bounded by the slowest check (since checks run in parallel).
- **C-8:** All existing tests in `tests/unit/health.test.ts` must be updated to the new response shape or replaced. No existing test may remain asserting the legacy `"connected" | "disconnected"` string shape.

## Edge Cases

- **EC-1:** Client poll fails with a network error, timeout, or HTTP 5xx → the client retains the previous indicator state. No flash-red on every transient failure.
- **EC-2:** All services ready on initial page load → no banner is rendered. Footer shows four green pulsing dots (or three, if Telegram is unconfigured).
- **EC-3:** `telegram_bot_token` is empty (Telegram never configured) → no Telegram dot in the footer; no Telegram line in the banner; no `telegram` key in `/health` response.
- **EC-4:** Ollama container reachable but `/api/tags` returns an empty `models` array (nothing pulled) → ollama is not-ready with `detail` = `"Downloading embedding model (qwen3-embedding)"`.
- **EC-5:** Ollama container reachable, embedding model present, classification-model check required by AC-3.3 but the model is missing → ollama is not-ready with `detail` = `"Downloading classification model (<llm_model>)"`.
- **EC-6:** Whisper container started but port 8000 not yet bound (model still loading under `PRELOAD_MODELS`) → `checkWhisper` fails with `ECONNREFUSED`, reported as not-ready with `detail` = `"Loading Whisper model — first boot can take several minutes"`.
- **EC-7:** User dismisses the banner, then a service transitions ready → not-ready on a later poll → the banner does NOT reappear. The footer dot changes color. User discovers the problem through the footer.
- **EC-8:** User dismisses the banner, then reloads the page → the banner is re-evaluated from scratch. If any service is still not-ready at reload time, the banner is rendered again.
- **EC-9:** `/health` responds with HTTP 500 due to an internal error → client treats this as a failed poll (EC-1) and retains previous state.
- **EC-10:** Multiple browser tabs open → each tab polls independently every 10 seconds. There is no cross-tab coordination. Acceptable because `/health` is cheap.
- **EC-11:** `llm_provider` is `anthropic` (API-based) → the Ollama check verifies only the embedding model. The classification model runs against the Anthropic API, not Ollama.
- **EC-12:** `llm_provider` is `openai` with `llm_base_url` set to LM Studio, OpenAI, or any non-Ollama host → the Ollama check verifies only the embedding model.
- **EC-13:** `llm_provider` is `openai` with `llm_base_url` pointing at the Ollama container (e.g. `http://ollama:11434/v1`) → the Ollama check verifies BOTH the embedding model AND `llm_model`.
- **EC-14:** `llm_base_url` points at Ollama but `llm_model` is empty → classification-model check is skipped (nothing to verify). Only embedding-model check applies.
- **EC-15:** Postgres is down → `/health` returns `status: "degraded"`; dashboard and other DB-backed pages may already fail to render. Banner still renders if the layout's initial poll succeeds before the page-render DB call fails. This is acceptable because a degraded Postgres is the most catastrophic state and no other graceful behavior is expected.
- **EC-16:** User completes onboarding, lands on the dashboard, and Whisper/Ollama are still downloading → banner appears on that first dashboard load with both services listed.

## Non-Goals

- **NG-1:** **No persistent banner dismissal.** Dismissal is scoped to the current page load. Rationale: simplest mental model; footer dots already carry the information between dismissals, so there's no need to store state across reloads or tabs.
- **NG-2:** **No SSE push for health updates.** 10-second client-side polling is sufficient. Rationale: backend push requires a server-side timer loop and change-detection machinery that is not justified at the 10-second granularity users will perceive.
- **NG-3:** **No tri-state (`downloading` / `error` / `ready`).** Binary ready / not-ready per service with a free-text `detail` string is enough. Rationale: distinguishing "downloading" from "crashed" reliably requires stateful app-side memory (tracking whether a service was ever seen ready), which adds complexity for marginal UX gain.
- **NG-4:** **No health history or uptime tracking per service.** `/health` reflects only current state. Rationale: out of scope for onboarding UX; no user need identified.
- **NG-5:** **No docker socket integration.** The app does NOT query docker's own health status for any container. Rationale: mounting the docker socket introduces a security surface; HTTP checks already provide the needed signal.
- **NG-6:** **No new database tables.** No `service_status` or `health_history` schema additions. All checks are stateless HTTP calls. Rationale: YAGNI.
- **NG-7:** **No configurable polling interval.** 10 seconds is hardcoded in the client script. Rationale: no user need; avoids runtime-settings proliferation.
- **NG-8:** **No user-dismissible footer indicators.** Only the banner is dismissible. The footer is always rendered for authenticated users. Rationale: the footer is the permanent source of truth.
- **NG-9:** **No retry / backoff logic on failed polls.** If a poll fails, the next poll happens on the normal 10-second schedule. Rationale: simplicity; failures are typically transient and the next cycle catches up.
- **NG-10:** **No server-side caching of health results.** Every call to `/health` runs fresh service checks. Rationale: checks are already fast and parallel; caching would introduce a consistency window.

## Open Questions

(none — all resolved during brainstorming)
