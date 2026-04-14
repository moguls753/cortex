# Web New Note - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Web New Note |
| Phase | 4 |
| Date | 2026-03-03 |
| Status | Draft |

## Objective

Create long-form notes with manual or AI-assisted categorization. The new note page provides a full editor experience for capturing longer thoughts, articles, or structured entries that go beyond the quick capture input on the dashboard.

## User Stories & Acceptance Criteria

### US-1: As a user, I want to write a new note with a full editor.

- **AC-1.1:** `GET /new` shows a form with: name input (text field), category dropdown (People, Projects, Tasks, Ideas, Reference, plus an empty/unselected option), tag input (with autocomplete), and markdown textarea for content.
- **AC-1.2:** The markdown textarea supports plain text entry. No WYSIWYG toolbar is needed -- the user writes raw markdown.
- **AC-1.3:** The tags input autocompletes from existing tags in the database. The user can also type new tags that do not yet exist.

### US-2: As a user, I want AI to suggest the category and tags for my note.

- **AC-2.1:** An "AI Suggest" button sends the current note content (name + body) to the classification pipeline (Claude API with context).
- **AC-2.2:** The suggested category is pre-selected in the category dropdown.
- **AC-2.3:** Suggested tags are added to the tag input (appended to any tags the user has already entered).
- **AC-2.4:** The user can accept, modify, or override the AI suggestions. The suggestions do not lock any fields.
- **AC-2.5:** "AI Suggest" can be used multiple times as the content changes. Each invocation replaces the previous AI suggestions (but preserves user-added tags).

### US-3: As a user, I want to save my note.

- **AC-3.1:** Save generates an embedding for the note content via Ollama (qwen3-embedding).
- **AC-3.2:** The entry is stored in PostgreSQL with `source: 'webapp'` and `confidence: null` (manual entry).
- **AC-3.3:** Category-specific fields are populated based on the selected category. Default values are used for fields not explicitly set (e.g., `status: 'active'` for projects, `status: 'pending'` for tasks).
- **AC-3.4:** After successful save, the user is redirected to `/entry/:id` to view the newly created entry.
- **AC-3.5:** If embedding generation fails (Ollama is down), the note is still saved with `embedding: null`. The background cron job retries embedding generation later.

## Constraints

- The new note page is server-rendered HTML via Hono templates. Form submission is a standard POST request.
- The new note page requires authentication (session cookie).
- The "AI Suggest" button requires a client-side JavaScript call to an API endpoint (e.g., `POST /api/classify`) that returns the classification result as JSON. The client-side script updates the form fields with the suggestions.
- Tag autocomplete requires a client-side JavaScript call to an API endpoint (e.g., `GET /api/tags`) that returns existing tags.
- The `name` field is required. Save must be rejected if name is empty (client-side validation and server-side validation).
- The `content` field is optional. A note with only a title and no body is allowed.
- If no category is selected and "AI Suggest" was not used, the entry is saved with `category: null` (unclassified).

## Edge Cases

- **Empty note (no content):** The name is required, but content is optional. A note with only a title and category is valid. "AI Suggest" with empty content should not call the API -- it should show a message like "Write some content first."
- **Note with only a title (no body):** Valid. The embedding is generated from the name alone. Classification via "AI Suggest" uses only the name.
- **Very long note:** No artificial limit on content length. The database `TEXT` column supports arbitrarily long content. Embedding generation handles long text (Ollama truncates internally if needed).
- **AI Suggest with empty content:** The "AI Suggest" button should be disabled or show a warning if both name and content are empty. If only the name is filled, AI Suggest can still classify based on the name.
- **Saving while Ollama is down:** The note is saved without an embedding (`embedding: null`). The entry is fully browsable and editable, just not discoverable via semantic search. The background cron retries embedding generation every 15 minutes.
- **Duplicate name:** Allowed. Entries are identified by UUID, not by name. Multiple entries can have the same name.
- **AI Suggest while Claude API is down:** The "AI Suggest" button returns an error message (e.g., "Classification service unavailable. You can still save the note and classify it later."). The form remains editable and saveable.
- **Category-specific fields on save:** When a category is selected, the corresponding default fields are created in the `fields` JSONB column. If no category is selected, `fields` remains `{}`.
- **Tags with special characters:** Tags should be lowercase and trimmed. Special characters (spaces, punctuation) should be handled gracefully (e.g., stripped or rejected).

## Non-Goals

- Auto-save or draft system. If the user navigates away without saving, the content is lost.
- File attachments or image uploads.
- Markdown preview pane (live preview of rendered markdown while typing).
- Collaborative editing or sharing the editor.
- Note templates (pre-filled forms for specific categories).
- Importing content from external sources (clipboard, URL, file).

## Open Questions

- Should "AI Suggest" also suggest a name/title, or only category and tags?
- Should the category-specific fields (e.g., status, due_date, next_action) be shown on the new note form, or only appear after saving when viewing/editing the entry?
- Should there be a "Save and New" button for rapid successive note creation?
- Should the form warn the user about unsaved changes when navigating away (via `beforeunload` event)?
