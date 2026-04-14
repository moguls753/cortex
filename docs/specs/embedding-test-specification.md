# Embedding - Test Specification

| Field | Value |
|-------|-------|
| Feature | Embedding |
| Phase | 2 — Test Specification |
| Date | 2026-03-03 |
| Status | Draft |
| Derives from | `docs/specs/embedding-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|------------------|
| AC-1.1: Call Ollama, return 4096-dim float array | TS-1.1 |
| AC-1.2: English text embeddings | TS-1.2 |
| AC-1.3: German text embeddings | TS-1.3 |
| AC-1.4: Mixed EN/DE text embeddings | TS-1.4 |
| C-3: Concatenate name + content for input | TS-1.5 |
| AC-2.1: Verify connectivity via /api/tags | TS-2.1 |
| AC-2.2: Auto-pull model if missing | TS-2.2, TS-2.3 |
| AC-2.3: Ollama unreachable on startup → warn, don't crash | TS-2.4 |
| AC-3.1: Failed embedding → store with null | TS-3.1 |
| AC-3.2: Cron queries entries with null embedding | TS-3.2 |
| AC-3.3: Retry generates embedding and updates entry | TS-3.3 |
| AC-3.4: Retry failure → log error, leave null | TS-3.4 |
| C-2: OLLAMA_URL configurable + settings override | TS-C-1, TS-C-2 |
| C-4: 30-second timeout | TS-C-3 |
| EC-1: Short text (single word) | TS-EC-1 |
| EC-2: Long text truncation at word boundary | TS-EC-2 |
| EC-3: Ollama unreachable during operation | (covered by TS-3.1) |
| EC-4: Model deleted after startup | TS-EC-3, TS-EC-8 |
| EC-5: Empty input skips embedding | TS-EC-4 |
| EC-6: Special characters / emojis / non-Latin | TS-EC-5 |
| EC-7: Retry order — oldest first, sequential | TS-EC-6 |
| EC-8: Wrong dimensionality rejected | TS-EC-7 |
| NG-5: Re-embed on content update | TS-NG-1 |
| NG-3: No caching for identical text | TS-NG-2 |

## Test Scenarios

### US-1: Embedding Generation

**TS-1.1: Generate embedding and receive 4096-dimensional float array**
```
Scenario: Text input produces a 4096-dimensional embedding
  Given the Ollama service is reachable
  And the qwen3-embedding model is available
  When an embedding is generated for the text "This is a test sentence"
  Then a float array with exactly 4096 elements is returned
  And every element is a finite floating-point number
```

**TS-1.2: Generate embedding for English text**
```
Scenario: English text produces a valid embedding
  Given the Ollama service is reachable
  And the qwen3-embedding model is available
  When an embedding is generated for the English text "Meeting notes from the product review"
  Then a 4096-dimensional float array is returned
```

**TS-1.3: Generate embedding for German text**
```
Scenario: German text produces a valid embedding
  Given the Ollama service is reachable
  And the qwen3-embedding model is available
  When an embedding is generated for the German text "Besprechungsnotizen aus der Produktbewertung"
  Then a 4096-dimensional float array is returned
```

**TS-1.4: Generate embedding for mixed English/German text**
```
Scenario: Mixed language text produces a valid embedding
  Given the Ollama service is reachable
  And the qwen3-embedding model is available
  When an embedding is generated for the text "Meeting about the Projektzeitplan and next steps"
  Then a 4096-dimensional float array is returned
```

**TS-1.5: Input text is concatenation of entry name and content**
```
Scenario: Embedding input combines name and content fields
  Given an entry with name "Weekly Standup" and content "Discussed blockers and sprint goals"
  When the embedding input is prepared for the entry
  Then the text sent for embedding is the concatenation of name and content
```

### US-2: Startup Verification

**TS-2.1: Startup verifies Ollama connectivity**
```
Scenario: Startup checks Ollama availability via /api/tags
  Given Ollama is reachable
  And the qwen3-embedding model is available
  When the embedding service initializes
  Then Ollama's model list is checked
  And initialization completes successfully
```

**TS-2.2: Startup auto-pulls model when missing**
```
Scenario: Model is pulled automatically when not present
  Given Ollama is reachable
  And the qwen3-embedding model is not in the model list
  When the embedding service initializes
  Then the system pulls the qwen3-embedding model
  And initialization completes successfully
```

**TS-2.3: Startup skips pull when model is already present**
```
Scenario: No pull request when model already exists
  Given Ollama is reachable
  And the qwen3-embedding model is in the model list
  When the embedding service initializes
  Then no model pull is performed
```

**TS-2.4: Ollama unreachable on startup — warn but don't crash**
```
Scenario: Application starts despite Ollama being unreachable
  Given Ollama is unreachable
  When the embedding service initializes
  Then a warning is logged indicating Ollama is unreachable
  And the initialization completes without throwing an error
```

### US-3: Retry Mechanism

**TS-3.1: Failed embedding stores entry with null embedding**
```
Scenario: Entry is stored with null embedding when Ollama is unavailable
  Given Ollama is unreachable
  When an entry is saved with name "Test" and content "Some content"
  Then the entry is stored in the database
  And the entry's embedding column is null
```

**TS-3.2: Retry cron queries entries with null embeddings**
```
Scenario: Retry job finds all entries missing embeddings
  Given three entries exist in the database
  And two of them have embedding: null
  And one has a valid embedding
  When the embedding retry job runs
  Then only the two entries with null embeddings are selected for processing
```

**TS-3.3: Retry cron generates and stores embedding**
```
Scenario: Retry job successfully generates embedding for an entry
  Given an entry exists with embedding: null
  And Ollama is reachable
  When the embedding retry job runs
  Then the entry's embedding column is updated with a 4096-dimensional vector
```

**TS-3.4: Retry failure logs error and leaves embedding null**
```
Scenario: Retry failure is logged and entry remains without embedding
  Given an entry exists with embedding: null
  And Ollama returns an error for embedding requests
  When the embedding retry job runs
  Then an error is logged containing the entry ID and error message
  And the entry's embedding column remains null
```

## Constraint Scenarios

**TS-C-1: Ollama URL from configuration**
```
Scenario: Embedding service uses configured Ollama URL
  Given OLLAMA_URL is set to "http://custom-ollama:11434"
  When the embedding service resolves the Ollama URL
  Then it uses "http://custom-ollama:11434"
```

**TS-C-2: Settings table overrides OLLAMA_URL environment variable**
```
Scenario: Database setting for Ollama URL overrides env var
  Given OLLAMA_URL environment variable is set to "http://env-ollama:11434"
  And the settings table contains key "ollama_url" with value "http://db-ollama:11434"
  When the embedding service resolves the Ollama URL
  Then it uses "http://db-ollama:11434"
```

**TS-C-3: Embedding requests use a 30-second timeout**
```
Scenario: Embedding request times out after 30 seconds
  Given Ollama is reachable but takes longer than 30 seconds to respond
  When an embedding is requested
  Then the request fails with a timeout error
  And the failure is handled gracefully (no unhandled exception)
```

## Edge Case Scenarios

**TS-EC-1: Very short text produces valid embedding**
```
Scenario: Single-word input returns a valid embedding
  Given the Ollama service is reachable
  When an embedding is generated for the text "Hello"
  Then a 4096-dimensional float array is returned
```

**TS-EC-2: Very long text is truncated at word boundary**
```
Scenario: Text exceeding model context window is truncated
  Given text input that exceeds 8192 tokens
  When the embedding input is prepared
  Then the text is truncated to fit within the model's context limit
  And truncation occurs at a word boundary (not mid-word)
  And a valid 4096-dimensional embedding is returned for the truncated text
```

**TS-EC-3: Model deleted between startup and request**
```
Scenario: Error is handled when model disappears after startup
  Given the embedding service initialized successfully with the model present
  And the model has since been removed from Ollama
  When an embedding is requested
  Then the error is logged
  And the entry is stored with embedding: null
```

**TS-EC-4: Empty input skips embedding generation**
```
Scenario: Empty name and null content skips embedding
  Given an entry with an empty name and null content
  When embedding is requested for the entry
  Then embedding generation is skipped
  And a warning is logged
  And the entry is stored with embedding: null
```

**TS-EC-5: Special characters, emojis, and non-Latin scripts are passed through**
```
Scenario: Text with emojis and special characters is embedded without modification
  Given the Ollama service is reachable
  When an embedding is generated for the text "Notizen 📝 über das Projekt — café ☕"
  Then the text is sent to Ollama without stripping or escaping
  And a 4096-dimensional float array is returned
```

**TS-EC-6: Retry processes entries sequentially, oldest first**
```
Scenario: Retry job processes entries one at a time in creation order
  Given three entries with null embeddings exist
  And entry A was created at T1, entry B at T2, entry C at T3 (T1 < T2 < T3)
  And Ollama is reachable
  When the embedding retry job runs
  Then entry A is processed before entry B
  And entry B is processed before entry C
  And entries are processed one at a time (not concurrently)
```

**TS-EC-7: Wrong dimensionality is rejected**
```
Scenario: Embedding with incorrect dimension count is rejected
  Given Ollama returns a vector with 512 elements instead of 4096
  When the embedding response is validated
  Then an error is logged indicating incorrect dimensions (expected 4096, got 512)
  And the entry is stored with embedding: null
```

**TS-EC-8: Retry re-pulls model when it has been deleted**
```
Scenario: Retry job re-pulls model when it is missing from Ollama
  Given an entry exists with embedding: null
  And Ollama is reachable
  And the qwen3-embedding model is not in the model list
  When the embedding retry job runs
  Then the system checks the model list
  And pulls the qwen3-embedding model
  And generates the embedding for the entry
```

## Non-Goal Scenarios

**TS-NG-1: Embedding is regenerated when entry content changes**
```
Scenario: Updating an entry's content triggers re-embedding
  Given an entry exists with a valid embedding
  When the entry's content is updated to new text
  Then a new embedding is generated for the updated text
  And the entry's embedding column is updated with the new vector
```

**TS-NG-2: Identical text is not cached — each entry is embedded independently**
```
Scenario: Two entries with identical text both trigger separate embedding requests
  Given the Ollama service is reachable
  When two entries are saved with identical name and content
  Then two separate embedding requests are made to Ollama
  And each entry has its own embedding stored
```

## Traceability

| Spec Requirement | Scenarios | Status |
|------------------|-----------|--------|
| AC-1.1 (Ollama call, 4096-dim) | TS-1.1 | ✅ Covered |
| AC-1.2 (English text) | TS-1.2 | ✅ Covered |
| AC-1.3 (German text) | TS-1.3 | ✅ Covered |
| AC-1.4 (Mixed EN/DE) | TS-1.4 | ✅ Covered |
| AC-2.1 (Startup /api/tags check) | TS-2.1 | ✅ Covered |
| AC-2.2 (Auto-pull missing model) | TS-2.2, TS-2.3 | ✅ Covered |
| AC-2.3 (Unreachable → warn, no crash) | TS-2.4 | ✅ Covered |
| AC-3.1 (Failed → null embedding) | TS-3.1 | ✅ Covered |
| AC-3.2 (Cron queries null embeddings) | TS-3.2 | ✅ Covered |
| AC-3.3 (Retry generates + updates) | TS-3.3 | ✅ Covered |
| AC-3.4 (Retry failure → log, leave null) | TS-3.4 | ✅ Covered |
| C-2 (OLLAMA_URL config + override) | TS-C-1, TS-C-2 | ✅ Covered |
| C-3 (Concatenate name + content) | TS-1.5 | ✅ Covered |
| C-4 (30-second timeout) | TS-C-3 | ✅ Covered |
| C-5 (Sequential cron processing) | TS-EC-6 | ✅ Covered |
| EC-1 (Short text) | TS-EC-1 | ✅ Covered |
| EC-2 (Long text truncation) | TS-EC-2 | ✅ Covered |
| EC-3 (Ollama unreachable mid-operation) | TS-3.1 | ✅ Covered |
| EC-4 (Model deleted after startup) | TS-EC-3, TS-EC-8 | ✅ Covered |
| EC-5 (Empty input) | TS-EC-4 | ✅ Covered |
| EC-6 (Special chars / emojis) | TS-EC-5 | ✅ Covered |
| EC-7 (Multiple retry ordering) | TS-EC-6 | ✅ Covered |
| EC-8 (Wrong dimensionality) | TS-EC-7 | ✅ Covered |
| NG-3 (No caching) | TS-NG-2 | ✅ Covered |
| NG-5 (Re-embed on content change) | TS-NG-1 | ✅ Covered |

**Coverage gaps:** None. All acceptance criteria, constraints, edge cases, and testable non-goals have at least one test scenario.

**Orphan tests:** None. Every scenario traces to a spec requirement.
