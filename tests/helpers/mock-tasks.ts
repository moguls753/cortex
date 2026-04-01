/**
 * Test helpers for task completion detection.
 * Factories for pending/done task entries and completion match responses.
 */

export interface PendingTaskData {
  id: string;
  name: string;
  content: string;
  category: string;
  fields: Record<string, unknown>;
  tags: string[];
  source: string;
  source_type: string;
  similarity?: number;
}

/**
 * Create a pending task entry with sensible defaults.
 */
export function createPendingTask(
  overrides?: Partial<PendingTaskData>,
): PendingTaskData {
  return {
    id: overrides?.id ?? crypto.randomUUID(),
    name: overrides?.name ?? "Call landlord about Sendling",
    content:
      overrides?.content ?? "Call landlord about the Sendling apartment",
    category: "tasks",
    fields: overrides?.fields ?? {
      status: "pending",
      due_date: null,
      notes: null,
    },
    tags: overrides?.tags ?? ["housing"],
    source: overrides?.source ?? "telegram",
    source_type: overrides?.source_type ?? "text",
    similarity: overrides?.similarity ?? 0.75,
  };
}

/**
 * Create a done task entry.
 */
export function createDoneTask(
  overrides?: Partial<PendingTaskData>,
): PendingTaskData {
  return createPendingTask({
    ...overrides,
    fields: { status: "done", due_date: null, notes: null },
  });
}

/**
 * Create a JSON string for the second LLM call response (task match results).
 */
export function createTaskMatchResponse(
  matches: Array<{ entry_id: string; confidence: number }>,
): string {
  return JSON.stringify({ matches });
}

/**
 * Create a classification result that includes the is_task_completion flag.
 */
export function createClassificationWithCompletion(
  overrides?: Partial<{
    category: string;
    name: string;
    confidence: number;
    fields: Record<string, unknown>;
    tags: string[];
    is_task_completion: boolean;
    create_calendar_event: boolean;
    calendar_date: string | null;
    calendar_time: string | null;
  }>,
) {
  return {
    category: overrides?.category ?? "people",
    name: overrides?.name ?? "Landlord Chat",
    confidence: overrides?.confidence ?? 0.92,
    fields: overrides?.fields ?? { relationship: "acquaintance" },
    tags: overrides?.tags ?? ["housing"],
    is_task_completion: overrides?.is_task_completion ?? true,
    create_calendar_event: overrides?.create_calendar_event ?? false,
    calendar_date: overrides?.calendar_date ?? null,
    calendar_time: overrides?.calendar_time ?? null,
  };
}
