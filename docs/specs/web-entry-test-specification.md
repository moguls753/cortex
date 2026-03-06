# Web Entry - Test Specification

| Field | Value |
|-------|-------|
| Feature | Web Entry |
| Phase | 2 |
| Date | 2026-03-06 |
| Derives From | `web-entry-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|-------------------|
| AC-1.1: Entry view shows all fields | TS-1.1 (also Edit + Delete buttons) |
| AC-1.2: Markdown rendered to HTML | TS-1.2 |
| AC-1.3: Non-existent entry shows 404 | TS-1.3, TS-1.4 |
| AC-1.4: Soft-deleted entry shows deleted badge + restore | TS-1.5, TS-1.6 |
| AC-2.1: Edit button links to edit page, Cancel returns | TS-1.1, TS-2.1 |
| AC-2.2: Edit form shows all field inputs | TS-2.1, TS-2.2 |
| AC-2.3: Save validates name required | TS-2.4 |
| AC-2.4: Save re-generates embedding | TS-2.5 |
| AC-2.5: Save updates updated_at (DB trigger) | TS-2.3 |
| AC-2.6: Confidence set to null on edit | TS-2.6 |
| AC-3.1: Delete button with confirmation | TS-1.1, TS-3.1 |
| AC-3.2: Confirming sets deleted_at | TS-3.1 |
| AC-3.3: Redirect after deletion | TS-3.2, TS-3.3 |
| AC-3.4: Entry moves to trash | TS-3.1 |
| Constraint: Server-rendered HTML | TS-4.1 |
| Constraint: Markdown server-side rendering | TS-1.2 |
| Constraint: Auth required | TS-4.2, TS-4.3 |
| Constraint: Invalid UUID handled gracefully | TS-1.3 |
| Constraint: Category-specific fields in JSONB | TS-2.2 |
| Constraint: Embedding re-gen fallback if Ollama down | TS-5.4 |
| Constraint: updated_at via DB trigger | TS-2.3 |
| Constraint: Edit mode is separate route | TS-2.1 |
| EC-1: Concurrent edit (last write wins) | Not testable at unit/integration level |
| EC-2: Null category (unclassified) | TS-5.1, TS-5.2 |
| EC-3: Null embedding | TS-5.9 |
| EC-4: Tag autocomplete | TS-5.7 |
| EC-5: Category change field migration | TS-5.3 |
| EC-6: Very long content | TS-5.6 |
| EC-7: Voice source indicator | TS-5.5 |

## Test Scenarios

### Group 1: View Entry (US-1)

#### TS-1.1: Entry view displays all fields

```
Scenario: Entry view displays all fields
  Given the user is authenticated
  And an entry exists with name, category "projects", tags, markdown content, source "telegram", source_type "text", confidence 0.85, and category-specific fields
  When the user views the entry
  Then the entry name is displayed
  And the category is shown as a badge
  And the tags are displayed
  And the content is rendered as HTML (not raw markdown)
  And the category-specific fields are displayed
  And created_at and updated_at timestamps are shown
  And the source is shown as "telegram"
  And the confidence score is displayed
  And an Edit button linking to the edit page is present
  And a Delete button is present
```

**Traces to:** AC-1.1, AC-2.1, AC-3.1

---

#### TS-1.2: Markdown content rendered to HTML

```
Scenario: Markdown content rendered to HTML
  Given the user is authenticated
  And an entry exists with markdown content containing headings, bold, italic, ordered list, unordered list, inline code, fenced code block, and a link
  When the user views the entry
  Then headings are rendered as HTML heading elements
  And bold and italic text are rendered with emphasis elements
  And lists are rendered as HTML list elements
  And inline code is rendered in code elements
  And fenced code blocks are rendered in pre/code elements
  And links are rendered as anchor elements
```

**Traces to:** AC-1.2

---

#### TS-1.3: Invalid UUID returns 404 page

```
Scenario: Invalid UUID returns 404 page
  Given the user is authenticated
  When the user requests an entry with id "not-a-uuid"
  Then a 404 page is returned
  And no server error occurs
```

**Traces to:** AC-1.3, C-4

---

#### TS-1.4: Valid UUID with no matching row returns 404 page

```
Scenario: Valid UUID with no matching row returns 404 page
  Given the user is authenticated
  And no entry exists with the given UUID
  When the user requests the entry
  Then a 404 page is returned
```

**Traces to:** AC-1.3

---

#### TS-1.5: Soft-deleted entry shows deleted badge and restore option

```
Scenario: Soft-deleted entry shows deleted badge and restore option
  Given the user is authenticated
  And a soft-deleted entry exists (deleted_at is set)
  When the user views the entry
  Then the entry content is displayed
  And a "deleted" badge is shown
  And a restore option is available
```

**Traces to:** AC-1.4

---

#### TS-1.6: Restoring a soft-deleted entry clears deleted_at

```
Scenario: Restoring a soft-deleted entry clears deleted_at
  Given the user is authenticated
  And a soft-deleted entry exists
  When the user restores the entry
  Then deleted_at is set to null
  And the entry no longer shows the deleted badge
```

**Traces to:** AC-1.4

---

### Group 2: Edit Entry (US-2)

#### TS-2.1: Edit page loads with pre-populated form

```
Scenario: Edit page loads with pre-populated form
  Given the user is authenticated
  And an entry exists with name "Meeting Notes", category "projects", tags ["work", "weekly"], content "# Summary\nGood progress", and category-specific fields
  When the user loads the edit page for the entry
  Then the name input is pre-populated with "Meeting Notes"
  And the category dropdown shows "projects" selected
  And the tags input shows "work" and "weekly"
  And the content textarea contains the raw markdown
  And category-specific field inputs are pre-populated
  And a Cancel link is present that points to the entry view
```

**Traces to:** AC-2.1, AC-2.2, C-8

---

#### TS-2.2: Edit form shows category-specific fields

```
Scenario: Edit form shows category-specific fields
  Given the user is authenticated
  And a "tasks" entry exists with fields { due_date, status, notes }
  When the user loads the edit page
  Then input fields for due_date, status, and notes are shown
  And the fields are pre-populated with existing values
```

**Traces to:** AC-2.2, C-5

---

#### TS-2.3: Save updates entry and updated_at changes

```
Scenario: Save updates entry and updated_at changes
  Given the user is authenticated
  And an entry exists with name "Old Name"
  When the user saves the entry with name "New Name"
  Then the entry name is updated to "New Name"
  And updated_at is different from the original value
```

**Traces to:** AC-2.3, AC-2.5, C-7

---

#### TS-2.4: Save with empty name returns validation error

```
Scenario: Save with empty name returns validation error
  Given the user is authenticated
  And an entry exists
  When the user saves the entry with an empty name
  Then a validation error is returned indicating name is required
  And the entry is not modified
```

**Traces to:** AC-2.3

---

#### TS-2.5: Save re-generates embedding

```
Scenario: Save re-generates embedding
  Given the user is authenticated
  And an entry exists with content "old content" and an embedding
  When the user saves the entry with content "completely new content"
  Then the embedding is re-generated for the updated content
```

**Traces to:** AC-2.4

---

#### TS-2.6: Save sets confidence to null

```
Scenario: Save sets confidence to null
  Given the user is authenticated
  And an entry exists with confidence 0.85
  When the user saves the entry (with or without changes)
  Then the entry's confidence is set to null
```

**Traces to:** AC-2.6

---

### Group 3: Delete Entry (US-3)

#### TS-3.1: Soft-delete sets deleted_at timestamp

```
Scenario: Soft-delete sets deleted_at timestamp
  Given the user is authenticated
  And an active entry exists (deleted_at is null)
  When the user confirms deletion of the entry
  Then deleted_at is set to the current timestamp
  And the entry is not permanently removed from the database
```

**Traces to:** AC-3.1, AC-3.2, AC-3.4

---

#### TS-3.2: After deletion, redirect to referrer

```
Scenario: After deletion, redirect to referrer
  Given the user is authenticated
  And an active entry exists
  And the request includes a referrer header pointing to the browse page
  When the user deletes the entry
  Then the user is redirected to the browse page
```

**Traces to:** AC-3.3

---

#### TS-3.3: After deletion without referrer, redirect to dashboard

```
Scenario: After deletion without referrer, redirect to dashboard
  Given the user is authenticated
  And an active entry exists
  And the request has no referrer header
  When the user deletes the entry
  Then the user is redirected to the dashboard
```

**Traces to:** AC-3.3

---

### Group 4: Constraints

#### TS-4.1: Entry page returns server-rendered HTML

```
Scenario: Entry page returns server-rendered HTML
  Given the user is authenticated
  And an entry exists
  When the user views the entry
  Then the response content-type is HTML
  And the response body contains the entry content as rendered HTML
```

**Traces to:** C-1

---

#### TS-4.2: Unauthenticated view request redirected to login

```
Scenario: Unauthenticated view request redirected to login
  Given the user is not authenticated
  When the user requests an entry page
  Then the user is redirected to /login
```

**Traces to:** C-3

---

#### TS-4.3: Unauthenticated edit request redirected to login

```
Scenario: Unauthenticated edit request redirected to login
  Given the user is not authenticated
  When the user requests the edit page for an entry
  Then the user is redirected to /login
```

**Traces to:** C-3

---

### Group 5: Edge Cases

#### TS-5.1: Entry with null category shows unclassified badge

```
Scenario: Entry with null category shows unclassified badge
  Given the user is authenticated
  And an entry exists with category set to null
  When the user views the entry
  Then an "unclassified" badge is shown instead of a category badge
```

**Traces to:** EC-2

---

#### TS-5.2: Editing entry with null category has no category preselected

```
Scenario: Editing entry with null category has no category preselected
  Given the user is authenticated
  And an entry exists with category set to null
  When the user loads the edit page
  Then the category dropdown has no selection
  And no category-specific fields are shown
```

**Traces to:** EC-2

---

#### TS-5.3: Category change replaces fields with new category defaults

```
Scenario: Category change replaces fields with new category defaults
  Given the user is authenticated
  And a "projects" entry exists with fields { status: "active", next_action: "review", notes: "some notes" }
  When the user changes the category to "tasks" and saves
  Then the fields are updated to tasks defaults { due_date: null, status: "active", notes: "some notes" }
  And the "next_action" field is dropped
  And the "due_date" field is set to null
```

**Traces to:** EC-5

---

#### TS-5.4: Save with Ollama down preserves previous embedding

```
Scenario: Save with Ollama down preserves previous embedding
  Given the user is authenticated
  And an entry exists with an existing embedding
  And the Ollama embedding service is unavailable
  When the user saves the entry with updated content
  Then the entry is saved successfully
  And the previous embedding is preserved (not set to null)
```

**Traces to:** C-6

---

#### TS-5.5: Entry with voice source shows voice indicator

```
Scenario: Entry with voice source shows voice indicator
  Given the user is authenticated
  And an entry exists with source "telegram" and source_type "voice"
  When the user views the entry
  Then a "voice" indicator is shown alongside the source badge
```

**Traces to:** EC-7

---

#### TS-5.6: Very long content renders without layout breaks

```
Scenario: Very long content renders without layout breaks
  Given the user is authenticated
  And an entry exists with very long markdown content (10,000+ characters)
  When the user views the entry
  Then the content is fully rendered
  And the page layout is not broken (response is valid HTML)
```

**Traces to:** EC-6

---

#### TS-5.7: Tag autocomplete suggests existing tags

```
Scenario: Tag autocomplete suggests existing tags
  Given the user is authenticated
  And entries exist with tags "work", "personal", "urgent"
  When the user loads the edit page for any entry
  Then the tag input provides autocomplete suggestions from existing tags
```

**Traces to:** EC-4

---

#### TS-5.8: New tags can be entered beyond autocomplete suggestions

```
Scenario: New tags can be entered beyond autocomplete suggestions
  Given the user is authenticated
  And an entry exists
  When the user saves the entry with a new tag "brand-new-tag" that does not exist in the database
  Then the entry is saved with the new tag
  And "brand-new-tag" becomes available in autocomplete for future edits
```

**Traces to:** EC-4

---

#### TS-5.9: Entry with null embedding is viewable and editable

```
Scenario: Entry with null embedding is viewable and editable
  Given the user is authenticated
  And an entry exists with embedding set to null
  When the user views the entry
  Then the entry is displayed normally
  And no special indicator is shown for the missing embedding
```

**Traces to:** EC-3

---

## Traceability Summary

All acceptance criteria (AC-1.1 through AC-3.4), all testable constraints, and all edge cases (EC-2 through EC-7) have at least one corresponding test scenario.

**EC-1 (concurrent edit)** is not tested — the spec explicitly states "last write wins" with no locking. This is standard database behavior and does not require a dedicated test scenario.

**Total scenarios:** 27

## Orphan Check

No orphan scenarios. Every scenario traces to at least one spec requirement.
