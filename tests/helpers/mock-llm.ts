/**
 * Test helpers for mocking LLM provider responses.
 * Used by classification tests to simulate LLM behavior without real API calls.
 */

export interface ClassificationResult {
  category: "people" | "projects" | "tasks" | "ideas" | "reference";
  name: string;
  confidence: number;
  fields: Record<string, unknown>;
  tags: string[];
  create_calendar_event: boolean;
  calendar_date: string | null;
  calendar_time: string | null;
}

const DEFAULT_CLASSIFICATION: ClassificationResult = {
  category: "people",
  name: "Maria Coffee Chat",
  confidence: 0.92,
  fields: { relationship: "friend" },
  tags: ["social", "startup"],
  create_calendar_event: false,
  calendar_date: null,
  calendar_time: null,
};

/**
 * Create a valid classification result object with sensible defaults.
 * Override individual fields as needed.
 */
export function createClassificationResult(
  overrides?: Partial<ClassificationResult>,
): ClassificationResult {
  return { ...DEFAULT_CLASSIFICATION, ...overrides };
}

/**
 * Create a valid JSON string response from the LLM.
 */
export function createClassificationJSON(
  overrides?: Partial<ClassificationResult>,
): string {
  return JSON.stringify(createClassificationResult(overrides));
}

/**
 * Create a mock LLM chat function that returns the given response string.
 * Supports string responses, Error throws, and API error objects.
 */
export function createMockChat(
  response: string | Error | { status: number; message: string },
): (...args: unknown[]) => Promise<string> {
  return async () => {
    if (response instanceof Error) {
      throw response;
    }
    if (typeof response === "object" && "status" in response) {
      const err = new Error(response.message) as Error & { status: number };
      err.status = response.status;
      throw err;
    }
    return response;
  };
}
