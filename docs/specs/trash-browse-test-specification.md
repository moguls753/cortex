# Trash Browse - Test Specification

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|-----------------|-------------------|
| AC-1.1 Trash link in nav between Browse and Settings | TS-1.1 |
| AC-1.2 Trash nav uses Trash2 icon | TS-1.1 |
| AC-1.3 Trash nav highlighted when on /trash | TS-1.2, TS-1.3 |
| AC-1.4 Trash nav always visible | TS-1.4 |
| AC-2.1 GET /trash lists deleted entries sorted by deleted_at DESC | TS-2.1 |
| AC-2.2 Category tabs filter within trash | TS-2.2 |
| AC-2.3 Tag pills filter within trash | TS-2.3 |
| AC-2.4 Combined category and tag filters | TS-2.4 |
| AC-2.5 Search within trash (semantic + text fallback) | TS-2.5, TS-2.6 |
| AC-2.6 Combined search with filters | TS-2.7 |
| AC-2.7 Entry row shows deleted_at time | TS-2.8 |
| AC-3.1 Trash entry links to /entry/:id | TS-3.1 |
| AC-3.2 Restored entry leaves trash, returns to browse | TS-3.2 |
| AC-4.1 Delete permanently button shown for deleted entries | TS-4.1 |
| AC-4.2 Delete permanently uses destructive styling | TS-4.1 |
| AC-4.3 Confirmation dialog on permanent delete | TS-4.2 |
| AC-4.4 Hard delete removes entry from database | TS-4.3 |
| AC-4.5 No calendar API call on permanent delete | TS-4.4 |
| AC-4.6 Redirect to /trash after permanent delete | TS-4.3 |
| AC-4.7 404 for non-existent or non-deleted entry | TS-4.5, TS-4.6 |
| AC-5.1 Empty Trash button visible when entries exist | TS-5.1 |
| AC-5.2 Confirmation dialog shows total count | TS-5.2 |
| AC-5.3 Hard deletes all soft-deleted entries | TS-5.3 |
| AC-5.4 Not scoped by active filters | TS-5.4 |
| AC-5.5 Page reloads showing empty state | TS-5.5 |
| AC-5.6 No calendar API calls on empty trash | TS-5.3 |
| AC-6.1 Empty state when no deleted entries | TS-6.1 |
| AC-6.2 No results with active filters | TS-6.2 |
| AC-6.3 Empty Trash button hidden when empty | TS-6.1 |
| EC-1 No entries ever deleted | TS-6.1 |
| EC-2 Empty Trash with active filters deletes all | TS-5.4 |
| EC-3 Stale link to permanently deleted entry | TS-4.5 |
| EC-4 Permanent delete with orphaned calendar event | TS-4.4 |
| EC-5 Concurrent empty trash | TS-7.1 |
| EC-6 buildUrl uses /trash base path | TS-7.2, TS-7.3, TS-7.4 |
| NG-1 No auto-purge | TS-7.5 |
| NG-4 No multi-select partial delete | TS-5.4 |

## Test Scenarios

### Group 1: Navigation

**TS-1.1: Trash link appears in nav bar with correct icon and position**

```
Given a user is authenticated
When any page is rendered
Then the navigation bar contains a "Trash" link with href="/trash"
And the Trash link uses the Trash2 icon
And the Trash link appears after "Browse" and before "Settings"
```

**TS-1.2: Trash nav item highlighted on /trash**

```
Given a user is authenticated
When the user navigates to /trash
Then the Trash nav item has the active styling
And the Browse nav item does not have the active styling
```

**TS-1.3: Trash nav item highlighted on /trash with query params**

```
Given a user is authenticated
When the user navigates to /trash?category=tasks&tag=meeting
Then the Trash nav item has the active styling
```

**TS-1.4: Trash nav visible when no deleted entries exist**

```
Given a user is authenticated
And no entries have been soft-deleted
When any page is rendered
Then the navigation bar still contains the "Trash" link
```

### Group 2: Trash Listing & Filtering

**TS-2.1: Lists deleted entries sorted by deleted_at descending**

```
Given three entries exist with deleted_at timestamps:
  - Entry A deleted at 2026-04-10
  - Entry B deleted at 2026-04-15
  - Entry C deleted at 2026-04-12
And two active (non-deleted) entries exist
When the user navigates to /trash
Then the page lists exactly three entries
And Entry B appears first, then Entry C, then Entry A
And the two active entries are not shown
```

**TS-2.2: Category filter within trash**

```
Given deleted entries exist with categories "tasks" and "ideas"
And active entries exist with category "tasks"
When the user navigates to /trash?category=tasks
Then only deleted entries with category "tasks" are shown
And deleted entries with category "ideas" are not shown
And active entries with category "tasks" are not shown
```

**TS-2.3: Tag filter within trash**

```
Given deleted entries exist, some tagged "meeting" and some not
When the user navigates to /trash?tag=meeting
Then only deleted entries tagged "meeting" are shown
```

**TS-2.4: Combined category and tag filter**

```
Given deleted entries exist across multiple categories and tags
When the user navigates to /trash?category=tasks&tag=urgent
Then only deleted entries with category "tasks" AND tag "urgent" are shown
```

**TS-2.5: Semantic search within trash**

```
Given deleted entries exist with embedded content
And a search query has a semantic match among deleted entries
When the user navigates to /trash?q=search+term
Then deleted entries matching semantically are returned
And active entries are not included in results
```

**TS-2.6: Text search fallback within trash**

```
Given deleted entries exist matching a text pattern
And semantic search returns no results (or Ollama is unavailable)
When the user navigates to /trash?q=search+term
Then deleted entries matching via text search (ILIKE) are returned
And a notice indicates text search fallback was used
```

**TS-2.7: Combined search with category and tag filters**

```
Given deleted entries exist across categories and tags
When the user navigates to /trash?q=term&category=tasks&tag=urgent
Then only deleted entries matching the search AND category AND tag are shown
```

**TS-2.8: Entry row shows deleted_at time, not updated_at**

```
Given an entry was last updated on 2026-04-01 and deleted on 2026-04-15
When the user views the trash page
Then the relative time shown on that entry's row is based on the deleted_at timestamp (2026-04-15)
And not the updated_at timestamp (2026-04-01)
```

### Group 3: Restore

**TS-3.1: Clicking trash entry navigates to entry detail**

```
Given a deleted entry exists with a known ID
When the user views the trash page
Then the entry row is a link to /entry/{id}
```

**TS-3.2: Restored entry leaves trash and returns to browse**

```
Given a deleted entry exists
When the entry is restored via POST /entry/{id}/restore
And the user navigates to /trash
Then the restored entry is not in the trash list
And the entry appears in /browse
```

### Group 4: Individual Permanent Delete

**TS-4.1: Delete permanently button shown for deleted entries only**

```
Given a soft-deleted entry exists
When the user views the entry detail page (/entry/{id})
Then a "Delete permanently" button is displayed
And the button uses destructive color styling
And the button has an onsubmit confirmation dialog
```

```
Given an active (non-deleted) entry exists
When the user views the entry detail page (/entry/{id})
Then no "Delete permanently" button is displayed
And the existing "Delete" (soft delete) and "Edit" buttons are shown
```

**TS-4.2: Confirmation dialog on permanent delete**

```
Given a soft-deleted entry exists
When the user clicks "Delete permanently"
Then a browser confirmation dialog appears with text "Permanently delete this entry? This cannot be undone."
```

**TS-4.3: Permanent delete removes entry and redirects to /trash**

```
Given a soft-deleted entry exists with id {id}
When a POST request is made to /entry/{id}/permanent-delete
Then the entry is removed from the database (hard delete)
And the response redirects to /trash
```

**TS-4.4: No calendar API call on permanent delete**

```
Given a soft-deleted entry exists with google_calendar_event_id set (orphaned event)
When the entry is permanently deleted via POST /entry/{id}/permanent-delete
Then no Google Calendar API request is made
And the entry is removed from the database
```

**TS-4.5: Permanent delete of non-existent entry returns 404**

```
Given no entry exists with id "nonexistent-uuid"
When a POST request is made to /entry/nonexistent-uuid/permanent-delete
Then the response status is 404
```

**TS-4.6: Permanent delete of active (non-deleted) entry returns 404**

```
Given an active (non-deleted) entry exists with id {id}
When a POST request is made to /entry/{id}/permanent-delete
Then the response status is 404
And the entry remains in the database unchanged
```

### Group 5: Empty Trash

**TS-5.1: Empty Trash button visible when deleted entries exist**

```
Given soft-deleted entries exist
When the user navigates to /trash
Then an "Empty Trash" button is displayed
```

**TS-5.2: Confirmation dialog shows total count**

```
Given 5 soft-deleted entries exist
And the user is viewing /trash?category=tasks (showing 2 of the 5)
When the user clicks "Empty Trash"
Then a confirmation dialog appears mentioning all 5 entries, not 2
```

**TS-5.3: Empty trash hard-deletes all soft-deleted entries**

```
Given 3 soft-deleted entries exist (some with google_calendar_event_id set)
And 2 active entries exist
When a POST request is made to /api/empty-trash
Then all 3 soft-deleted entries are removed from the database
And the 2 active entries remain
And no Google Calendar API calls are made
And the response indicates success
```

**TS-5.4: Empty trash not scoped by active filters**

```
Given 5 soft-deleted entries exist across categories "tasks" (2) and "ideas" (3)
When the user triggers empty trash while viewing /trash?category=tasks
Then all 5 soft-deleted entries are removed, not just the 2 "tasks" entries
```

**TS-5.5: Page reloads showing empty state after empty trash**

```
Given soft-deleted entries exist
When the user empties the trash
Then the trash page reloads
And the empty state message "Trash is empty" is shown
And the "Empty Trash" button is no longer displayed
```

### Group 6: Empty State

**TS-6.1: Empty state when no deleted entries exist**

```
Given no soft-deleted entries exist
When the user navigates to /trash
Then the page displays "Trash is empty"
And the "Empty Trash" button is not displayed
```

**TS-6.2: No results with active filters**

```
Given soft-deleted entries exist but none match category "people"
When the user navigates to /trash?category=people
Then the page displays "No entries in this category."
```

### Group 7: Edge Cases & Guardrails

**TS-7.1: Concurrent empty trash is a no-op**

```
Given 3 soft-deleted entries exist
When two empty trash requests are made simultaneously
Then one request deletes all 3 entries
And the other request deletes 0 entries (no-op)
And both requests succeed without error
```

**TS-7.2: Category tabs link to /trash (not /browse)**

```
Given the user is viewing /trash
When the page renders category tabs
Then each tab links to /trash?category=X (not /browse?category=X)
```

**TS-7.3: Tag pills link to /trash (not /browse)**

```
Given the user is viewing /trash and tag pills are shown
When the page renders tag pills
Then each tag pill links to /trash?tag=X (not /browse?tag=X)
```

**TS-7.4: Search form submits to /trash**

```
Given the user is viewing /trash
When the search form is rendered
Then the form action is /trash (not /browse)
```

**TS-7.5: Soft-deleted entries persist without manual action**

```
Given an entry was soft-deleted 30 days ago
And no empty trash action has been performed
When the user navigates to /trash
Then the entry still appears in the trash list
```

## Traceability Summary

All 23 acceptance criteria from the behavioral specification are covered:
- US-1 (Navigation): 4 ACs -> TS-1.1 through TS-1.4
- US-2 (Listing & filtering): 7 ACs -> TS-2.1 through TS-2.8
- US-3 (Restore): 2 ACs -> TS-3.1, TS-3.2
- US-4 (Permanent delete): 7 ACs -> TS-4.1 through TS-4.6
- US-5 (Empty trash): 6 ACs -> TS-5.1 through TS-5.5
- US-6 (Empty state): 3 ACs -> TS-6.1, TS-6.2

All 6 edge cases are covered: TS-5.4 (EC-2), TS-4.5 (EC-3), TS-4.4 (EC-4), TS-7.1 (EC-5), TS-7.2/7.3/7.4 (EC-6), TS-6.1 (EC-1).

Non-goals NG-1 and NG-4 are verified by TS-7.5 and TS-5.4 respectively. NG-2, NG-3, and NG-5 are design constraints that do not require test scenarios (absence of functionality).
