# Web Dashboard - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Web Dashboard |
| Phase | 4 |
| Date | 2026-03-03 |
| Status | Final |

## Objective

Serve as the user's browser start page. The dashboard shows today's digest, recent entries grouped by day, quick stats, and a quick capture input. Live updates are delivered via Server-Sent Events (SSE) so new entries and digest content appear without page refresh.

## User Stories & Acceptance Criteria

### US-1: As a user, I want to see today's digest on the dashboard.

- **AC-1.1:** The dashboard shows the most recent daily digest content (cached from the last digest generation).
- **AC-1.2:** If no digest exists yet (e.g., first day of use), show a placeholder message: "No digest yet -- your first one arrives tomorrow at {configured time}" where `{configured time}` is derived from the `digest_daily_cron` setting.
- **AC-1.3:** When a new digest is generated (via cron), it is pushed to the dashboard via SSE and appears without a page refresh.

### US-2: As a user, I want to see recent entries grouped by day.

- **AC-2.1:** The dashboard shows the 5 most recent entries (not soft-deleted).
- **AC-2.2:** Entries are grouped by date with the most recent date first.
- **AC-2.3:** Each entry shows: category badge, name, and relative time (e.g., "2h ago").
- **AC-2.4:** Clicking an entry navigates to `/entry/:id` for the full view.
- **AC-2.5:** Soft-deleted entries (where `deleted_at` is not null) are NOT shown.
- **AC-2.6:** A "View all" link below the entries navigates to `/browse`.

### US-3: As a user, I want quick stats at a glance.

- **AC-3.1:** The dashboard displays three stats:
  - **Entries this week:** Count of entries created in the current calendar week.
  - **Open tasks:** Count of entries where `category = 'tasks'` and `fields->>'status' = 'pending'` and `deleted_at IS NULL`.
  - **Stalled projects:** Count of entries where `category = 'projects'` and `fields->>'status' = 'active'` and `updated_at` is older than 5 days and `deleted_at IS NULL`.
- **AC-3.2:** Stats update when entries change (via SSE push or recalculated on page load).

### US-4: As a user, I want to quickly capture a thought from the dashboard.

- **AC-4.1:** A single-line text input is displayed on the dashboard page. It accepts plain text (longer notes go to `/new`).
- **AC-4.2:** On submit (e.g., pressing Enter or clicking a submit button), the text is sent through the classification pipeline: classify with Claude (with context), generate embedding with Ollama, store in PostgreSQL with `source: 'webapp'`.
- **AC-4.3:** The new entry appears in the recent entries list via SSE without a page refresh.
- **AC-4.4:** The input is cleared after successful capture.
- **AC-4.5:** A brief confirmation is shown displaying the classification result: category, name, and confidence percentage.

### US-5: As a user, I want live updates without refreshing.

- **AC-5.1:** The dashboard connects to an SSE endpoint (e.g., `GET /api/events`) on page load.
- **AC-5.2:** New entries from any source (Telegram, MCP, webapp) appear in the recent entries list in real-time.
- **AC-5.3:** Entry updates (edits) and deletions (soft-delete) are reflected in real-time on the dashboard.
- **AC-5.4:** New digest content is pushed to the dashboard when a digest is generated.

## Constraints

- The dashboard is server-rendered HTML via Hono templates (not a SPA). SSE provides live updates by manipulating the DOM via lightweight client-side JavaScript.
- Tailwind CSS is used for styling, pre-built via the Tailwind CLI. No runtime CSS processing.
- The dashboard requires authentication (session cookie). Unauthenticated requests redirect to `/login`.
- The SSE connection must include the session cookie for authentication.
- Entries are queried from the `entries` table with `deleted_at IS NULL` to exclude soft-deleted entries.
- The "stalled" concept is derived (not stored): `category = 'projects'` AND `fields->>'status' = 'active'` AND `updated_at < now() - interval '5 days'`.
- Quick capture goes through the full classification pipeline (same as Telegram text capture), not a simplified version.

## Edge Cases

- **No entries yet (first-time use):** The recent entries section shows an empty state message (e.g., "No entries yet. Capture your first thought above or send a message via Telegram."). Stats show zeros.
- **SSE connection drops:** The client-side JavaScript automatically reconnects to the SSE endpoint. The `EventSource` API handles reconnection natively. On reconnect, the page may need to fetch missed updates (or the user can refresh).
- **Many entries:** Dashboard only shows the 5 most recent entries. The full list lives on `/browse`.
- **Unclassified entries:** Entries where `category IS NULL` (Claude API failure during classification) are shown with an "unclassified" badge. They still appear in the recent entries list.
- **Quick capture while Ollama is down:** The entry is saved without an embedding (`embedding: null`). The confirmation still shows the classification result. The embedding is retried by the background cron job.
- **Quick capture while Claude API is down:** The entry is saved with `category: null` and `confidence: null`. It appears in the recent entries list with an "unclassified" badge.
- **Multiple browser tabs:** Each tab opens its own SSE connection. All tabs receive the same updates.

## Non-Goals

- Customizable dashboard layout or widget system.
- Drag-and-drop reordering of dashboard sections.
- Dark mode is included in the design system (see `docs/plans/2026-03-06-web-design-system.md`). It is a CSS-only concern handled by the shared layout.
- Full-text editing on the dashboard (quick capture is a single input, not an editor).
- Inline editing of entries from the dashboard (clicking navigates to `/entry/:id`).
- Dashboard widgets for calendar, weather, or external services.
- Notification badges or unread counts.

## Resolved Questions

- **Quick capture input:** Single-line text field. Longer notes go to `/new`.
- **SSE payload:** Full entry objects. Simpler client JS, no follow-up fetches.
- **Digest collapsible?** No — always visible. It's the primary content.
- **Max entries on dashboard:** 5 most recent. "View all" links to `/browse`.

## Open Questions

None.
