# Web Entry - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Web Entry |
| Phase | 4 |
| Date | 2026-03-03 |
| Status | Complete |

## Objective

View, edit, and soft-delete individual entries. The entry page is the detailed view for any entry in the knowledge base, accessible from the dashboard, browse page, or direct URL.

## User Stories & Acceptance Criteria

### US-1: As a user, I want to view an entry with rendered markdown.

- **AC-1.1:** `GET /entry/:id` shows the entry with: name, category badge, tags, content (rendered markdown), category-specific fields, timestamps (`created_at`, `updated_at`), source (telegram/webapp/mcp), and confidence score.
- **AC-1.2:** Markdown content is rendered to HTML supporting: headings, lists (ordered and unordered), bold, italic, code blocks (inline and fenced), and links.
- **AC-1.3:** If the entry does not exist (invalid UUID or no matching row), show a 404 page.
- **AC-1.4:** If the entry is soft-deleted (`deleted_at` is not null), show it with a "deleted" badge and a restore option (button to set `deleted_at` back to null).

### US-2: As a user, I want to edit an entry.

- **AC-2.1:** An "Edit" button on the entry view links to `GET /entry/:id/edit`. A "Cancel" link returns to `GET /entry/:id`.
- **AC-2.2:** Edit mode shows:
  - Text input for name.
  - Category dropdown with all five categories (People, Projects, Tasks, Ideas, Reference).
  - Tag input with autocomplete from existing tags in the database.
  - Markdown textarea for content.
  - Category-specific field inputs (e.g., status dropdown for Projects/Tasks, due_date input for Tasks, context and follow_ups textareas for People, etc.).
- **AC-2.3:** Save validates required fields: `name` is required and cannot be empty.
- **AC-2.4:** Save re-generates the embedding via Ollama (because content may have changed).
- **AC-2.5:** Save updates the `updated_at` timestamp (handled automatically by the database trigger).
- **AC-2.6:** Confidence is set to `null` on manual edit (indicating a user override of the original classification).

### US-3: As a user, I want to soft-delete an entry.

- **AC-3.1:** A "Delete" button on the entry view shows a confirmation dialog (e.g., "Are you sure you want to delete this entry?").
- **AC-3.2:** Confirming the deletion sets `deleted_at` to the current timestamp.
- **AC-3.3:** After deletion, the user is redirected to the previous page (referrer) or the dashboard if no referrer is available.
- **AC-3.4:** The entry moves to the trash (visible at `/trash`) and can be restored.

## Constraints

- The entry page is server-rendered HTML via Hono templates. Edit mode is a separate route (`GET /entry/:id/edit`, `POST /entry/:id/edit`).
- Markdown rendering must be done server-side for the view mode. A lightweight markdown library (e.g., marked, markdown-it) is used.
- The entry page requires authentication (session cookie).
- The `:id` parameter is a UUID. Invalid UUIDs should be handled gracefully (404 page, not a server error).
- Category-specific fields are stored in the `fields` JSONB column. The edit form must render different input fields based on the selected category.
- Re-generating the embedding on save is an asynchronous operation. If Ollama is down, the entry is saved with the previous embedding (or null if it had none). The background cron job will retry.
- The `updated_at` timestamp is updated by the database trigger, not by the application code.

## Edge Cases

- **Editing an entry while it is being updated by Telegram/MCP:** The last write wins. There is no locking or conflict resolution. The entry page shows the state at the time of the GET request. If another source updates the entry between the user's GET and POST, the user's save overwrites those changes.
- **Entry with null category (unclassified):** The entry view shows an "unclassified" badge instead of a category badge. In edit mode, the category dropdown has no selection, and the user can assign a category. No category-specific fields are shown until a category is selected.
- **Entry with null embedding:** The entry is fully viewable and editable. It simply does not appear in semantic search results. No special indicator is needed on the entry page.
- **Editing tags (autocomplete from existing tags):** The tag input provides suggestions from all unique tags in the database. The user can also type new tags that do not yet exist.
- **Category change requires field migration:** When changing an entry's category (e.g., from Project to Task), the old category-specific fields are replaced with the new category's default fields. For example, changing from `projects` to `tasks` replaces `{ status, next_action, notes }` with `{ due_date, status, notes }`. The `status` field may carry over if applicable, but `next_action` is dropped and `due_date` is set to null.
- **Very long content:** The markdown textarea should not impose an artificial limit. The database `TEXT` column supports arbitrarily long content. The rendered view should handle long content gracefully (scrolling, no layout breaks).
- **Entry with source: 'telegram' and source_type: 'voice':** The entry view shows a "voice" indicator alongside the source badge to indicate it was originally a voice message.

## Non-Goals

- Collaborative editing or real-time multi-user editing.
- Version history or undo/redo for edits.
- Comments or annotations on entries.
- Sharing entries via public links.
- Entry linking or relationship management (parent/child, related entries).
- Markdown preview pane during editing (the user writes raw markdown and sees it rendered after save).
- File or image attachments on entries.

## Resolved Questions

- **Edit mode:** Separate route (`GET /entry/:id/edit`, `POST /entry/:id/edit`). Server-rendered, no client-side toggle.
- **Cancel button:** Yes — a link back to `/entry/:id`. No unsaved changes warning (no client-side JS needed).
- **Category change fields:** Old category-specific fields are replaced with new category defaults. No hidden preservation.
- **Related entries:** Not included. Entry page stays focused on viewing/editing/deleting a single entry.
