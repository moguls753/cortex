# System Status — Test Specification

Derived from `system-status-specification.md`. Every scenario is anchored to at least one acceptance criterion, edge case, constraint, or non-goal. Scenarios follow Given/When/Then with one behavior per scenario and one action per When.

## Coverage Matrix

| Spec item | Scenario(s) |
|---|---|
| AC-1.1 Footer has one indicator per expected service | TS-1.1, TS-1.2 |
| AC-1.2 Ready dot vs not-ready dot styles | TS-1.3, TS-1.4 |
| AC-1.3 Banner lists not-ready services on initial load | TS-2.1, TS-2.2 |
| AC-1.4 Banner dismiss hides banner for page load | TS-2.3, TS-2.4 |
| AC-1.5 Footer continues updating after dismiss | TS-2.5 |
| AC-2.1 Client polls /health every 10 seconds | TS-3.1 |
| AC-2.2 Successful poll updates indicator colors | TS-3.2 |
| AC-2.3 Failed poll retains previous state | TS-3.3, TS-3.4 |
| AC-2.4 State transition reflected within 100ms | TS-3.5 |
| AC-3.1 Postgres SELECT 1 readiness | TS-4.1, TS-4.2 |
| AC-3.2 Ollama embedding-model check | TS-5.1, TS-5.2, TS-5.3, TS-5.4 |
| AC-3.3 Ollama conditional classification-model check | TS-5.5, TS-5.6, TS-5.7 |
| AC-3.4 Ollama unrelated LLM (no check) | TS-5.8, TS-5.9 |
| AC-3.5 Ollama no llm_model (skip check) | TS-5.10 |
| AC-3.6 Whisper /health readiness | TS-6.1, TS-6.2, TS-6.3 |
| AC-3.7 Telegram readiness (omit if unconfigured) | TS-7.1, TS-7.2, TS-7.3 |
| AC-4.1 /health JSON body shape | TS-8.1 |
| AC-4.2 services keys and value shape | TS-8.2, TS-8.3 |
| AC-4.3 status "ok" vs "degraded" precedence | TS-8.4, TS-8.5, TS-8.6 |
| AC-4.4 /health accessible without auth | TS-8.7 |
| AC-4.5 3s independent timeout, parallel checks | TS-8.8, TS-8.9 |
| AC-4.6 uptime integer seconds | TS-8.10 |
| AC-5.1 PRELOAD_MODELS env var | TS-9.1 |
| AC-5.2 Whisper healthcheck block | TS-9.2 |
| AC-5.3 app depends_on whisper service_started | TS-9.3 |
| EC-1 Poll failure retains state | TS-3.3, TS-3.4 |
| EC-2 All ready → no banner | TS-2.6 |
| EC-3 Telegram unconfigured → no dot/banner/key | TS-7.1, TS-1.2, TS-2.7 |
| EC-4 /api/tags empty models → not ready | TS-5.2 |
| EC-5 Classification model missing | TS-5.6 |
| EC-6 Whisper ECONNREFUSED → loading detail | TS-6.2 |
| EC-7 Dismiss then ready→not-ready → no re-open | TS-2.5 |
| EC-8 Dismiss then reload → banner re-evaluated | TS-2.8 |
| EC-9 /health 500 retains previous state | TS-3.4 |
| EC-10 Multiple tabs poll independently | TS-3.6 |
| EC-11 Anthropic provider → only embedding checked | TS-5.8 |
| EC-12 Non-Ollama openai base URL → only embedding checked | TS-5.9 |
| EC-13 Ollama-hosted LLM → both models checked | TS-5.5 |
| EC-14 llm_model empty → only embedding checked | TS-5.10 |
| EC-15 Postgres down → degraded status | TS-8.5 |
| EC-16 Post-onboarding dashboard load with downloads pending → banner appears | TS-2.9 |
| C-1 Vanilla JS only | TS-10.1 |
| C-2 Footer in layout.ts, banner inline | TS-2.2, TS-10.2 |
| C-3 No new npm dependencies | TS-10.3 |
| C-4 No inline styles | TS-10.4 |
| C-6 Server-render does not block on checks | TS-10.5 |
| C-7 /health independent 3s timeout | TS-8.8 |
| C-8 Old health tests updated | TS-10.6 |
| NG-1 No persistent banner dismissal | TS-2.8 |
| NG-3 No tri-state ready field | TS-8.3 |
| NG-6 No new database tables | TS-10.7 |

---

## Test Scenarios

### Group 1: Footer indicator rendering

**TS-1.1 — Footer renders one indicator per configured service**

```
Given Telegram is configured with a non-empty bot token
  And an authenticated user
When the user loads any page under the web UI
Then the rendered HTML footer contains exactly four status dots labeled
     "postgres", "ollama", "whisper", and "telegram"
```

**TS-1.2 — Footer omits Telegram indicator when Telegram is unconfigured**

```
Given the telegram_bot_token setting is empty
  And an authenticated user
When the user loads any page under the web UI
Then the rendered HTML footer contains exactly three status dots
     for "postgres", "ollama", and "whisper"
  And no element is rendered with the label "telegram"
```

**TS-1.3 — Ready indicator renders with pulsing primary-color dot**

```
Given all services report ready on the first /health poll
When the client poll response is processed
Then each footer dot has a class combination indicating pulsing + primary color
```

**TS-1.4 — Not-ready indicator renders with non-pulsing destructive-color dot**

```
Given Whisper reports ready=false on the /health response
When the client poll response is processed
Then the whisper footer dot has a class combination indicating
     destructive color without the pulse animation
  And the postgres, ollama, telegram dots retain their ready styling
```

---

### Group 2: Banner rendering and dismissal

**TS-2.1 — Banner renders on initial page load with not-ready services**

```
Given a server-side health check reporting whisper.ready=false and ollama.ready=false
When an authenticated user loads a page
Then the server-rendered HTML contains a banner element
  And the banner contains two line items — one for "whisper" and one for "ollama"
  And each line contains the detail string returned by /health for that service
```

**TS-2.2 — Banner is server-rendered above content, not injected later**

```
Given whisper.ready=false in the initial health check
When an authenticated user loads a page
Then the banner element appears in the HTML response payload (not inserted by JS)
  And the banner appears above the main content region in document order
```

**TS-2.3 — Banner dismiss button removes the banner from the DOM**

```
Given the banner is rendered with one or more not-ready services
When the user activates the banner's dismiss control
Then the banner element is removed from the DOM
```

**TS-2.4 — Dismissed banner does not reappear during the same page load**

```
Given the user dismissed the banner
When 10 seconds pass and the next /health poll completes
  And the poll response still indicates the same set of not-ready services
Then the banner is NOT re-inserted into the DOM
```

**TS-2.5 — After dismissal, footer dots still update on state change (EC-7)**

```
Given the user dismissed the banner
  And whisper previously reported ready=false
When a subsequent /health poll reports whisper.ready=true
Then the whisper footer dot transitions to ready styling
  And the banner remains absent from the DOM
```

**TS-2.6 — Banner is absent when all services are ready (EC-2)**

```
Given the initial /health response reports every service as ready
When an authenticated user loads a page
Then no banner element is rendered in the HTML response
```

**TS-2.7 — Banner omits Telegram line when Telegram is unconfigured (EC-3)**

```
Given Telegram is unconfigured (no bot token)
  And whisper.ready=false
When an authenticated user loads a page
Then the banner is rendered with exactly one line item for whisper
  And no banner line is rendered for telegram
```

**TS-2.8 — Reloading after dismissal re-evaluates banner state (EC-8, NG-1)**

```
Given the user dismissed the banner on a prior page load
  And the set of not-ready services is unchanged
When the user reloads the page
Then the banner is rendered again with the current set of not-ready services
```

**TS-2.9 — Banner appears after onboarding redirect when downloads still pending (EC-16)**

```
Given the onboarding wizard just completed
  And whisper is still downloading its model
  And ollama is still downloading its embedding model
When the user is redirected to the dashboard
Then the dashboard page renders with the banner listing both whisper and ollama
```

---

### Group 3: Polling behavior

**TS-3.1 — Client polls /health every 10 seconds**

```
Given an authenticated page is loaded with the polling script active
When 10 seconds elapse after the first poll
Then the client has issued exactly one additional GET /health request
```

**TS-3.2 — Successful poll updates indicator colors**

```
Given whisper previously reported ready=true
When a subsequent /health poll response reports whisper.ready=false
Then the whisper footer dot class changes from ready styling to not-ready styling
```

**TS-3.3 — Network-error poll retains previous dot colors (EC-1)**

```
Given all footer dots currently show ready styling
When a /health poll fails with a network error
Then all footer dots retain their ready styling with no flicker or color change
```

**TS-3.4 — HTTP 500 poll response retains previous dot colors (EC-9)**

```
Given all footer dots currently show ready styling
When a /health poll returns HTTP 500 with an error body
Then all footer dots retain their ready styling
```

**TS-3.5 — Dot color update occurs within 100ms of poll response arrival**

```
Given whisper previously reported ready=true
When a /health poll response arrives at time T reporting whisper.ready=false
Then the whisper footer dot reflects not-ready styling by time T + 100ms
```

**TS-3.6 — Tabs poll independently (EC-10)**

```
Given two browser tabs are open to authenticated pages
When each tab's polling interval fires
Then each tab independently issues its own GET /health request
  And no cross-tab deduplication occurs
```

---

### Group 4: PostgreSQL readiness check

**TS-4.1 — Postgres ready when SELECT 1 succeeds**

```
Given the postgres client is connected
When /health is called
Then services.postgres.ready is true
  And services.postgres.detail is null
```

**TS-4.2 — Postgres not-ready when SELECT 1 throws**

```
Given the postgres client raises an error on SELECT 1
When /health is called
Then services.postgres.ready is false
  And services.postgres.detail is "Database unreachable"
```

---

### Group 5: Ollama readiness check

**TS-5.1 — Ollama ready when tags response includes qwen3-embedding**

```
Given llm_base_url is empty or points to a non-Ollama host
  And GET /api/tags returns 200 with models containing "qwen3-embedding:latest"
When /health is called
Then services.ollama.ready is true
  And services.ollama.detail is null
```

**TS-5.2 — Ollama not-ready when models list lacks qwen3-embedding (EC-4)**

```
Given GET /api/tags returns 200 with an empty models list
When /health is called
Then services.ollama.ready is false
  And services.ollama.detail is "Downloading embedding model (qwen3-embedding)"
```

**TS-5.3 — Ollama not-ready when /api/tags request fails with network error**

```
Given GET /api/tags cannot connect (ECONNREFUSED)
When /health is called
Then services.ollama.ready is false
  And services.ollama.detail is "Ollama unreachable"
```

**TS-5.4 — Ollama ready with exact model name match**

```
Given GET /api/tags returns 200 with models list containing "qwen3-embedding"
When /health is called
Then services.ollama.ready is true
```

**TS-5.5 — Ollama ready when both embedding and classification models present (EC-13)**

```
Given llm_base_url host+port equals OLLAMA_URL host+port
  And llm_model is "llama3.1:8b"
  And GET /api/tags returns models containing both "qwen3-embedding" and "llama3.1:8b"
When /health is called
Then services.ollama.ready is true
  And services.ollama.detail is null
```

**TS-5.6 — Ollama not-ready when classification model is missing (EC-5)**

```
Given llm_base_url host+port equals OLLAMA_URL host+port
  And llm_model is "llama3.1:8b"
  And GET /api/tags returns models containing "qwen3-embedding" but not "llama3.1:8b"
When /health is called
Then services.ollama.ready is false
  And services.ollama.detail is "Downloading classification model (llama3.1:8b)"
```

**TS-5.7 — Embedding-missing detail takes precedence over classification-missing detail**

```
Given llm_base_url host+port equals OLLAMA_URL host+port
  And llm_model is "llama3.1:8b"
  And GET /api/tags returns an empty models list
When /health is called
Then services.ollama.ready is false
  And services.ollama.detail is "Downloading embedding model (qwen3-embedding)"
```

**TS-5.8 — Anthropic LLM provider skips classification-model check (EC-11)**

```
Given llm_provider is "anthropic"
  And llm_base_url is empty
  And GET /api/tags returns models containing "qwen3-embedding" but no llm_model
When /health is called
Then services.ollama.ready is true
```

**TS-5.9 — Non-Ollama OpenAI base URL skips classification-model check (EC-12)**

```
Given llm_base_url is "https://api.openai.com/v1"
  And llm_model is "gpt-4o-mini"
  And GET /api/tags (on the Ollama host) returns models containing "qwen3-embedding"
     but not "gpt-4o-mini"
When /health is called
Then services.ollama.ready is true
```

**TS-5.10 — Empty llm_model skips classification-model check (EC-14)**

```
Given llm_base_url host+port equals OLLAMA_URL host+port
  And llm_model is empty
  And GET /api/tags returns models containing "qwen3-embedding"
When /health is called
Then services.ollama.ready is true
```

---

### Group 6: Whisper readiness check

**TS-6.1 — Whisper ready when /health returns 200**

```
Given GET ${WHISPER_URL}/health returns HTTP 200
When /health is called
Then services.whisper.ready is true
  And services.whisper.detail is null
```

**TS-6.2 — Whisper not-ready when port refuses connection (EC-6)**

```
Given GET ${WHISPER_URL}/health fails with ECONNREFUSED
When /health is called
Then services.whisper.ready is false
  And services.whisper.detail is "Loading Whisper model — first boot can take several minutes"
```

**TS-6.3 — Whisper not-ready with non-connection error reports unreachable**

```
Given GET ${WHISPER_URL}/health returns HTTP 500
When /health is called
Then services.whisper.ready is false
  And services.whisper.detail is "Whisper unreachable"
```

---

### Group 7: Telegram readiness check

**TS-7.1 — Telegram omitted from response when token is empty**

```
Given the telegram_bot_token setting is empty
When /health is called
Then the response services object does NOT contain a "telegram" key
```

**TS-7.2 — Telegram ready when bot is polling**

```
Given telegram_bot_token is set
  And isBotRunning() returns true
When /health is called
Then services.telegram.ready is true
  And services.telegram.detail is null
```

**TS-7.3 — Telegram not-ready when bot is not polling**

```
Given telegram_bot_token is set
  And isBotRunning() returns false
When /health is called
Then services.telegram.ready is false
  And services.telegram.detail is "Telegram bot stopped or crashed"
```

---

### Group 8: /health endpoint contract

**TS-8.1 — Response has status, services, uptime top-level keys**

```
Given the service checkers return a mix of ready and not-ready states
When /health is called
Then the JSON response body has keys "status", "services", "uptime"
  And no other top-level keys
```

**TS-8.2 — Services object values match the per-service shape**

```
Given all services have known readiness
When /health is called
Then each value under the services object has the shape { ready: boolean, detail: string | null }
  And no other fields are present on any service entry
```

**TS-8.3 — ready field is boolean, never "downloading" or other strings (NG-3)**

```
Given Whisper is in any state
When /health is called
Then services.whisper.ready is strictly typeof boolean
  And is never a string literal like "downloading" or "ready"
```

**TS-8.4 — status "ok" when all present services are ready**

```
Given every present service reports ready=true
When /health is called
Then response.status equals "ok"
```

**TS-8.5 — status "degraded" when Postgres is not ready (EC-15)**

```
Given services.postgres.ready is false
  And services.ollama.ready is true
  And services.whisper.ready is true
When /health is called
Then response.status equals "degraded"
```

**TS-8.6 — status "ok" when only non-Postgres services are not ready**

```
Given services.postgres.ready is true
  And services.ollama.ready is false
  And services.whisper.ready is false
When /health is called
Then response.status equals "ok"
```

**TS-8.7 — /health accessible without authentication**

```
Given no auth cookie or header is provided
When /health is called
Then the response status is 200
  And the response body has the standard health shape
```

**TS-8.8 — A single slow service check does not delay /health beyond 3 seconds (C-7)**

```
Given the whisper check will hang for 10 seconds
  And all other checks return immediately
When /health is called
Then /health returns within 3 seconds total
  And services.whisper.ready is false
  And services.whisper.detail indicates a timeout
```

**TS-8.9 — Checks run in parallel, not sequentially**

```
Given every service check takes 2 seconds to complete
When /health is called
Then /health returns within approximately 2 seconds (not 8 seconds)
```

**TS-8.10 — Uptime is a non-negative integer**

```
Given the server has been running for any duration
When /health is called
Then response.uptime is an integer
  And response.uptime is greater than or equal to zero
```

---

### Group 9: docker-compose.yml configuration

**TS-9.1 — Whisper service sets PRELOAD_MODELS environment variable**

```
Given the project's docker-compose.yml
When it is parsed
Then services.whisper.environment contains
     PRELOAD_MODELS set to the JSON string '["Systran/faster-whisper-medium"]'
```

**TS-9.2 — Whisper service declares a healthcheck block**

```
Given the project's docker-compose.yml
When it is parsed
Then services.whisper.healthcheck.test is ["CMD-SHELL", "curl -sf http://localhost:8000/health || exit 1"]
  And services.whisper.healthcheck.interval is "15s"
  And services.whisper.healthcheck.timeout is "10s"
  And services.whisper.healthcheck.retries is 20
  And services.whisper.healthcheck.start_period is "300s"
```

**TS-9.3 — App depends on Whisper with service_started condition**

```
Given the project's docker-compose.yml
When it is parsed
Then services.app.depends_on.whisper.condition is "service_started"
```

---

### Group 10: Constraints and non-goals

**TS-10.1 — No frontend framework imports added (C-1)**

```
Given the project's package.json
When it is inspected
Then no dependencies are added for React, Vue, Svelte, Alpine, or Solid
```

**TS-10.2 — Footer rendered by src/web/layout.ts, not a separate page handler (C-2)**

```
Given any authenticated page
When the response HTML is inspected
Then the footer markup originates from the layout module
```

**TS-10.3 — No new npm dependencies added by this feature (C-3)**

```
Given the project's package.json before and after this feature is implemented
When the dependency lists are compared
Then the sets of runtime and dev dependencies are unchanged
```

**TS-10.4 — No inline styles in added templates (C-4)**

```
Given the source files modified or added by this feature
When they are searched for the pattern style="
Then no occurrences are found in HTML string literals
```

**TS-10.5 — Page render latency is bounded by the per-check timeout (C-6)**

```
Given a service check will hang indefinitely
  And other service checks return immediately
When a user loads an authenticated page
Then the server-side page rendering completes within approximately 3 seconds
  And the hung service renders with not-ready styling and a timeout detail
  And the other services render with their actual state
```

**TS-10.6 — Legacy health response strings are no longer emitted (C-8)**

```
Given /health is called with every service ready
When the response body is inspected
Then no field contains the literal string "connected"
  And no field contains the literal string "disconnected"
  And no field contains the literal string "polling"
  And no field contains the literal string "stopped"
```

**TS-10.7 — No new database tables are created by this feature (NG-6)**

```
Given the schema produced by src/db/index.ts
When it is compared to the pre-feature schema
Then no new tables are present
```

---

## Traceability

Every acceptance criterion (AC-1.1 through AC-5.3), every edge case (EC-1 through EC-16), every testable constraint (C-1 through C-8), and the testable non-goals (NG-1, NG-3, NG-6) have at least one scenario in the matrix above. Constraints that are purely process or documentation in nature (C-5: "/health is single source of truth" — verified by the other scenarios implicitly) and non-goals that describe absence-of-feature-code (NG-2: no SSE for health; NG-4: no history tracking; NG-5: no docker socket; NG-7: no configurable interval; NG-8: no dismissible footer; NG-9: no retry/backoff; NG-10: no caching) are verified by the absence of the corresponding code rather than by explicit scenarios.

**Coverage gaps:** none identified.

**Orphan scenarios:** none.
