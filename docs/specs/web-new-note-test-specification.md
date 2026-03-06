# Web New Note - Test Specification

| Field | Value |
|-------|-------|
| Feature | Web New Note |
| Phase | 2 |
| Date | 2026-03-06 |
| Derives From | `web-new-note-specification.md` |

## Resolved Open Questions

The following open questions from the behavioral spec were resolved before deriving test scenarios:

1. **AI Suggest scope:** Category and tags only. Does not suggest a name/title. The classification pipeline returns `{ category, confidence, tags }` — no changes needed.
2. **Category-specific fields on form:** Not shown on the new note form. They appear only after saving, when viewing/editing the entry. Keeps the creation form lean.
3. **"Save and New" button:** No. Just "Save" for now. The dashboard quick capture handles rapid entry.
4. **Unsaved changes warning:** Yes. A `beforeunload` event warns the user when navigating away with unsaved changes.

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|-------------------|
| AC-1.1: Form with name, category, tags, content | TS-1.1 |
| AC-1.2: Plain text markdown entry | TS-1.1 |
| AC-1.3: Tags autocomplete from existing tags | TS-1.2 |
| AC-2.1: AI Suggest sends content to classification | TS-2.1 |
| AC-2.2: Suggested category pre-selected | TS-2.1 |
| AC-2.3: Suggested tags appended | TS-2.2 |
| AC-2.4: User can override suggestions | TS-2.3 |
| AC-2.5: Re-invoke replaces previous suggestions | TS-2.4 |
| AC-3.1: Save generates embedding | TS-3.1 |
| AC-3.2: Entry stored with source "webapp", confidence null | TS-3.2 |
| AC-3.3: Category-specific default fields on save | TS-3.3 |
| AC-3.4: Redirect to /entry/:id after save | TS-3.1 |
| AC-3.5: Save succeeds with embedding null if Ollama down | TS-3.4 |
| C-1: Server-rendered HTML via Hono | TS-4.1 |
| C-2: Auth required | TS-4.2, TS-4.3 |
| C-3: AI Suggest via client-side JS to API endpoint | TS-2.1 |
| C-4: Tag autocomplete via API endpoint | TS-1.2 |
| C-5: Name required (server-side validation) | TS-4.4 |
| C-6: Content optional | TS-5.1 |
| C-7: No category = category null | TS-5.2 |
| EC-1: Empty note (no content) | TS-5.1 |
| EC-2: Title-only note | TS-5.1 |
| EC-3: Very long note | TS-5.3 |
| EC-4: AI Suggest with empty content | TS-5.4, TS-5.9 |
| EC-5: Save while Ollama down | TS-3.4 |
| EC-6: Duplicate name | TS-5.5 |
| EC-7: AI Suggest while Claude API down | TS-5.6 |
| EC-8: Category-specific fields on save | TS-3.3 |
| EC-9: Tags with special characters | TS-5.7 |
| C-2 (auth on API): Unauthenticated API classify | TS-4.5 |
| Unsaved changes warning (resolved Q4) | TS-5.8 |

## Test Scenarios

### Group 1: Form Display (US-1)

#### TS-1.1: New note form shows all expected fields

```
Scenario: New note form shows all expected fields
  Given the user is authenticated
  When the user navigates to the new note page
  Then a form is displayed with a name text input
  And a category dropdown with options: empty/unselected, People, Projects, Tasks, Ideas, Reference
  And a tags input with autocomplete
  And a markdown textarea for content
  And a Save button
```

**Traces to:** AC-1.1, AC-1.2

---

#### TS-1.2: Tag autocomplete provides existing tags

```
Scenario: Tag autocomplete provides existing tags
  Given the user is authenticated
  And entries exist with tags "work", "personal", "urgent"
  When the user loads the new note page
  Then the tag input provides autocomplete suggestions from existing tags
```

**Traces to:** AC-1.3, C-4

---

### Group 2: AI Suggest (US-2)

#### TS-2.1: AI Suggest returns category and tags

```
Scenario: AI Suggest returns category and tags
  Given the user is authenticated
  And the user has entered a name and content in the form
  When the user invokes AI Suggest
  Then the classification API is called with the note name and content
  And the suggested category is pre-selected in the category dropdown
  And suggested tags are shown in the tag input
```

**Traces to:** AC-2.1, AC-2.2, C-3

---

#### TS-2.2: AI Suggest appends tags to existing user tags

```
Scenario: AI Suggest appends tags to existing user tags
  Given the user is authenticated
  And the user has entered tags "my-tag" in the form
  And the user has entered a name and content
  When the user invokes AI Suggest
  And the API returns tags ["ai-tag-1", "ai-tag-2"]
  Then the tag input contains "my-tag", "ai-tag-1", "ai-tag-2"
```

**Traces to:** AC-2.3

---

#### TS-2.3: User can override AI suggestions

```
Scenario: User can override AI suggestions
  Given the user is authenticated
  And AI Suggest has pre-selected category "ideas" and tags ["suggested"]
  When the user changes the category to "projects"
  And the user removes the "suggested" tag and adds "manual-tag"
  And the user saves the note
  Then the entry is saved with category "projects" and tags ["manual-tag"]
```

**Traces to:** AC-2.4

---

#### TS-2.4: Re-invoking AI Suggest replaces previous AI suggestions but preserves user tags

```
Scenario: Re-invoking AI Suggest replaces previous suggestions but preserves user tags
  Given the user is authenticated
  And the user has entered tag "user-tag"
  And AI Suggest was previously invoked, adding tags ["first-ai-tag"]
  When the user changes the content and invokes AI Suggest again
  And the API returns tags ["second-ai-tag"]
  Then the tag input contains "user-tag" and "second-ai-tag"
  And "first-ai-tag" is no longer present
```

**Traces to:** AC-2.5

---

### Group 3: Save Note (US-3)

#### TS-3.1: Save creates entry with embedding and redirects

```
Scenario: Save creates entry with embedding and redirects
  Given the user is authenticated
  And the user has filled in name "My Note", category "ideas", tags ["test"], and content "Some markdown content"
  When the user saves the note
  Then an entry is created in the database
  And an embedding is generated for the note content
  And the user is redirected to /entry/:id for the newly created entry
```

**Traces to:** AC-3.1, AC-3.4

---

#### TS-3.2: Saved entry has source "webapp" and confidence null

```
Scenario: Saved entry has source "webapp" and confidence null
  Given the user is authenticated
  And the user has filled in name and content
  When the user saves the note
  Then the entry has source set to "webapp"
  And the entry has confidence set to null
```

**Traces to:** AC-3.2

---

#### TS-3.3: Save with category populates default fields

```
Scenario: Save with category populates default fields
  Given the user is authenticated
  And the user has filled in name "Project Alpha" and selected category "projects"
  When the user saves the note
  Then the entry fields contain the projects defaults { status: null, next_action: null, notes: null }
```

**Traces to:** AC-3.3, EC-8

---

#### TS-3.4: Save succeeds when Ollama is down

```
Scenario: Save succeeds when Ollama is down
  Given the user is authenticated
  And the Ollama embedding service is unavailable
  And the user has filled in name and content
  When the user saves the note
  Then the entry is saved with embedding set to null
  And the user is redirected to /entry/:id
```

**Traces to:** AC-3.5, EC-5

---

### Group 4: Constraints

#### TS-4.1: New note page returns server-rendered HTML

```
Scenario: New note page returns server-rendered HTML
  Given the user is authenticated
  When the user navigates to the new note page
  Then the response content-type is HTML
  And the response body contains the form as rendered HTML
```

**Traces to:** C-1

---

#### TS-4.2: Unauthenticated GET request redirected to login

```
Scenario: Unauthenticated GET request redirected to login
  Given the user is not authenticated
  When the user requests the new note page
  Then the user is redirected to /login
```

**Traces to:** C-2

---

#### TS-4.3: Unauthenticated POST request redirected to login

```
Scenario: Unauthenticated POST request redirected to login
  Given the user is not authenticated
  When the user submits the new note form
  Then the user is redirected to /login
```

**Traces to:** C-2

---

#### TS-4.5: Unauthenticated API classify redirected to login

```
Scenario: Unauthenticated API classify redirected to login
  Given the user is not authenticated
  When the user sends a classify request to the API
  Then the user is redirected to /login
```

**Traces to:** C-2

---

#### TS-4.4: Save with empty name returns validation error

```
Scenario: Save with empty name returns validation error
  Given the user is authenticated
  And the user has left the name field empty
  When the user saves the note
  Then a validation error is returned indicating name is required
  And no entry is created in the database
```

**Traces to:** C-5

---

### Group 5: Edge Cases

#### TS-5.1: Save note with title only (no content)

```
Scenario: Save note with title only (no content)
  Given the user is authenticated
  And the user has filled in name "Quick thought" but left content empty
  When the user saves the note
  Then the entry is saved successfully
  And the embedding is generated from the name alone
```

**Traces to:** EC-1, EC-2, C-6

---

#### TS-5.2: Save note with no category

```
Scenario: Save note with no category
  Given the user is authenticated
  And the user has filled in name and content but left category unselected
  When the user saves the note
  Then the entry is saved with category set to null
  And the entry fields are set to empty object {}
```

**Traces to:** C-7, EC-8

---

#### TS-5.3: Very long note saves and generates embedding

```
Scenario: Very long note saves and generates embedding
  Given the user is authenticated
  And the user has filled in name and content with 10,000+ characters
  When the user saves the note
  Then the entry is saved with the full content
  And the embedding is generated successfully
```

**Traces to:** EC-3

---

#### TS-5.4: AI Suggest with empty content shows warning

```
Scenario: AI Suggest with empty content shows warning
  Given the user is authenticated
  And both name and content fields are empty
  When the user invokes AI Suggest
  Then the classification API is not called
  And a message is shown: "Write some content first"
```

**Traces to:** EC-4

---

#### TS-5.5: Duplicate name is allowed

```
Scenario: Duplicate name is allowed
  Given the user is authenticated
  And an entry already exists with name "Meeting Notes"
  And the user has filled in name "Meeting Notes"
  When the user saves the note
  Then the entry is saved successfully with a new UUID
```

**Traces to:** EC-6

---

#### TS-5.6: AI Suggest when classification service is down

```
Scenario: AI Suggest when classification service is down
  Given the user is authenticated
  And the user has entered name and content
  And the classification service is unavailable
  When the user invokes AI Suggest
  Then an error message is shown (e.g., "Classification service unavailable")
  And the form remains editable and saveable
```

**Traces to:** EC-7

---

#### TS-5.7: Tags are normalized on save

```
Scenario: Tags are normalized on save
  Given the user is authenticated
  And the user has entered tags " Work ", "URGENT", "my tag"
  When the user saves the note
  Then the tags are saved as lowercase and trimmed: "work", "urgent", "my tag"
```

**Traces to:** EC-9

---

#### TS-5.8: Unsaved changes warning on navigation

```
Scenario: Unsaved changes warning on navigation
  Given the user is authenticated
  And the user has entered content in the form
  When the user attempts to navigate away
  Then a browser warning about unsaved changes is shown
```

**Traces to:** Resolved Q4 (beforeunload)

---

#### TS-5.9: AI Suggest with name only (no content) succeeds

```
Scenario: AI Suggest with name only (no content) succeeds
  Given the user is authenticated
  And the user has entered a name but left content empty
  When the user invokes AI Suggest
  Then the classification API is called with the name
  And the suggested category and tags are returned
```

**Traces to:** EC-4

---

## Traceability Summary

All acceptance criteria (AC-1.1 through AC-3.5), all constraints (C-1 through C-7), and all edge cases (EC-1 through EC-9) have at least one corresponding test scenario. The 4 resolved open questions are incorporated into the scenarios or excluded per the decisions above.

**Total scenarios:** 24

## Orphan Check

No orphan scenarios. Every scenario traces to at least one spec requirement, constraint, or edge case.

## Notes

- **TS-2.1 through TS-2.4 (AI Suggest)** involve client-side JavaScript behavior calling a server API endpoint. The server-side API endpoint (`POST /api/classify`) is testable as an HTTP request/response. The client-side behavior (updating form fields) is a UI concern — the test scenarios describe the observable outcome, not the DOM manipulation.
- **TS-5.8 (beforeunload)** is a client-side browser behavior. The test verifies that the page includes the necessary JavaScript, not that the browser shows the dialog (browser-controlled, not testable in unit/integration).
- **Category-specific fields** are not shown on the new note form (resolved Q2). They are populated server-side on save based on `CATEGORY_FIELDS` defaults and appear when the user views/edits the entry afterward.
