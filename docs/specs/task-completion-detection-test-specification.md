# Task Completion Detection - Test Specification

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|------------------|
| AC-1.1: First LLM call detects task completion | TS-1.1, TS-1.2 |
| AC-1.2: Explicit completions recognized | TS-1.3 |
| AC-1.3: Implicit completions recognized | TS-1.4 |
| AC-1.4: `is_task_completion` flag, no extra call when false | TS-1.5 |
| AC-2.1: Semantic search for pending tasks | TS-2.1 |
| AC-2.2: Top 5 candidates above threshold | TS-2.2 |
| AC-2.3: Second LLM call returns matches with confidence | TS-2.3 |
| AC-2.4: Max 3 completions per message | TS-2.4 |
| AC-2.5: Zero candidates skips second LLM call | TS-2.5 |
| AC-3.1: High-confidence auto-completes task | TS-3.1 |
| AC-3.2: Low-confidence shows inline confirmation | TS-3.2 |
| AC-3.3: User confirms via Yes button | TS-3.3 |
| AC-3.4: User denies via No button | TS-3.4 |
| AC-4.1: New thought classified independently | TS-4.1 |
| AC-4.2: New thought stored as separate entry | TS-4.2 |
| AC-4.3: Completion detection does not alter new entry | TS-4.3 |
| AC-5.1: Auto-completion shown in reply | TS-5.1 |
| AC-5.2: Multiple auto-completions listed | TS-5.2 |
| AC-5.3: Low-confidence shows inline button | TS-5.3 |
| AC-5.4: Mixed confidence reply | TS-5.4 |
| AC-6.1: Works for Telegram text | TS-6.1 |
| AC-6.2: Works for Telegram voice | TS-6.2 |
| AC-6.3: Works for webapp capture | TS-6.3 |
| AC-6.4: Works for MCP add_thought | TS-6.4 |
| AC-7.1: /fix undoes auto-completion | TS-7.1 |
| EC-1: Already-done task ignored | TS-EC-1 |
| EC-2: Multiple matches, one correct | TS-EC-2 |
| EC-3: New thought is itself a task | TS-EC-3 |
| EC-4: No pending tasks exist | TS-EC-4 |
| EC-5: First LLM call fails | TS-EC-5 |
| EC-6: Second LLM call fails | TS-EC-6 |
| EC-7: Confirm already-done task is no-op | TS-EC-7 |
| EC-8: Ambiguous voice, very low match | TS-EC-8 |
| C-1: LLM cost (no second call when false) | TS-1.5, TS-2.5 |
| C-2: LLM-agnostic provider | TS-C-1 |
| NG-1: Projects not affected | TS-NG-1 |
| NG-2: No auto-created follow-up tasks | TS-NG-2 |
| NG-3: No retroactive matching | TS-NG-3 |

## Test Scenarios

### US-1: Detection in First LLM Call

**TS-1.1: Classification response includes is_task_completion flag**
```
Given the classification LLM is available
When a new thought is classified
Then the classification response includes an `is_task_completion` boolean field
```

**TS-1.2: is_task_completion is true for completion-indicating text**
```
Given the classification LLM is available
When a new thought "I called the landlord" is classified
Then `is_task_completion` is `true`
```

**TS-1.3: Explicit completion is recognized**
```
Given a pending task "Call landlord about Sendling" exists
And the classification LLM returns `is_task_completion: true` for "I called the landlord"
When completion detection runs
Then the task "Call landlord about Sendling" is identified as a match
```

**TS-1.4: Implicit completion is recognized**
```
Given a pending task "Call landlord about Sendling" exists
And the classification LLM returns `is_task_completion: true` for "The landlord said the apartment is available next month"
When completion detection runs
Then the task "Call landlord about Sendling" is identified as a match
```

**TS-1.5: No second LLM call when is_task_completion is false**
```
Given the classification LLM returns `is_task_completion: false`
When a new thought is processed
Then no semantic search for pending tasks is performed
And no second LLM call is made
```

### US-2: Task Matching via Semantic Search + Second LLM Call

**TS-2.1: Semantic search targets pending, non-deleted tasks**
```
Given pending tasks exist in the database
And a done task and a soft-deleted pending task also exist
When semantic search for candidate tasks is performed
Then only entries with category "tasks", status "pending", and no deleted_at are returned
```

**TS-2.2: Top 5 candidates above similarity threshold retrieved**
```
Given 7 pending tasks exist, 5 of which have similarity >= 0.5 to the new thought
When semantic search for candidate tasks is performed
Then exactly 5 candidates are returned
And all have similarity >= 0.5
```

**TS-2.3: Second LLM call returns matches with entry_id and confidence**
```
Given 3 candidate tasks are found via semantic search
When the second LLM call is made with the candidates and new thought text
Then the response contains zero or more matches
And each match includes an `entry_id` and a `confidence` score between 0.0 and 1.0
```

**TS-2.4: Maximum 3 completions per message**
```
Given the second LLM call returns 5 matches
When completion results are processed
Then only the top 3 matches by confidence are used
And the remaining 2 are discarded
```

**TS-2.5: Zero candidates skips second LLM call**
```
Given no pending tasks have similarity >= 0.5 to the new thought
When completion detection runs after `is_task_completion: true`
Then no second LLM call is made
And no completion is detected
```

### US-3: Confidence-Based Auto/Confirm

**TS-3.1: High-confidence match auto-completes task**
```
Given the confidence threshold is 0.6
And a task match has confidence 0.85
When the match is processed
Then the matched task's status is updated to "done"
```

**TS-3.2: Low-confidence match shows inline confirmation**
```
Given the confidence threshold is 0.6
And a task match has confidence 0.45
When the match is processed
Then the matched task's status remains "pending"
And an inline confirmation prompt is shown to the user
```

**TS-3.3: User confirms low-confidence completion**
```
Given a low-confidence task completion prompt is shown with [Yes] [No] buttons
When the user taps "Yes"
Then the matched task's status is updated to "done"
```

**TS-3.4: User denies low-confidence completion**
```
Given a low-confidence task completion prompt is shown with [Yes] [No] buttons
When the user taps "No"
Then the matched task's status remains "pending"
```

### US-4: Independent Classification and Storage

**TS-4.1: New thought classified independently of completion**
```
Given a new thought triggers completion detection
When the thought is classified
Then it receives its own category based on normal classification rules
And the category is not affected by completion detection
```

**TS-4.2: New thought stored as a separate entry**
```
Given a new thought triggers completion of task "Call landlord"
When the thought is stored
Then a new entry is created with its own ID, embedding, tags, and fields
And the new entry is not merged into the completed task
```

**TS-4.3: Completion detection does not alter new entry**
```
Given a new thought triggers completion detection
When the thought is stored
Then the new entry's category, name, tags, and fields are unchanged by completion detection
```

### US-5: Capture Confirmation Messages

**TS-5.1: Auto-completion shown in Telegram reply**
```
Given a task "Call landlord" is auto-completed with high confidence
When the Telegram reply is sent
Then the reply includes the classification confirmation
And the reply includes "Marked 'Call landlord' as done"
```

**TS-5.2: Multiple auto-completions listed in reply**
```
Given tasks "Call landlord" and "Email accountant" are both auto-completed
When the Telegram reply is sent
Then the reply lists both completions separately
```

**TS-5.3: Low-confidence completion shows inline button**
```
Given a task match has confidence below the threshold
When the Telegram reply is sent
Then the reply includes the classification confirmation
And the reply includes an inline button "Did this complete '{task name}'? [Yes] [No]"
```

**TS-5.4: Mixed confidence reply shows both auto and confirm**
```
Given one task match has high confidence and another has low confidence
When the Telegram reply is sent
Then the high-confidence completion is shown as done
And the low-confidence completion is shown with an inline confirmation button
```

### US-6: Cross-Source Support

**TS-6.1: Completion detection works for Telegram text messages**
```
Given a pending task exists
When a Telegram text message implying completion is received
Then completion detection runs and the task is matched
```

**TS-6.2: Completion detection works for Telegram voice messages**
```
Given a pending task exists
When a Telegram voice message is transcribed and the transcription implies completion
Then completion detection runs and the task is matched
```

**TS-6.3: Completion detection works for webapp quick capture**
```
Given a pending task exists
When a webapp quick capture implying completion is submitted
Then completion detection runs and the task is matched
```

**TS-6.4: Completion detection works for MCP add_thought**
```
Given a pending task exists
When an MCP add_thought call with text implying completion is made
Then completion detection runs and the task is matched
And the MCP response includes which tasks were marked as done
```

### US-7: Undo via /fix

**TS-7.1: /fix undoes automatic task completion**
```
Given a task "Call landlord" was auto-completed by the system
When the user sends "/fix that didn't complete the landlord task"
Then the matched task's status is restored to "pending"
```

## Edge Case Scenarios

**TS-EC-1: Already-done task is not a candidate**
```
Given a task "Call landlord" exists with status "done"
And a pending task "Email accountant" exists
When completion detection searches for candidates matching "I called the landlord"
Then "Call landlord" is not in the candidate list
```

**TS-EC-2: Multiple matches but only one correct**
```
Given pending tasks "Call landlord about Sendling" and "Call landlord about Schwabing" exist
When the new thought is "The Sendling landlord confirmed availability"
Then the match for "Call landlord about Sendling" has high confidence
And the match for "Call landlord about Schwabing" has low or zero confidence
```

**TS-EC-3: New thought is itself classified as a Task**
```
Given a pending task "Call landlord about Sendling" exists
When the new thought "Called the landlord about Sendling. Need to sign the lease by Friday." is processed
Then a new entry is created with category "tasks" (for the lease signing)
And the existing task "Call landlord about Sendling" is marked as done
```

**TS-EC-4: No pending tasks exist**
```
Given no entries with category "tasks" and status "pending" exist
When a thought with `is_task_completion: true` is processed
Then semantic search returns zero candidates
And no second LLM call is made
And no completion is detected
```

**TS-EC-5: First LLM call fails**
```
Given the classification LLM is unavailable or returns an error
When a new thought is processed
Then the entry is stored with category null (existing behavior)
And no completion detection is attempted
```

**TS-EC-6: Second LLM call fails**
```
Given `is_task_completion` is true and candidates are found
And the second LLM call fails (timeout, rate limit, bad response)
When completion detection runs
Then the new entry is stored normally
And no task is marked as done
And a warning is logged
And no completion message is shown to the user
```

**TS-EC-7: Confirming an already-done task is a no-op**
```
Given a low-confidence completion prompt was shown for task "Call landlord"
And the task has since been marked as done by another means
When the user taps "Yes" on the inline button
Then the task remains "done" (no error, no duplicate update)
```

**TS-EC-8: Ambiguous voice transcription with very low match**
```
Given a pending task exists
And a voice message transcription is ambiguous
And `is_task_completion` is flagged as true
When semantic search returns candidates but all have very low similarity
Then no second LLM call is made (zero candidates above threshold)
Or the second LLM call returns zero matches
And no completion is detected
```

## Constraint Scenarios

**TS-C-1: Completion detection works with any LLM provider**
```
Given the system is configured with any supported LLM provider
When completion detection runs (both first and second LLM calls)
Then the provider abstraction is used for both calls
And no provider-specific API is called directly
```

## Non-Goal Guard Scenarios

**TS-NG-1: Projects are not affected by completion detection**
```
Given an entry with category "projects" exists
When a new thought mentions completing work related to that project
Then no status change is made to the project entry
And only entries with category "tasks" are considered as candidates
```

**TS-NG-2: No follow-up tasks auto-created from completion context**
```
Given a new thought "Called the landlord, need to sign lease by Friday" is processed
When the thought is classified and completion detection runs
Then the new entry is classified through normal classification
And no additional task entries are auto-created by completion detection
```

**TS-NG-3: No retroactive matching of existing entries**
```
Given a new pending task "Call landlord" is created
And an older entry "I spoke with the landlord last week" already exists
When the new task is stored
Then no completion detection runs against existing entries
And completion detection only triggers at capture time for new thoughts
```

## Traceability

All 20 acceptance criteria (AC-1.1 through AC-7.1) are covered by at least one test scenario. All 8 edge cases (EC-1 through EC-8) have corresponding scenarios. The LLM-agnostic constraint is covered by TS-C-1. The LLM cost constraint is covered by TS-1.5 and TS-2.5. Three non-goals have guard scenarios preventing scope creep.

Total: 38 test scenarios covering 20 acceptance criteria, 8 edge cases, 1 constraint scenario, and 3 non-goal guards.
