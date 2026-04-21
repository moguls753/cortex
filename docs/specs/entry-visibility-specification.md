# Entry Visibility — Behavioral Specification

## Objective

Add a per-entry `visibility` flag, inferred automatically by the LLM during classification, that gates which entries appear on out-of-band surfaces that other household members can see. The domain is exactly two values: `private` (personal, sensitive, or surprise content — never surfaced outside the webapp / MCP) and `shared` (household-appropriate — eligible for the kitchen display and any future cross-user surface).

The driving use case is surprise prevention: captures like "pick up ring for Luisa's birthday" must not leak to the kitchen display, where the recipient of the surprise could see them. A secondary use case is protection of personal content — health notes, relationship observations, work-sensitive material — from casual household view when the screen is visible to others.

Motivation: today, every `tasks` entry regardless of its content lands on the kitchen display. The only prevention is self-censorship at capture time, which contradicts the project's "one behavior" principle. Automatic LLM classification plus a one-tap correction loop (on low-confidence captures) lets the user keep capturing freely while the system handles the sensitivity decision with a fail-safe default.

## User Stories & Acceptance Criteria

### US-1: Automatic visibility inference

**As a Cortex user, I want the LLM to infer whether each captured entry is private or shared, so that I do not have to make this decision manually for every capture.**

- **AC-1.1:** The classification JSON returned by the LLM includes a `visibility` key whose value is exactly `"private"` or `"shared"`. The key is emitted in English regardless of `output_language`, mirroring the existing enum-only-English rule on `category` and `status`.
- **AC-1.2:** The classification prompt (`prompts/classify.md`) documents the inference heuristic: visibility is `private` when content indicates a surprise, gift for a named recipient, personal reflection, health, finance, relationship observation, or work-sensitive matter; `shared` when content reads as a household or logistical task, group plan, public information, or reference. When uncertain, the LLM returns `private`.
- **AC-1.3:** When the LLM returns a valid `visibility` value and the overall `confidence` satisfies `confidence >= confidence_threshold`, the entry is stored with the LLM-returned visibility.
- **AC-1.4:** When `confidence < confidence_threshold`, the entry is stored with `visibility = 'private'` regardless of what the LLM returned. The existing `confidence_threshold` setting governs this fail-safe; no new threshold is introduced.
- **AC-1.5:** When the LLM returns an invalid `visibility` value (not in `{"private", "shared"}`), the entry is stored with `visibility = 'private'`.
- **AC-1.6:** When the LLM omits the `visibility` key entirely, the entry is stored with `visibility = 'private'`.
- **AC-1.7:** When classification fails (LLM unavailable, invalid JSON, timeout), the entry is stored with `visibility = 'private'` and `category = null`, following the existing unclassified-entry path. A subsequent retry via `classifyEntry` re-infers visibility along with the other fields.

### US-2: Kitchen display filters out private entries

**As a household whose kitchen display shows Cortex content, I want private entries to never appear there, so that surprises and personal content stay hidden.**

- **AC-2.1:** `getDisplayTasks` in `src/display/task-data.ts` filters rows with `visibility = 'shared'` in addition to the existing `category = 'tasks' AND deleted_at IS NULL AND (status = 'pending' OR recently done)` conditions. Private tasks never appear in the returned array.
- **AC-2.2:** Any future display-side query that reads the `entries` table for any category must include the `visibility = 'shared'` filter. This is a forward constraint — at spec time only tasks are read; this rule applies to any extension.
- **AC-2.3:** Calendar events rendered on the kitchen display are read from Google Calendar (not from the `entries` table) and are not affected by the visibility filter. See NG-5 for the rationale.

### US-3: Telegram-level correction on low-confidence replies

**As a user who captures via Telegram, I want a one-tap correction for visibility on the same replies that already offer category correction, so that I can fix the LLM's call without navigating to the webapp.**

- **AC-3.1:** When the Telegram user taps the visibility toggle button on a reply, the entry's `visibility` is updated via a direct `UPDATE entries SET visibility = ... WHERE id = ...` query. No LLM re-classification is invoked.
- **AC-3.2:** After the toggle, the bot edits the original message to reflect the new state: the `👁` glyph is added or removed, and the toggle button's label is updated to the new inverse target.
- **AC-3.3:** The visibility toggle button appears only on low-confidence Telegram replies (those where `confidence < confidence_threshold`), alongside the 5 category-correction buttons. Both low-confidence-shared and low-confidence-private replies include the toggle; the button's label is `"🔒 Make private"` when current visibility is `shared` and `"👁 Make shared"` when current visibility is `private`.
- **AC-3.4:** On a confident reply (`confidence >= confidence_threshold`) with `visibility = 'shared'`, the reply text includes the `👁` glyph before the category label. No inline toggle button is attached.
- **AC-3.5:** On a confident reply with `visibility = 'private'`, the reply text includes no visibility glyph and no inline toggle button. Correction from the confident path uses the webapp edit page or the `/fix` command.
- **AC-3.6:** The callback_data for the toggle button is `visibility:<entry-uuid>:<target-value>` where target-value is `private` or `shared`. The handler validates the UUID, validates the target value, and issues the UPDATE.

### US-4: Webapp indicator and manual override

**As a user reviewing my brain in the webapp, I want to see at a glance which entries are shared, and be able to flip visibility on the edit form, so that I can audit the LLM's classification and override it when it misses.**

- **AC-4.1:** Every webapp list view that renders entries (`/` dashboard recent-entries block, `/browse` cards, `/trash` rows) displays a Lucide-family icon indicating "shared" next to the category badge on entries where `visibility = 'shared'`. Entries with `visibility = 'private'` show no indicator.
- **AC-4.2:** The entry view page (`/entry/:id`) displays the same "shared" icon next to the category badge when `visibility = 'shared'`.
- **AC-4.3:** The entry edit page (`/entry/:id/edit`) includes a two-option control (radio or button-toggle) for visibility, with the current value pre-selected. Submitting the form with `visibility = "private"` or `visibility = "shared"` updates the entry.
- **AC-4.4:** The edit-form POST validates the submitted `visibility` value against `{"private", "shared"}`. A missing or invalid value returns HTTP 422 and re-renders the form with an error message. The stored value is not modified on validation failure.
- **AC-4.5:** The webapp does NOT filter any list, search, or view by visibility. The user sees every entry regardless of visibility. The only visual effect of visibility in the webapp is the per-entry icon.

### US-5: MCP tool exposure

**As an agent operating on Cortex via MCP, I want to read and set the visibility of entries, so that agent-driven captures can respect user intent and agent-driven retrieval can report the flag.**

- **AC-5.1:** The response payload of `search_brain`, `list_recent`, and `get_entry` includes a `visibility` field per entry, set to the entry's stored value.
- **AC-5.2:** The `add_thought` tool accepts an optional `visibility` parameter. When supplied with `"private"` or `"shared"`, the explicit value is stored and the LLM's inferred visibility is discarded (the fail-safe threshold does not apply to explicit overrides). When omitted, the LLM-inferred value is used with the full fail-safe semantics from US-1.
- **AC-5.3:** An `add_thought` call with `visibility` set to any value other than `"private"` or `"shared"` returns an error response and does not store the entry.
- **AC-5.4:** The `update_entry` tool accepts an optional `visibility` parameter. When supplied with `"private"` or `"shared"`, the entry's visibility is updated to the submitted value. When omitted, visibility is unchanged.
- **AC-5.5:** An `update_entry` call with `visibility` set to an invalid value returns an error response and does not write the other submitted fields.
- **AC-5.6:** The `delete_entry` and `brain_stats` tools are unchanged.

### US-6: SSE payload includes visibility

**As a webapp client rendering live updates, I want SSE events to carry the entry's visibility, so that I can render the indicator without re-fetching the entry.**

- **AC-6.1:** The `entry:created` and `entry:updated` SSE events include `visibility` in their `data` payload. The payload schema becomes `{ id, name, category, confidence, visibility }`.
- **AC-6.2:** The `entry:deleted` SSE event is unchanged; it carries only `id`.
- **AC-6.3:** The PostgreSQL NOTIFY trigger (`notify_entry_change` in `src/db/index.ts`) is updated to include `visibility` in the JSONB payload for INSERT and UPDATE events. The trigger's existing skip condition (don't fire when only embedding or `updated_at` changed) is extended so that visibility-only changes DO fire an `entry:updated` event.

## Constraints

### Technical

- **T-1:** The database column is defined inline in the migration as `visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared'))`. Added to the `entries` table via `ALTER TABLE entries ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared'))` in `src/db/index.ts`'s migration block, following the existing `ADD COLUMN IF NOT EXISTS` pattern for calendar columns.
- **T-2:** Existing rows at migration time receive `visibility = 'private'` via the column `DEFAULT`. No separate data-migration script is written.
- **T-3:** The CHECK constraint is enforced at the database level. A direct DB write with an invalid value (e.g., via raw SQL) is rejected by Postgres independently of application-layer validation.
- **T-4:** The visibility fail-safe reuses the existing `confidence_threshold` setting. No new setting is introduced.
- **T-5:** Drizzle's schema (`src/db/schema.ts`) is updated to declare the `visibility` column with the same constraint. The Drizzle declaration and the raw-SQL migration must agree; the migration is authoritative and the schema declaration is a typing convenience.
- **T-6:** Shared TypeScript constants — `VISIBILITY_VALUES = ['private', 'shared'] as const`, and a `Visibility` union type — are added to `src/web/shared.ts` and re-used across the webapp, Telegram, MCP, and classify modules. The application layer never hard-codes the literal strings apart from in `shared.ts`.

### Business

- **B-1:** The kitchen display filter `visibility = 'shared'` is not user-configurable. It is a structural rule of the display, not a preference.
- **B-2:** The driving use case is single-user / single-household. Multi-household sharing is out of scope.

### Operational

- **O-1:** One new database column on `entries`. No new tables. No new index on `visibility` — the single-user deployment's row count is too small to benefit.
- **O-2:** No new environment variables. No changes to `.env.example`.
- **O-3:** No new NPM dependencies.

## Edge Cases

- **EC-1:** LLM returns `visibility: null` or omits the key → stored as `'private'` (AC-1.5, AC-1.6).
- **EC-2:** LLM returns a string other than `"private"`/`"shared"` (e.g., `"public"`, `"household"`) → stored as `'private'`.
- **EC-3:** `confidence < confidence_threshold` and LLM returned `"shared"` → stored as `'private'` (fail-safe overrides LLM intent).
- **EC-4:** `confidence < confidence_threshold` and LLM returned `"private"` → stored as `'private'` (consistent with fail-safe; no change from the LLM's intent).
- **EC-5:** Classification fails entirely → stored as `'private'` with `category = null`. A subsequent retry path re-infers both fields.
- **EC-6:** User edits the entry via webapp and changes visibility → the stored value overrides any prior value (including LLM inference).
- **EC-7:** User taps the Telegram visibility toggle button on a low-confidence reply → visibility is flipped via a pure UPDATE. No LLM call. The bot edits the original reply to reflect the new state.
- **EC-8:** Webapp edit form submitted with `visibility = ""` (empty string) → HTTP 422, error rendered on the form, entry unchanged.
- **EC-9:** MCP `add_thought` with explicit `visibility = "private"` and LLM infers `"shared"` → stored as `'private'`. Explicit override wins (AC-5.2).
- **EC-10:** MCP `add_thought` with `visibility = "invalid"` → error response, entry not stored (AC-5.3).
- **EC-11:** MCP `update_entry` with `visibility = "shared"` and no other fields → only visibility is updated; all other fields unchanged.
- **EC-12:** Concurrent edits — user edits visibility via webapp at the same moment as a Telegram toggle tap → last write wins, standard Postgres UPDATE semantics, no locking.
- **EC-13:** Soft-deleted entries preserve their `visibility` value. Restoring them does not change visibility. They already do not appear on the kitchen display because the display filters `deleted_at IS NULL`.
- **EC-14:** A private entry has `create_calendar_event: true` and the configured Google Calendar is shared with household members → the calendar event is created on the configured calendar regardless of visibility. Users with a mixed personal + shared calendar setup rely on the LLM's multi-calendar routing (`calendar_name`) to land private-intent events on their personal calendar; users with only a shared calendar accept the residual leak risk for calendar-bearing private entries. See NG-5.
- **EC-15:** Telegram voice capture → follows the same reply-format rules as text capture. Confident shared includes the `👁` glyph; low-confidence includes the visibility toggle button.
- **EC-16:** Telegram `/fix` command with correction text that implies a visibility change (e.g., `/fix this should be private`) → `reclassifyEntry` runs the full classification pipeline with the correction context. The LLM may return a new `visibility` value. The fail-safe still applies to the re-classified result.
- **EC-17:** LLM classification returns a valid category but omits visibility AND overall confidence is above threshold → entry is stored with the LLM's category at high confidence, `visibility = 'private'` per AC-1.6. The confidence threshold does not fire; the fail-safe is structural (invalid/missing visibility always defaults to private regardless of confidence).

## Non-Goals

- **NG-1:** Not partitioning entries by user or chat_id. Entries remain a single table with no `user_id` column. The single-user architecture is preserved per CLAUDE.md and ARCHITECTURE.md v3.
- **NG-2:** Not filtering the webapp by visibility. Dashboard, browse, search, trash, entry view, and settings all show every entry regardless of visibility. The user is the sole webapp operator.
- **NG-3:** Not filtering digests by visibility. Daily and weekly digests are generated from the full entry corpus and delivered to the configured user email. Private entries are included.
- **NG-4:** Not filtering MCP tools' read responses by visibility. Agents act on the user's behalf and see the full corpus. Visibility is informational, not authorization, at the MCP layer.
- **NG-5:** Not gating Google Calendar writes by visibility. `create_calendar_event = true` on a private entry still creates an event on the configured Google Calendar. Calendar leakage via shared calendars is a calendar-configuration concern, not a Cortex filtering concern. The LLM's multi-calendar routing via `calendar_name` is the correct mechanism to keep private events on a personal calendar.
- **NG-6:** Not introducing a second confidence threshold for visibility. The existing `confidence_threshold` setting governs both category and visibility fail-safes.
- **NG-7:** Not introducing a `household_context` setting. Visibility inference is content-only. A future feature spec may add household/user context to the classifier prompt, but it is not coupled to entry-visibility.
- **NG-8:** Not supporting a third visibility value. The domain is exactly `{"private", "shared"}`. No `"household-only"`, `"public"`, `"work"`, `"team"` values.
- **NG-9:** Not auto-escalating visibility over time. Visibility is a static per-entry flag; there is no "shared after 30 days" or "expires back to private" logic.
- **NG-10:** Not applying a per-chat-id default. The wife's chat_id and the user's chat_id are treated identically; visibility is inferred from content, not from the capturing chat_id.
- **NG-11:** Not adding a visibility toggle button on confident Telegram replies. The toggle appears only on low-confidence replies. Confident-but-wrong visibility calls are corrected via the webapp edit page or the `/fix` command — a webapp round-trip that is acceptable given the rarity of the case.
- **NG-12:** Not changing the behavior of classify's internal context-assembly (`assembleContext`, `getRecentEntries`, `getSimilarEntries`). The LLM continues to read across all entries for classification context — this is an internal read that is never echoed to another chat and therefore does not require the visibility filter.

## Open Questions

None outstanding. The pre-spec brainstorm resolved each open design point:

- Migration default for existing entries: flat `private` (home project with zero data; safest default).
- Column shape: `TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared'))`.
- Fail-safe confidence threshold: reuse existing `confidence_threshold`, no new setting.
- Google Calendar gating: not gated; routing stays orthogonal.
- Classification heuristic: content-only, fail-safe carries residual safety.
- Telegram toggle presence: low-confidence replies only.
- Webapp visual indicator: icon on `shared` only (sparse signal for outbound).
- MCP `add_thought`: optional explicit override; otherwise LLM-inferred with fail-safe.
