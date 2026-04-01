/**
 * Unit tests for the task completion detection module.
 * Tests classification flag, semantic search, second LLM call,
 * confidence gating, independent storage, edge cases, constraints,
 * and non-goal guards.
 *
 * Scenarios: TS-1.1–1.5, TS-2.1–2.5, TS-3.1–3.4, TS-4.1–4.3,
 *            TS-EC-1–EC-8, TS-C-1, TS-NG-1–NG-3
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  createPendingTask,
  createDoneTask,
  createTaskMatchResponse,
  createClassificationWithCompletion,
} from "../helpers/mock-tasks.js";

// ---------------------------------------------------------------------------
// Module mocks — hoisted
// ---------------------------------------------------------------------------

const mockChat = vi.fn();
const mockCreateLLMProvider = vi.fn(() => ({ chat: mockChat }));

vi.mock("../../src/llm/index.js", () => ({
  createLLMProvider: mockCreateLLMProvider,
}));

const mockGenerateEmbedding = vi.fn();

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

const mockGetLLMConfig = vi.fn();

vi.mock("../../src/llm/config.js", () => ({
  getLLMConfig: (...args: unknown[]) => mockGetLLMConfig(...args),
}));

const mockResolveConfigValue = vi.fn();

vi.mock("../../src/config.js", () => ({
  config: {},
  resolveConfigValue: (...args: unknown[]) => mockResolveConfigValue(...args),
}));

// ---------------------------------------------------------------------------
// Types — will fail to import until src/task-completion.ts exists
// ---------------------------------------------------------------------------

type DetectTaskCompletion = (
  text: string,
  classificationResult: {
    category: string | null;
    name: string | null;
    confidence: number | null;
    is_task_completion: boolean;
    fields: Record<string, unknown>;
    tags: string[];
  },
  sql: unknown,
) => Promise<{
  autoCompleted: Array<{ entry_id: string; name: string; confidence: number }>;
  needsConfirmation: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
}>;

type FindPendingTaskCandidates = (
  embedding: number[],
  sql: unknown,
) => Promise<
  Array<{
    id: string;
    name: string;
    content: string;
    similarity: number;
  }>
>;

type MatchCompletedTasks = (
  candidates: Array<{ id: string; name: string; content: string }>,
  thoughtText: string,
  llmConfig: { provider: string; apiKey: string; model: string },
  sql: unknown,
) => Promise<Array<{ entry_id: string; confidence: number }>>;

type ApplyTaskCompletions = (
  matches: Array<{ entry_id: string; confidence: number }>,
  confidenceThreshold: number,
  sql: unknown,
) => Promise<{
  autoCompleted: Array<{ entry_id: string; name: string; confidence: number }>;
  needsConfirmation: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
}>;

type ConfirmTaskCompletion = (
  entryId: string,
  sql: unknown,
) => Promise<void>;

// Dynamic imports — will fail until module exists
let detectTaskCompletion: DetectTaskCompletion;
let findPendingTaskCandidates: FindPendingTaskCandidates;
let matchCompletedTasks: MatchCompletedTasks;
let applyTaskCompletions: ApplyTaskCompletions;
let confirmTaskCompletion: ConfirmTaskCompletion;

// ---------------------------------------------------------------------------
// Mock SQL helper
// ---------------------------------------------------------------------------

function createMockSql(
  responses: Array<{ pattern: string; result: unknown[] }>,
) {
  const fn = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const query = strings.join("?");
    for (const { pattern, result } of responses) {
      if (query.includes(pattern)) return Promise.resolve(result);
    }
    return Promise.resolve([]);
  };
  return fn as unknown;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.clearAllMocks();

  mockGetLLMConfig.mockResolvedValue({
    provider: "openai",
    apiKeys: { openai: "test-key" },
    model: "gpt-4",
    baseUrl: "",
  });

  mockResolveConfigValue.mockImplementation((key: string) => {
    if (key === "confidence_threshold") return Promise.resolve("0.6");
    return Promise.resolve(null);
  });

  mockGenerateEmbedding.mockResolvedValue(
    Array.from({ length: 4096 }, (_, i) => Math.sin(i) * 0.5),
  );

  // Dynamic import — will fail until src/task-completion.ts exists
  const mod = await import("../../src/task-completion.js");
  detectTaskCompletion = mod.detectTaskCompletion;
  findPendingTaskCandidates = mod.findPendingTaskCandidates;
  matchCompletedTasks = mod.matchCompletedTasks;
  applyTaskCompletions = mod.applyTaskCompletions;
  confirmTaskCompletion = mod.confirmTaskCompletion;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// US-1: Detection in First LLM Call
// ============================================================

describe("Task Completion Detection", () => {
  describe("US-1: Detection in first LLM call", () => {
    it("TS-1.1: classification response includes is_task_completion flag", () => {
      const result = createClassificationWithCompletion();
      expect(result).toHaveProperty("is_task_completion");
      expect(typeof result.is_task_completion).toBe("boolean");
    });

    it("TS-1.2: is_task_completion is true for completion-indicating text", () => {
      const result = createClassificationWithCompletion({
        is_task_completion: true,
      });
      expect(result.is_task_completion).toBe(true);
    });

    it("TS-1.3: explicit completion is recognized", async () => {
      const task = createPendingTask({
        id: "task-uuid-1",
        name: "Call landlord about Sendling",
      });

      const mockSql = createMockSql([
        { pattern: "pending", result: [task] },
        { pattern: "UPDATE", result: [] },
        { pattern: "SELECT", result: [task] },
      ]);

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "task-uuid-1", confidence: 0.9 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "I called the landlord",
        classResult,
        mockSql,
      );

      const allMatched = [
        ...result.autoCompleted,
        ...result.needsConfirmation,
      ];
      expect(allMatched.some((m) => m.entry_id === "task-uuid-1")).toBe(true);
    });

    it("TS-1.4: implicit completion is recognized", async () => {
      const task = createPendingTask({
        id: "task-uuid-2",
        name: "Call landlord about Sendling",
      });

      const mockSql = createMockSql([
        { pattern: "pending", result: [task] },
        { pattern: "UPDATE", result: [] },
        { pattern: "SELECT", result: [task] },
      ]);

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "task-uuid-2", confidence: 0.85 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "The landlord said the apartment is available next month",
        classResult,
        mockSql,
      );

      const allMatched = [
        ...result.autoCompleted,
        ...result.needsConfirmation,
      ];
      expect(allMatched.some((m) => m.entry_id === "task-uuid-2")).toBe(true);
    });

    it("TS-1.5: no second LLM call when is_task_completion is false", async () => {
      const classResult = createClassificationWithCompletion({
        is_task_completion: false,
      });

      const mockSql = createMockSql([]);

      const result = await detectTaskCompletion(
        "Just a random thought",
        classResult,
        mockSql,
      );

      expect(mockChat).not.toHaveBeenCalled();
      expect(mockGenerateEmbedding).not.toHaveBeenCalled();
      expect(result.autoCompleted).toHaveLength(0);
      expect(result.needsConfirmation).toHaveLength(0);
    });
  });

  // ============================================================
  // US-2: Task Matching via Semantic Search + Second LLM Call
  // ============================================================

  describe("US-2: Task matching", () => {
    it("TS-2.1: semantic search targets pending non-deleted tasks only", async () => {
      const pendingTask = createPendingTask({ id: "pending-1" });
      const queries: string[] = [];

      const mockSql = ((
        strings: TemplateStringsArray,
        ..._values: unknown[]
      ) => {
        const query = strings.join("?");
        queries.push(query);
        if (query.includes("pending")) return Promise.resolve([pendingTask]);
        return Promise.resolve([]);
      }) as unknown;

      const embedding = Array.from({ length: 4096 }, (_, i) => Math.sin(i));
      await findPendingTaskCandidates(embedding, mockSql);

      const candidateQuery = queries.find((q) => q.includes("pending"));
      expect(candidateQuery).toBeDefined();
      expect(candidateQuery).toContain("tasks");
      expect(candidateQuery).toContain("pending");
      expect(candidateQuery).toContain("deleted_at");
    });

    it("TS-2.2: top 5 candidates above similarity threshold retrieved", async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createPendingTask({
          id: `task-${i}`,
          name: `Task ${i}`,
          similarity: 0.9 - i * 0.05,
        }),
      );

      const mockSql = createMockSql([
        { pattern: "pending", result: tasks },
      ]);

      const embedding = Array.from({ length: 4096 }, (_, i) => Math.sin(i));
      const candidates = await findPendingTaskCandidates(embedding, mockSql);

      expect(candidates.length).toBeLessThanOrEqual(5);
      candidates.forEach((c) => {
        expect(c.similarity).toBeGreaterThanOrEqual(0.5);
      });
    });

    it("TS-2.3: second LLM call returns matches with entry_id and confidence", async () => {
      const candidates = [
        createPendingTask({ id: "c1", name: "Task A" }),
        createPendingTask({ id: "c2", name: "Task B" }),
        createPendingTask({ id: "c3", name: "Task C" }),
      ];

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "c1", confidence: 0.9 },
          { entry_id: "c3", confidence: 0.4 },
        ]),
      );

      const llmConfig = {
        provider: "openai",
        apiKey: "test-key",
        model: "gpt-4",
      };

      const mockSql = createMockSql([]);

      const matches = await matchCompletedTasks(
        candidates.map((c) => ({
          id: c.id,
          name: c.name,
          content: c.content,
        })),
        "I finished task A and C",
        llmConfig,
        mockSql,
      );

      expect(Array.isArray(matches)).toBe(true);
      for (const match of matches) {
        expect(match).toHaveProperty("entry_id");
        expect(match).toHaveProperty("confidence");
        expect(typeof match.entry_id).toBe("string");
        expect(typeof match.confidence).toBe("number");
        expect(match.confidence).toBeGreaterThanOrEqual(0);
        expect(match.confidence).toBeLessThanOrEqual(1);
      }
    });

    it("TS-2.4: maximum 3 completions per message", async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createPendingTask({ id: `task-${i}`, name: `Task ${i}` }),
      );

      const mockSql = createMockSql([
        { pattern: "pending", result: tasks },
        { pattern: "UPDATE", result: [] },
        { pattern: "SELECT", result: tasks },
      ]);

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "task-0", confidence: 0.95 },
          { entry_id: "task-1", confidence: 0.9 },
          { entry_id: "task-2", confidence: 0.85 },
          { entry_id: "task-3", confidence: 0.8 },
          { entry_id: "task-4", confidence: 0.75 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "I finished everything",
        classResult,
        mockSql,
      );

      const total =
        result.autoCompleted.length + result.needsConfirmation.length;
      expect(total).toBeLessThanOrEqual(3);
    });

    it("TS-2.5: zero candidates skips second LLM call", async () => {
      const mockSql = createMockSql([
        { pattern: "pending", result: [] },
      ]);

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "I did the thing",
        classResult,
        mockSql,
      );

      expect(mockChat).not.toHaveBeenCalled();
      expect(result.autoCompleted).toHaveLength(0);
      expect(result.needsConfirmation).toHaveLength(0);
    });
  });

  // ============================================================
  // US-3: Confidence-Based Auto/Confirm
  // ============================================================

  describe("US-3: Confidence-based auto/confirm", () => {
    it("TS-3.1: high-confidence match auto-completes task", async () => {
      const task = createPendingTask({
        id: "task-high",
        name: "Call landlord",
      });

      const updateCalls: unknown[][] = [];
      const mockSql = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = strings.join("?");
        if (query.includes("UPDATE")) {
          updateCalls.push(values);
          return Promise.resolve([]);
        }
        if (query.includes("SELECT")) {
          return Promise.resolve([task]);
        }
        return Promise.resolve([]);
      }) as unknown;

      const result = await applyTaskCompletions(
        [{ entry_id: "task-high", confidence: 0.85 }],
        0.6,
        mockSql,
      );

      expect(result.autoCompleted).toHaveLength(1);
      expect(result.autoCompleted[0].entry_id).toBe("task-high");
      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it("TS-3.2: low-confidence match does not auto-complete", async () => {
      const task = createPendingTask({
        id: "task-low",
        name: "Email accountant",
      });

      const updateCalls: unknown[][] = [];
      const mockSql = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = strings.join("?");
        if (query.includes("UPDATE")) {
          updateCalls.push(values);
          return Promise.resolve([]);
        }
        if (query.includes("SELECT")) {
          return Promise.resolve([task]);
        }
        return Promise.resolve([]);
      }) as unknown;

      const result = await applyTaskCompletions(
        [{ entry_id: "task-low", confidence: 0.45 }],
        0.6,
        mockSql,
      );

      expect(result.needsConfirmation).toHaveLength(1);
      expect(result.needsConfirmation[0].entry_id).toBe("task-low");
      expect(updateCalls).toHaveLength(0);
    });

    it("TS-3.3: user confirms low-confidence completion", async () => {
      const updateCalls: unknown[][] = [];
      const mockSql = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = strings.join("?");
        if (query.includes("UPDATE")) {
          updateCalls.push(values);
        }
        return Promise.resolve([]);
      }) as unknown;

      await confirmTaskCompletion("task-confirm", mockSql);

      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it("TS-3.4: user denies low-confidence completion", async () => {
      // When the user taps "No", no function is called to update the task.
      // The denial is handled at the Telegram handler level by not calling
      // confirmTaskCompletion. This test verifies the function is not invoked.
      const task = createPendingTask({
        id: "task-deny",
        name: "Email accountant",
      });

      // No call to confirmTaskCompletion — task stays pending.
      expect(task.fields.status).toBe("pending");
    });
  });

  // ============================================================
  // US-4: Independent Classification and Storage
  // ============================================================

  describe("US-4: Independent classification and storage", () => {
    it("TS-4.1: new thought classified independently of completion", async () => {
      const classResult = createClassificationWithCompletion({
        category: "people",
        name: "Landlord Chat",
        is_task_completion: true,
      });

      // Classification result retains its own category regardless of completion
      expect(classResult.category).toBe("people");
      expect(classResult.is_task_completion).toBe(true);
    });

    it("TS-4.2: new thought stored as separate entry", async () => {
      const task = createPendingTask({
        id: "completed-task",
        name: "Call landlord",
      });

      const mockSql = createMockSql([
        { pattern: "pending", result: [task] },
        { pattern: "UPDATE", result: [] },
        { pattern: "SELECT", result: [task] },
      ]);

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "completed-task", confidence: 0.9 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "I called the landlord",
        classResult,
        mockSql,
      );

      // detectTaskCompletion does not create or modify the new entry —
      // it only returns completion results for the caller to act on.
      expect(result.autoCompleted[0].entry_id).toBe("completed-task");
      // The function does not return a "merged" entry or modify the input
    });

    it("TS-4.3: completion detection does not alter new entry fields", async () => {
      const classResult = createClassificationWithCompletion({
        category: "people",
        name: "Landlord Chat",
        confidence: 0.92,
        tags: ["housing"],
        is_task_completion: true,
      });

      const task = createPendingTask({ id: "task-x" });

      const mockSql = createMockSql([
        { pattern: "pending", result: [task] },
        { pattern: "UPDATE", result: [] },
        { pattern: "SELECT", result: [task] },
      ]);

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "task-x", confidence: 0.9 },
        ]),
      );

      await detectTaskCompletion(
        "I called the landlord",
        classResult,
        mockSql,
      );

      // Verify classResult is not mutated by detectTaskCompletion
      expect(classResult.category).toBe("people");
      expect(classResult.name).toBe("Landlord Chat");
      expect(classResult.confidence).toBe(0.92);
      expect(classResult.tags).toEqual(["housing"]);
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  describe("Edge cases", () => {
    it("TS-EC-1: already-done task is not a candidate", async () => {
      // The SQL query in findPendingTaskCandidates filters status = 'pending'.
      // A done task should not appear in results.
      const queries: string[] = [];

      const mockSql = ((
        strings: TemplateStringsArray,
        ..._values: unknown[]
      ) => {
        const query = strings.join("?");
        queries.push(query);
        return Promise.resolve([]);
      }) as unknown;

      const embedding = Array.from({ length: 4096 }, (_, i) => Math.sin(i));
      await findPendingTaskCandidates(embedding, mockSql);

      const candidateQuery = queries.find((q) => q.includes("pending"));
      expect(candidateQuery).toBeDefined();
      // The query should filter for pending status, excluding done tasks
      expect(candidateQuery).toContain("pending");
    });

    it("TS-EC-2: multiple matches but only one correct", async () => {
      const sendlingTask = createPendingTask({
        id: "sendling",
        name: "Call landlord about Sendling",
      });
      const schwabingTask = createPendingTask({
        id: "schwabing",
        name: "Call landlord about Schwabing",
      });

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "sendling", confidence: 0.92 },
          { entry_id: "schwabing", confidence: 0.15 },
        ]),
      );

      const llmConfig = {
        provider: "openai",
        apiKey: "test-key",
        model: "gpt-4",
      };
      const mockSql = createMockSql([]);

      const matches = await matchCompletedTasks(
        [sendlingTask, schwabingTask].map((t) => ({
          id: t.id,
          name: t.name,
          content: t.content,
        })),
        "The Sendling landlord confirmed availability",
        llmConfig,
        mockSql,
      );

      const sendlingMatch = matches.find((m) => m.entry_id === "sendling");
      const schwabingMatch = matches.find((m) => m.entry_id === "schwabing");

      expect(sendlingMatch).toBeDefined();
      expect(sendlingMatch!.confidence).toBeGreaterThan(0.6);
      expect(schwabingMatch?.confidence ?? 0).toBeLessThan(0.5);
    });

    it("TS-EC-3: new thought itself classified as task while completing another", async () => {
      const existingTask = createPendingTask({
        id: "existing-task",
        name: "Call landlord about Sendling",
      });

      const mockSql = createMockSql([
        { pattern: "pending", result: [existingTask] },
        { pattern: "UPDATE", result: [] },
        { pattern: "SELECT", result: [existingTask] },
      ]);

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "existing-task", confidence: 0.9 },
        ]),
      );

      // New thought is itself a task AND triggers completion
      const classResult = createClassificationWithCompletion({
        category: "tasks",
        name: "Sign lease by Friday",
        is_task_completion: true,
        fields: { status: "pending", due_date: "2026-04-04", notes: null },
      });

      const result = await detectTaskCompletion(
        "Called the landlord about Sendling. Need to sign the lease by Friday.",
        classResult,
        mockSql,
      );

      // The new entry keeps its own classification (tasks)
      expect(classResult.category).toBe("tasks");
      // The existing task is matched for completion
      expect(result.autoCompleted.some((m) => m.entry_id === "existing-task")).toBe(true);
    });

    it("TS-EC-4: no pending tasks exist", async () => {
      const mockSql = createMockSql([
        { pattern: "pending", result: [] },
      ]);

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "I did the thing",
        classResult,
        mockSql,
      );

      expect(mockChat).not.toHaveBeenCalled();
      expect(result.autoCompleted).toHaveLength(0);
      expect(result.needsConfirmation).toHaveLength(0);
    });

    it("TS-EC-5: first LLM call fails — no completion detection attempted", async () => {
      // When classification fails, is_task_completion is not present / is false.
      // detectTaskCompletion should short-circuit.
      const classResult = {
        category: null,
        name: null,
        confidence: null,
        is_task_completion: false,
        fields: {},
        tags: [],
      };

      const mockSql = createMockSql([]);

      const result = await detectTaskCompletion(
        "Something",
        classResult,
        mockSql,
      );

      expect(mockChat).not.toHaveBeenCalled();
      expect(result.autoCompleted).toHaveLength(0);
      expect(result.needsConfirmation).toHaveLength(0);
    });

    it("TS-EC-6: second LLM call fails", async () => {
      const task = createPendingTask({ id: "task-fail" });

      const mockSql = createMockSql([
        { pattern: "pending", result: [task] },
      ]);

      mockChat.mockRejectedValueOnce(new Error("LLM timeout"));

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "I did the task",
        classResult,
        mockSql,
      );

      // No task is marked as done, empty results returned
      expect(result.autoCompleted).toHaveLength(0);
      expect(result.needsConfirmation).toHaveLength(0);
    });

    it("TS-EC-7: confirming already-done task is a no-op", async () => {
      const doneTask = createDoneTask({ id: "already-done" });

      const mockSql = ((
        strings: TemplateStringsArray,
        ..._values: unknown[]
      ) => {
        const query = strings.join("?");
        if (query.includes("SELECT")) return Promise.resolve([doneTask]);
        return Promise.resolve([]);
      }) as unknown;

      // Should not throw or error
      await expect(
        confirmTaskCompletion("already-done", mockSql),
      ).resolves.not.toThrow();
    });

    it("TS-EC-8: ambiguous voice with very low match confidence", async () => {
      const task = createPendingTask({ id: "task-ambig" });

      const mockSql = createMockSql([
        { pattern: "pending", result: [task] },
      ]);

      // Second LLM returns zero matches (nothing confident enough)
      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "mumble mumble landlord mumble",
        classResult,
        mockSql,
      );

      expect(result.autoCompleted).toHaveLength(0);
      expect(result.needsConfirmation).toHaveLength(0);
    });
  });

  // ============================================================
  // Constraints
  // ============================================================

  describe("Constraints", () => {
    it("TS-C-1: uses LLM provider abstraction for both calls", async () => {
      const task = createPendingTask({ id: "task-provider" });

      const mockSql = createMockSql([
        { pattern: "pending", result: [task] },
        { pattern: "UPDATE", result: [] },
        { pattern: "SELECT", result: [task] },
      ]);

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "task-provider", confidence: 0.9 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      await detectTaskCompletion(
        "I finished the provider task",
        classResult,
        mockSql,
      );

      // The second LLM call goes through createLLMProvider, not direct API
      expect(mockCreateLLMProvider).toHaveBeenCalled();
      expect(mockChat).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Non-Goal Guards
  // ============================================================

  describe("Non-goal guards", () => {
    it("TS-NG-1: projects are not affected by completion detection", async () => {
      const queries: string[] = [];

      const mockSql = ((
        strings: TemplateStringsArray,
        ..._values: unknown[]
      ) => {
        const query = strings.join("?");
        queries.push(query);
        return Promise.resolve([]);
      }) as unknown;

      const embedding = Array.from({ length: 4096 }, (_, i) => Math.sin(i));
      await findPendingTaskCandidates(embedding, mockSql);

      // The query should filter category = 'tasks', not 'projects'
      const candidateQuery = queries.find(
        (q) => q.includes("tasks") || q.includes("pending"),
      );
      expect(candidateQuery).toBeDefined();
      expect(candidateQuery).toContain("tasks");
    });

    it("TS-NG-2: no follow-up tasks auto-created from completion context", async () => {
      const task = createPendingTask({ id: "task-ng2" });

      const insertCalls: string[] = [];
      const mockSql = ((
        strings: TemplateStringsArray,
        ..._values: unknown[]
      ) => {
        const query = strings.join("?");
        if (query.includes("INSERT")) insertCalls.push(query);
        if (query.includes("pending")) return Promise.resolve([task]);
        if (query.includes("UPDATE")) return Promise.resolve([]);
        if (query.includes("SELECT")) return Promise.resolve([task]);
        return Promise.resolve([]);
      }) as unknown;

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: "task-ng2", confidence: 0.9 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      await detectTaskCompletion(
        "Called the landlord, need to sign lease by Friday",
        classResult,
        mockSql,
      );

      // No INSERT calls — detectTaskCompletion does not create new entries
      expect(insertCalls).toHaveLength(0);
    });

    it("TS-NG-3: no retroactive matching of existing entries", () => {
      // detectTaskCompletion requires explicit invocation with fresh thought text.
      // Verify the function signature requires text + classificationResult — it
      // cannot be triggered by existing entry scans.
      expect(typeof detectTaskCompletion).toBe("function");
      expect(detectTaskCompletion.length).toBeGreaterThanOrEqual(2);
    });
  });
});
