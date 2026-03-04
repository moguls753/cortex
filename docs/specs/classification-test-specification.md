# Classification - Test Specification

| Field | Value |
|-------|-------|
| Feature | Classification |
| Phase | 2 — Test Specification |
| Date | 2026-03-04 |
| Status | Draft |
| Derives from | `docs/specs/classification-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|------------------|
| AC-1.1: Send text to configured LLM provider with classify prompt | TS-1.1, TS-1.2, TS-1.3 |
| AC-1.2: LLM returns valid JSON with required fields | TS-1.5 |
| AC-1.3: Schema validation of LLM response | TS-1.6, TS-1.7, TS-1.8, TS-1.9 |
| AC-1.4: Invalid JSON / failed validation → category: null | TS-1.10, TS-1.11 |
| AC-2.1: Fetch last 5 recent entries (excl. soft-deleted) | TS-2.1, TS-2.2, TS-2.3 |
| AC-2.2: Embedding + cosine similarity for top 3 similar entries | TS-2.4, TS-2.5, TS-2.6 |
| AC-2.3: Deduplicated context injected into prompt | TS-2.7, TS-2.8 |
| AC-2.4: Context entry format (name, category, snippet) | TS-2.9, TS-2.10 |
| AC-3.1: Default confidence threshold 0.6 | TS-3.1 |
| AC-3.2: Threshold from settings table, read at classification time | TS-3.2 |
| AC-3.3: Confident when confidence >= threshold | TS-3.3 |
| AC-3.4: Uncertain when confidence < threshold | TS-3.4 |
| AC-4.1: API errors → category: null, content preserved | TS-4.1, TS-4.2, TS-4.3, TS-4.4, TS-4.5 |
| AC-4.3: Retry cron re-classifies null-category entries | TS-4.6, TS-4.7, TS-4.8 |
| AC-4.4: Errors logged with structured context | TS-4.9 |
| C-2: Prompt loaded from prompts/classify.md at runtime | TS-C-1 |
| C-4: Calendar fields are ephemeral (not stored) | TS-C-2 |
| C-5: Exponential backoff on 429 during retries | TS-C-3 |
| EC-1: Confidence exactly at threshold | TS-3.5 |
| EC-2: Invalid category from LLM | (covered by TS-1.7) |
| EC-3: Malformed/truncated JSON | (covered by TS-1.10) |
| EC-4: Rate limit 429 | (covered by TS-4.2) |
| EC-5: Very short input | TS-EC-1 |
| EC-6: Very long input — content truncated | TS-EC-2 |
| EC-7: German input | TS-EC-3 |
| EC-8: No clear category → low confidence | TS-EC-4 |
| EC-9: Empty context (new system) | TS-EC-5 |
| EC-10: Duplicate context entries deduplicated | (covered by TS-2.7) |
| EC-11: Confidence as string (numeric coerced, non-numeric fails) | TS-EC-6, TS-EC-7 |
| EC-12: Invalid threshold clamped to [0.0, 1.0] | TS-EC-8, TS-EC-9 |
| NG-2: Raw API response not persisted | TS-NG-1 |
| NG-3: Prompt change does not re-classify existing entries | TS-NG-2 |
| NG-6: Content edit does not trigger re-classification | TS-NG-3 |

## Test Scenarios

### US-1: Basic Classification

**TS-1.1: Classify text using Anthropic provider**
```
Scenario: Text is classified via the Anthropic LLM provider
  Given LLM provider is configured as "anthropic"
  And a valid API key and model are configured
  When text "Had coffee with Maria, discussed her new startup" is classified
  Then the request is sent through the Anthropic SDK
  And a valid classification result is returned
```

**TS-1.2: Classify text using OpenAI-compatible provider**
```
Scenario: Text is classified via the OpenAI-compatible LLM provider
  Given LLM provider is configured as "openai-compatible"
  And a valid base URL, API key, and model are configured
  When text "Had coffee with Maria, discussed her new startup" is classified
  Then the request is sent through the OpenAI SDK
  And a valid classification result is returned
```

**TS-1.3: Classification uses the configured model**
```
Scenario: Classification request specifies the configured model
  Given LLM model is configured as "claude-sonnet-4-20250514"
  When classification is performed
  Then the LLM request uses model "claude-sonnet-4-20250514"
```

**TS-1.4: Classification prompt loaded from prompts/classify.md**
```
Scenario: Classification uses the prompt template from the file system
  Given prompts/classify.md contains a classification prompt template
  When classification is performed
  Then the prompt sent to the LLM matches the content of prompts/classify.md
  And the {context_entries} placeholder is replaced with actual context
```

**TS-1.5: LLM returns valid classification with all required fields**
```
Scenario: Valid LLM response is parsed into a structured classification result
  Given the LLM returns valid JSON with category "people", name "Maria Coffee Chat",
    confidence 0.92, fields { "relationship": "friend" }, tags ["social", "startup"],
    create_calendar_event false, and calendar_date null
  When the response is processed
  Then the classification result contains all fields with correct types and values
```

**TS-1.6: Schema validation rejects invalid category**
```
Scenario: Category not in the allowed list fails validation
  Given the LLM returns JSON with category "meetings"
  When the response is validated
  Then validation fails
  And the entry is stored with category: null and confidence: null
```

**TS-1.7: Schema validation rejects out-of-range confidence**
```
Scenario: Confidence outside 0.0–1.0 range fails validation
  Given the LLM returns JSON with confidence 1.5
  When the response is validated
  Then validation fails
  And the entry is stored with category: null and confidence: null
```

**TS-1.8: Schema validation rejects missing required fields**
```
Scenario: Missing required field fails validation
  Given the LLM returns JSON without the "category" field
  When the response is validated
  Then validation fails
  And the entry is stored with category: null and confidence: null
```

**TS-1.9: Schema validation rejects wrong field types**
```
Scenario: Field with wrong type fails validation
  Given the LLM returns JSON with tags as a string instead of an array
  When the response is validated
  Then validation fails
  And the entry is stored with category: null and confidence: null
```

**TS-1.10: Invalid JSON response results in null category**
```
Scenario: Non-JSON LLM response is handled gracefully
  Given the LLM returns a plain text response "I think this is about people"
  When the response is parsed
  Then JSON parsing fails
  And the entry is stored with category: null and confidence: null
```

**TS-1.11: Truncated JSON response results in null category**
```
Scenario: Incomplete JSON from LLM is handled gracefully
  Given the LLM returns truncated JSON '{"category": "people", "name": "Mar'
  When the response is parsed
  Then JSON parsing fails
  And the entry is stored with category: null and confidence: null
```

### US-2: Context-Aware Classification

**TS-2.1: Fetch last 5 recent entries as context**
```
Scenario: Classification context includes the 5 most recent entries
  Given 8 entries exist in the database (none soft-deleted)
  When context is gathered for classification
  Then the 5 entries with the most recent created_at timestamps are returned
  And they are ordered by created_at descending
```

**TS-2.2: Soft-deleted entries excluded from recent context**
```
Scenario: Soft-deleted entries are not included in recent context
  Given 6 entries exist, one of which is soft-deleted
  When recent entries are fetched for context
  Then the soft-deleted entry is not included
  And at most 5 non-deleted entries are returned
```

**TS-2.3: Fewer than 5 entries returns all available**
```
Scenario: All entries returned when fewer than 5 exist
  Given 3 entries exist in the database (none soft-deleted)
  When recent entries are fetched for context
  Then all 3 entries are returned
```

**TS-2.4: Semantic search finds top 3 similar entries**
```
Scenario: Cosine similarity search returns top 3 matches above threshold
  Given 10 entries exist with embeddings
  And 5 have cosine similarity >= 0.5 to the input text
  When similar entries are searched for the input text
  Then the 3 entries with the highest similarity scores are returned
```

**TS-2.5: Semantic search excludes entries below similarity threshold**
```
Scenario: Entries with similarity below 0.5 are excluded
  Given 5 entries exist with embeddings
  And 2 have cosine similarity >= 0.5 to the input text
  And 3 have cosine similarity < 0.5
  When similar entries are searched
  Then only the 2 entries above the threshold are returned
```

**TS-2.6: Soft-deleted entries excluded from semantic search**
```
Scenario: Soft-deleted entries are excluded from similarity search
  Given an entry with high similarity to the input text is soft-deleted
  When similar entries are searched
  Then the soft-deleted entry is not included in results
```

**TS-2.7: Context entries deduplicated by ID**
```
Scenario: Entry appearing in both recent and similar results appears once
  Given entry X is both one of the 5 most recent entries
  And entry X is also one of the top 3 similar entries
  When context is assembled for classification
  Then entry X appears exactly once in the context
```

**TS-2.8: Context injected into classification prompt**
```
Scenario: Formatted context replaces the placeholder in the prompt
  Given 3 context entries are available
  And the classification prompt contains {context_entries}
  When the prompt is assembled
  Then {context_entries} is replaced with the formatted context entries
```

**TS-2.9: Context entry format includes name, category, and content snippet**
```
Scenario: Each context entry shows name, category, and truncated content
  Given a context entry with name "Project Alpha", category "projects",
    and content that is 350 characters long
  When the context entry is formatted
  Then it includes the name "Project Alpha"
  And it includes the category "projects"
  And it includes only the first 200 characters of content
```

**TS-2.10: Short content included in full**
```
Scenario: Content shorter than 200 characters is not truncated
  Given a context entry with content that is 150 characters long
  When the context entry is formatted
  Then the full content is included without truncation
```

### US-3: Confidence Threshold

**TS-3.1: Default confidence threshold is 0.6**
```
Scenario: Threshold defaults to 0.6 when not configured
  Given no confidence_threshold setting exists in the settings table
  When the confidence threshold is resolved
  Then the threshold is 0.6
```

**TS-3.2: Threshold read from settings table at classification time**
```
Scenario: Custom threshold from settings is used for classification
  Given confidence_threshold is set to 0.8 in the settings table
  When classification is performed and confidence is evaluated
  Then 0.8 is used as the threshold
```

**TS-3.3: Entry with confidence >= threshold is confident**
```
Scenario: High-confidence entry is classified as confident
  Given the confidence threshold is 0.6
  When classification returns confidence 0.85
  Then the entry is marked as confident
```

**TS-3.4: Entry with confidence < threshold is uncertain**
```
Scenario: Low-confidence entry is flagged for review
  Given the confidence threshold is 0.6
  When classification returns confidence 0.45
  Then the entry is flagged as uncertain / needing review
```

**TS-3.5: Confidence exactly at threshold is treated as confident**
```
Scenario: Confidence equal to threshold passes the check
  Given the confidence threshold is 0.6
  When classification returns confidence exactly 0.6
  Then the entry is marked as confident (>= comparison)
```

### US-4: Graceful Failure

**TS-4.1: API timeout preserves entry with null category**
```
Scenario: LLM request timeout does not lose the entry
  Given the LLM API takes longer than the configured timeout
  When classification is attempted
  Then the entry is stored with category: null and confidence: null
  And the raw input text is preserved in the content field
```

**TS-4.2: Rate limit (429) preserves entry with null category**
```
Scenario: LLM rate limit response does not lose the entry
  Given the LLM API returns HTTP 429
  When classification is attempted
  Then the entry is stored with category: null and confidence: null
```

**TS-4.3: Server error (5xx) preserves entry with null category**
```
Scenario: LLM server error does not lose the entry
  Given the LLM API returns HTTP 500
  When classification is attempted
  Then the entry is stored with category: null and confidence: null
```

**TS-4.4: Network error preserves entry with null category**
```
Scenario: Network failure does not lose the entry
  Given the LLM API is unreachable (network error)
  When classification is attempted
  Then the entry is stored with category: null and confidence: null
```

**TS-4.5: Raw input text preserved on failure**
```
Scenario: Entry content is never lost regardless of classification outcome
  Given text input "Buy groceries for the weekend"
  And the LLM API is unavailable
  When classification is attempted
  Then the entry is stored with content "Buy groceries for the weekend"
  And category is null
```

**TS-4.6: Retry cron retries entries with null category**
```
Scenario: Retry job finds and re-classifies unclassified entries
  Given 3 entries exist: 2 with category: null and 1 with category "tasks"
  And all entries have deleted_at: null
  When the classification retry job runs
  Then classification is attempted for the 2 entries with category: null
  And the entry with category "tasks" is not retried
```

**TS-4.7: Successful retry updates entry with classification result**
```
Scenario: Retry job updates entry when classification succeeds
  Given an entry exists with category: null
  And the LLM API is now available
  When the classification retry job runs and the LLM returns a valid result
  Then the entry is updated with the returned category, name, fields, tags, and confidence
```

**TS-4.8: Retry excludes soft-deleted entries**
```
Scenario: Soft-deleted entries are not retried
  Given an entry with category: null and deleted_at set to a timestamp
  When the classification retry job runs
  Then the soft-deleted entry is not selected for retry
```

**TS-4.9: Classification errors logged with structured context**
```
Scenario: API errors are logged with enough context for debugging
  Given the LLM API returns an error with status code 500
  When classification fails for entry with ID 42 and input text of 250 characters
  Then a log entry is created containing:
    the API response code (500),
    the error message,
    the entry ID (42),
    and the input text length (250)
```

## Constraint Scenarios

**TS-C-1: Prompt changes take effect without restart**
```
Scenario: Modified classification prompt is used on next classification
  Given prompts/classify.md has been updated with new content
  When a new classification request is made
  Then the updated prompt content is used
  And no application restart is required
```

**TS-C-2: Calendar fields are ephemeral and not stored in database**
```
Scenario: Calendar-related fields from LLM response are not persisted
  Given the LLM returns create_calendar_event: true and calendar_date: "2026-06-15"
  When the classification result is stored
  Then the entry in the database does not contain create_calendar_event
  And the entry in the database does not contain calendar_date
```

**TS-C-3: Exponential backoff on consecutive 429 responses during retries**
```
Scenario: Retry job backs off when encountering rate limits
  Given the classification retry job is running
  And the LLM API returns 429 for the first retry attempt
  And the LLM API returns 429 for the second retry attempt
  When the delays between retry attempts are measured
  Then the delay between the second and third attempt is greater than the delay
    between the first and second attempt (exponential backoff)
```

## Edge Case Scenarios

**TS-EC-1: Very short input is sent to LLM**
```
Scenario: Single-word input is classified without error
  Given the LLM API is available
  When classification is performed for the text "Hi"
  Then the text is sent to the LLM
  And a classification result is returned
```

**TS-EC-2: Very long input — content truncated to fit context window**
```
Scenario: Input exceeding model context window is truncated
  Given text input that is thousands of words long
  When the classification prompt is assembled
  Then the content portion is truncated to fit within the model's token limit
  And the classification instructions and context entries are preserved intact
  And a classification result is returned for the truncated content
```

**TS-EC-3: German input classified with English category names**
```
Scenario: German text receives a valid classification with English category
  Given the LLM API is available
  When classification is performed for the German text
    "Treffen mit Anna über das neue Projekt besprochen"
  Then a valid classification result is returned
  And the category is one of the five English category names
```

**TS-EC-4: Ambiguous input receives low confidence**
```
Scenario: Unclear input gets classified with low confidence
  Given the LLM API is available
  When classification is performed for the vague text "stuff"
  Then a classification result is returned
  And the confidence is expected to be below the threshold
```

**TS-EC-5: Empty context on new system**
```
Scenario: Classification works with no existing entries in the database
  Given the database has no entries
  When context is gathered for classification
  Then the {context_entries} placeholder is replaced with a note
    indicating no existing entries
  And classification proceeds successfully
```

**TS-EC-6: Confidence as numeric string is coerced to number**
```
Scenario: String confidence value that is numeric is accepted
  Given the LLM returns confidence as the string "0.85" instead of the number 0.85
  When the response is validated
  Then the string is coerced to the number 0.85
  And validation passes
```

**TS-EC-7: Non-numeric confidence string fails validation**
```
Scenario: Non-numeric string confidence value fails validation
  Given the LLM returns confidence as the string "high"
  When the response is validated
  Then validation fails
  And the entry is stored with category: null and confidence: null
```

**TS-EC-8: Threshold below 0.0 clamped to 0.0**
```
Scenario: Negative threshold value is clamped to the valid range
  Given confidence_threshold in the settings table is set to -0.5
  When the confidence threshold is resolved
  Then the threshold is clamped to 0.0
  And a warning is logged about the invalid threshold value
```

**TS-EC-9: Threshold above 1.0 clamped to 1.0**
```
Scenario: Threshold exceeding 1.0 is clamped to the valid range
  Given confidence_threshold in the settings table is set to 1.5
  When the confidence threshold is resolved
  Then the threshold is clamped to 1.0
  And a warning is logged about the invalid threshold value
```

## Non-Goal Scenarios

**TS-NG-1: Raw API response is not persisted**
```
Scenario: Only parsed fields are stored, not the raw LLM response
  Given a successful classification is performed
  When the entry is stored in the database
  Then the database row contains category, name, confidence, fields, and tags
  And the raw LLM API response body is not stored in any column
```

**TS-NG-2: Prompt change does not re-classify existing entries**
```
Scenario: Editing the prompt file does not trigger re-classification
  Given entries exist with category "people" and "tasks"
  When prompts/classify.md is modified
  Then the existing entries retain their original categories
  And no classification requests are made for already-classified entries
```

**TS-NG-3: Content edit does not trigger automatic re-classification**
```
Scenario: Updating entry content preserves the existing category
  Given an entry exists with category "projects" and confidence 0.9
  When the entry's content is updated to new text
  Then the entry's category remains "projects"
  And the entry's confidence remains 0.9
  And no classification request is made
```

## Traceability

| Spec Requirement | Scenarios | Status |
|------------------|-----------|--------|
| AC-1.1 (LLM provider + prompt) | TS-1.1, TS-1.2, TS-1.3 | ✅ Covered |
| AC-1.2 (Valid JSON response fields) | TS-1.5 | ✅ Covered |
| AC-1.3 (Schema validation) | TS-1.6, TS-1.7, TS-1.8, TS-1.9 | ✅ Covered |
| AC-1.4 (Invalid JSON → null) | TS-1.10, TS-1.11 | ✅ Covered |
| AC-2.1 (Last 5 recent entries) | TS-2.1, TS-2.2, TS-2.3 | ✅ Covered |
| AC-2.2 (Top 3 similar entries) | TS-2.4, TS-2.5, TS-2.6 | ✅ Covered |
| AC-2.3 (Deduplicated context in prompt) | TS-2.7, TS-2.8 | ✅ Covered |
| AC-2.4 (Context entry format) | TS-2.9, TS-2.10 | ✅ Covered |
| AC-3.1 (Default threshold 0.6) | TS-3.1 | ✅ Covered |
| AC-3.2 (Threshold from settings) | TS-3.2 | ✅ Covered |
| AC-3.3 (Confident >= threshold) | TS-3.3 | ✅ Covered |
| AC-3.4 (Uncertain < threshold) | TS-3.4 | ✅ Covered |
| AC-4.1 (API errors → null, content preserved) | TS-4.1, TS-4.2, TS-4.3, TS-4.4, TS-4.5 | ✅ Covered |
| AC-4.3 (Retry cron) | TS-4.6, TS-4.7, TS-4.8 | ✅ Covered |
| AC-4.4 (Structured error logging) | TS-4.9 | ✅ Covered |
| C-2 (Prompt from file, runtime reload) | TS-1.4, TS-C-1 | ✅ Covered |
| C-4 (Calendar fields ephemeral) | TS-C-2 | ✅ Covered |
| C-5 (Exponential backoff on 429) | TS-C-3 | ✅ Covered |
| EC-1 (Confidence at threshold) | TS-3.5 | ✅ Covered |
| EC-5 (Very short input) | TS-EC-1 | ✅ Covered |
| EC-6 (Very long input truncation) | TS-EC-2 | ✅ Covered |
| EC-7 (German input) | TS-EC-3 | ✅ Covered |
| EC-8 (No clear category) | TS-EC-4 | ✅ Covered |
| EC-9 (Empty context) | TS-EC-5 | ✅ Covered |
| EC-11 (Confidence as string) | TS-EC-6, TS-EC-7 | ✅ Covered |
| EC-12 (Invalid threshold clamped) | TS-EC-8, TS-EC-9 | ✅ Covered |
| NG-2 (Raw response not persisted) | TS-NG-1 | ✅ Covered |
| NG-3 (Prompt change no re-classify) | TS-NG-2 | ✅ Covered |
| NG-6 (Content edit no re-classify) | TS-NG-3 | ✅ Covered |

**Coverage gaps:** None. All acceptance criteria, constraints, edge cases, and testable non-goals have at least one test scenario.

**Orphan tests:** None. Every scenario traces to a spec requirement.

