# Task Completion Detection - Behavioral Specification

## Objective

When a user captures a new thought that implies they completed an existing task, the system detects this and marks the matching task as done. This saves the user from manually closing tasks after reporting what they did. The new thought is still classified and stored normally — completion detection is a side-effect, not a replacement for classification.

## User Stories & Acceptance Criteria

### US-1: As a user, I want the system to detect when a new thought implies I completed an existing task, so that I don't have to manually mark tasks as done.

**AC-1.1:** When the first classification LLM call determines that a new thought indicates task completion (explicit or implicit), the system performs a second step to identify which task was completed.

**AC-1.2:** Explicit completions are recognized. Example: "I called the landlord" matches pending task "Call landlord about Sendling."

**AC-1.3:** Implicit completions are recognized. Example: "The landlord said the apartment is available next month" implies the call happened and matches pending task "Call landlord about Sendling."

**AC-1.4:** The first LLM call returns an `is_task_completion` boolean flag as part of the classification response. No additional LLM call occurs when this flag is `false`.

### US-2: As a user, I want the system to match completion signals to the correct pending task using semantic search and a second LLM call.

**AC-2.1:** When `is_task_completion` is `true`, the system performs a semantic search for pending tasks (entries with `category = 'tasks'` and `fields.status = 'pending'`, not soft-deleted) using the new thought's embedding.

**AC-2.2:** The top 5 pending tasks above the semantic similarity threshold (0.5) are retrieved as candidates.

**AC-2.3:** A second LLM call receives the candidate tasks (ID, name, content) and the new thought text, and returns zero or more matches, each with an `entry_id` and `confidence` score (0.0–1.0).

**AC-2.4:** A maximum of 3 task completions are detected per message. If the LLM returns more than 3, only the top 3 by confidence are used.

**AC-2.5:** If semantic search returns zero candidates, no second LLM call is made and no completion is detected.

### US-3: As a user, I want high-confidence completions to be applied automatically and low-confidence ones to require my confirmation.

**AC-3.1:** When a matched task's confidence is at or above the system's `confidence_threshold` setting, the matched task's `fields.status` is automatically updated to `done`.

**AC-3.2:** When a matched task's confidence is below the `confidence_threshold`, the user is shown an inline confirmation prompt. On Telegram, this is an inline keyboard button: "Did this complete '{task name}'? [Yes] [No]".

**AC-3.3:** When the user confirms (taps Yes), the matched task's `fields.status` is updated to `done`.

**AC-3.4:** When the user denies (taps No), no change is made to the matched task.

### US-4: As a user, I want the new thought to be classified and stored independently of completion detection.

**AC-4.1:** The new thought is classified into its own category (People, Projects, Tasks, Ideas, Reference) using the existing classification pipeline, regardless of whether it also triggers completion detection.

**AC-4.2:** The new thought is stored as a new entry with its own embedding, tags, and fields. It is never merged into the matched task.

**AC-4.3:** Completion detection does not alter the new entry's category, name, tags, or fields.

### US-5: As a user, I want to see what happened in the capture confirmation message.

**AC-5.1:** When a task is auto-completed (high confidence), the Telegram reply includes both the classification confirmation and the completion: "✅ Filed as {category} → {name} ({confidence}%). ✅ Marked '{task name}' as done."

**AC-5.2:** When multiple tasks are auto-completed, each is listed: "✅ Marked '{task1}' as done. ✅ Marked '{task2}' as done."

**AC-5.3:** When a task completion requires confirmation (low confidence), the reply includes the classification confirmation followed by the inline button prompt.

**AC-5.4:** When a message both auto-completes some tasks and requires confirmation for others, both are shown in the same reply.

### US-6: As a user, I want completion detection to work across all capture sources.

**AC-6.1:** Completion detection works for Telegram text messages.

**AC-6.2:** Completion detection works for Telegram voice messages (after transcription).

**AC-6.3:** Completion detection works for webapp quick capture.

**AC-6.4:** Completion detection works for MCP `add_thought` tool. The response includes which tasks were marked as done.

### US-7: As a user, I want to undo an incorrect automatic completion using `/fix`.

**AC-7.1:** The existing `/fix` command can be used to undo an automatic task completion. The user sends `/fix that didn't complete the landlord task` and the system restores the matched task's status to `pending`.

## Constraints

- **LLM cost:** The second LLM call only fires when `is_task_completion` is `true`. Most messages will not trigger it.
- **Latency:** The second LLM call adds latency to the capture pipeline. It should use a concise prompt to minimize token count and response time.
- **LLM-agnostic:** Both LLM calls must work with any configured provider (Anthropic, OpenAI, Groq, Gemini, Ollama, local).

## Edge Cases

**EC-1:** The new thought matches a task but the task is already done. No action is taken — only `pending` tasks are candidates.

**EC-2:** The new thought could match multiple tasks but only one was actually completed. The confidence scores should reflect this — the LLM should return high confidence for the real match and low/no confidence for the others.

**EC-3:** The new thought is itself classified as a Task. Completion detection still applies — a new task and a completed old task are independent. Example: "Called the landlord about Sendling. Need to sign the lease by Friday." → new task "Sign lease by Friday" + marks "Call landlord about Sendling" as done.

**EC-4:** No pending tasks exist. The semantic search returns zero candidates, no second LLM call is made.

**EC-5:** The LLM classification API fails during the first call. Existing behavior applies (entry stored with `category: null`). No completion detection is attempted.

**EC-6:** The second LLM call fails (timeout, rate limit, bad response). The new entry is stored normally. No task is marked as done. A warning is logged. The user is not shown a completion message.

**EC-7:** The user confirms a low-confidence completion via inline button, but the task was already marked as done by another means (e.g., manual edit in webapp). The confirmation is a no-op.

**EC-8:** A voice message transcription is ambiguous enough that `is_task_completion` is flagged but the semantic match confidence is very low. The system correctly falls through to showing an inline button or no match at all.

## Non-Goals

- **Project status changes:** Only tasks with `pending` status are candidates. Projects are not affected by this feature.
- **Task creation from completion context:** The system does not auto-create follow-up tasks from completion messages (e.g., "Called the landlord, need to sign lease by Friday" does not auto-create a "Sign lease" task — it goes through normal classification).
- **Retroactive matching:** The system does not scan existing entries to find past completions. It only detects completions at capture time.
- **Batch completion:** No UI or command for marking multiple tasks as done at once outside of the natural capture flow.

## Open Questions

None — all questions resolved during specification discussion.
