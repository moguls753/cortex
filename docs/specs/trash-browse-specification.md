# Trash Browse - Behavioral Specification

## Objective

Provide a dedicated Trash page (`/trash`) in the navigation bar where users can view, filter, search, restore, and permanently delete soft-deleted entries. This closes the gap where soft-deleted entries are invisible and irrecoverable without direct database access. The page reuses the browse page's filtering and search capabilities scoped to deleted entries, following the design system's specification of Trash as a nav-level sibling to Browse.

## User Stories & Acceptance Criteria

### US-1: As a user, I want to see a Trash link in the navigation bar, so that I can access deleted entries from any page.

**AC-1.1:** The top navigation bar includes a "Trash" link between "Browse" and "Settings", matching the design system header wireframe (`brain cortex [v0.1] Search Browse Trash Settings`).

**AC-1.2:** The Trash nav item uses the `Trash2` Lucide icon at `size-3.5`, consistent with other nav items.

**AC-1.3:** When the user is on `/trash` (with or without query parameters), the Trash nav item is visually highlighted as active.

**AC-1.4:** The Trash nav item is always visible, regardless of whether deleted entries exist.

### US-2: As a user, I want to browse my deleted entries with the same filtering capabilities as the browse page, so that I can find a specific deleted entry in a large trash.

**AC-2.1:** `GET /trash` renders a page listing all entries where `deleted_at IS NOT NULL`, sorted by `deleted_at DESC` (most recently deleted first).

**AC-2.2:** Category tabs (All, People, Projects, Tasks, Ideas, Reference, Unclassified) filter within deleted entries. URLs follow the pattern `/trash?category=tasks`.

**AC-2.3:** Tag pills display tags present on deleted entries. Clicking a tag filters within deleted entries. URLs follow the pattern `/trash?tag=meeting`.

**AC-2.4:** Category and tag filters can be combined: `/trash?category=tasks&tag=meeting`.

**AC-2.5:** The search bar performs the same semantic-then-text-fallback search as browse, scoped to deleted entries. URLs follow the pattern `/trash?q=search+term`.

**AC-2.6:** Search, category, and tag filters can all be combined.

**AC-2.7:** Each entry row shows the same information as browse: category badge, entry name, and relative time. The time displayed is the `deleted_at` timestamp (when it was deleted), not `updated_at`.

### US-3: As a user, I want to restore a deleted entry from the trash, so that I can recover something I deleted by mistake.

**AC-3.1:** Clicking an entry in the trash list navigates to `/entry/:id`, which already displays the "Deleted" badge and "Restore" button for soft-deleted entries.

**AC-3.2:** After restoring an entry (via the existing `POST /entry/:id/restore`), the entry disappears from the trash list and reappears in browse, dashboard, and search results.

### US-4: As a user, I want to permanently delete a single entry, so that I can remove specific entries without emptying the entire trash.

**AC-4.1:** On the entry detail page (`/entry/:id`) for a soft-deleted entry, a "Delete permanently" button appears alongside the existing "Restore" button.

**AC-4.2:** The "Delete permanently" button is styled with the destructive color scheme (matching the existing "Delete" button styling).

**AC-4.3:** Clicking "Delete permanently" shows a browser confirmation dialog: "Permanently delete this entry? This cannot be undone."

**AC-4.4:** On confirmation, a `POST /entry/:id/permanent-delete` request hard-deletes the entry (`DELETE FROM entries WHERE id = :id`).

**AC-4.5:** If the entry has a `google_calendar_event_id`, no calendar API call is made during permanent delete (the calendar event was already cleaned up during soft-delete per AC-6.2 of the Google Calendar spec, or is orphaned).

**AC-4.6:** After permanent deletion, the user is redirected to `/trash`.

**AC-4.7:** If the entry does not exist or is not soft-deleted, the request returns a 404 response.

### US-5: As a user, I want to empty the entire trash at once, so that I can reclaim space and permanently remove all deleted entries.

**AC-5.1:** When the trash page has entries, an "Empty Trash" button is displayed in the page header area.

**AC-5.2:** Clicking "Empty Trash" shows a browser confirmation dialog: "Permanently delete all N entries in trash? This cannot be undone." (where N is the total count of all soft-deleted entries, not just the currently filtered view).

**AC-5.3:** On confirmation, a `POST /api/empty-trash` request hard-deletes all entries where `deleted_at IS NOT NULL`.

**AC-5.4:** The hard delete is not scoped by the current category, tag, or search filters — it always deletes all trashed entries regardless of active filters.

**AC-5.5:** After the operation completes, the page reloads showing the empty trash state.

**AC-5.6:** No Google Calendar API calls are made during empty trash (same rationale as AC-4.5).

### US-6: As a user, I want to see a clear empty state when the trash has no entries, so that I know there's nothing to restore or clean up.

**AC-6.1:** When no soft-deleted entries exist (and no filters are active), the trash page displays: "Trash is empty."

**AC-6.2:** When filters are active but no deleted entries match, the trash page displays: "No results found" with a suggestion to broaden filters (same pattern as browse).

**AC-6.3:** The "Empty Trash" button is not displayed when the trash is empty.

## Constraints

- **Design system:** Layout, typography, icons, and color tokens must follow `docs/plans/2026-03-06-web-design-system.md`. The page is described as "Same as browse but with restore/delete actions."
- **No inline styles:** All styling via Tailwind utility classes per project convention.
- **Server-rendered:** HTML rendered on the server via Hono, no client-side framework. Vanilla JS only for the "Empty Trash" confirmation and any interactive elements.
- **Shared query infrastructure:** Reuse `BrowseFilters` and the browse query functions (`browseEntries`, `semanticSearch`, `textSearch`, `getFilterTags`) by adding a `deleted` boolean to `BrowseFilters`, rather than duplicating query logic.
- **Icons:** Use existing `iconTrash2` from `src/web/icons.ts` for the nav item.

## Edge Cases

**EC-1:** User navigates to `/trash` when no entries have ever been deleted. The page renders with the empty state (AC-6.1). The "Empty Trash" button is hidden.

**EC-2:** User applies a category filter in trash, then clicks "Empty Trash." All trashed entries are deleted (not just the filtered ones) per AC-5.4. The confirmation dialog states the total count to make this clear.

**EC-3:** Entry is permanently deleted while another browser tab still shows it in the trash list. Clicking the stale link to `/entry/:id` returns 404.

**EC-4:** User permanently deletes an entry that has an orphaned Google Calendar event (soft-delete calendar cleanup previously failed). No calendar API call is attempted — the orphaned event remains on Google Calendar (consistent with the Google Calendar spec EC-6).

**EC-5:** Two family members empty trash simultaneously. The second request is a no-op (deletes 0 rows) and succeeds without error.

**EC-6:** `buildUrl` and `renderSearchBar` currently hardcode `/browse` as the base path. When rendering the trash page, these must use `/trash` as the base path so that category tabs, tag pills, and search form actions link to `/trash?...` instead of `/browse?...`.

## Non-Goals

**NG-1:** No auto-purge or TTL-based deletion. Soft-deleted entries remain in the database indefinitely until manually emptied. This was an explicit architectural decision.

**NG-2:** No undo for permanent deletion. Once hard-deleted, entries are irrecoverable. The confirmation dialog is the safety net.

**NG-3:** No per-user trash scoping. The current architecture is single-user (with multi-user planned). When multi-user is added, trash scoping will need to be revisited alongside entry ownership.

**NG-4:** No "select and delete" (checkbox multi-select for partial permanent deletion). The two deletion paths are: single entry via entry detail page, or all entries via "Empty Trash."

**NG-5:** No SSE updates for the trash page. The trash page is a simple server-rendered view without live updates.

## Open Questions

None. All decisions resolved during the design discussion.
