/**
 * Integration tests for task completion detection.
 * Uses testcontainers PostgreSQL + pgvector for real DB operations.
 * Mocks: LLM provider (no real LLM), embed (controlled vectors).
 *
 * Scenarios: TS-6.1–6.4, TS-7.1
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import type postgres from "postgres";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";
import { createFakeEmbedding } from "../helpers/mock-ollama.js";
import {
  createClassificationWithCompletion,
  createTaskMatchResponse,
} from "../helpers/mock-tasks.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { mockChat } = vi.hoisted(() => ({
  mockChat: vi.fn(),
}));

vi.mock("../../src/llm/index.js", () => ({
  createLLMProvider: vi.fn().mockReturnValue({ chat: mockChat }),
}));

vi.mock("../../src/llm/config.js", () => ({
  getLLMConfig: vi.fn().mockResolvedValue({
    provider: "openai",
    apiKeys: { openai: "test-key" },
    model: "gpt-4",
    baseUrl: "",
  }),
}));

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(createFakeEmbedding()),
  embedEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/config.js", () => ({
  config: {},
  resolveConfigValue: vi.fn().mockImplementation((key: string) => {
    if (key === "confidence_threshold") return Promise.resolve("0.6");
    return Promise.resolve(null);
  }),
}));

// Mock classify to return controlled classification results
const mockClassifyText = vi.fn();

vi.mock("../../src/classify.js", () => ({
  classifyText: (...args: unknown[]) => mockClassifyText(...args),
  assembleContext: vi.fn().mockResolvedValue([]),
  classifyEntry: vi.fn().mockResolvedValue(undefined),
}));

// Import mocked modules so we can re-setup after clearAllMocks
import { createLLMProvider } from "../../src/llm/index.js";
import { getLLMConfig } from "../../src/llm/config.js";
import { generateEmbedding, embedEntry } from "../../src/embed.js";
import { resolveConfigValue } from "../../src/config.js";

// ---------------------------------------------------------------------------
// Embedding Factories
// ---------------------------------------------------------------------------

function createQueryEmbedding(): number[] {
  const vec = new Array(1024).fill(0);
  vec[0] = 1;
  return vec;
}

function createSimilarEmbedding(): number[] {
  const vec = new Array(1024).fill(0);
  vec[0] = 0.8;
  vec[1] = 0.6;
  return vec;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedPendingTask(
  sql: postgres.Sql,
  overrides: {
    id?: string;
    name?: string;
    content?: string;
    embedding?: number[];
  } = {},
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  const name = overrides.name ?? "Call landlord about Sendling";
  const content =
    overrides.content ?? "Call landlord about the Sendling apartment";
  const embedding = overrides.embedding ?? createFakeEmbedding();
  const embeddingLiteral = `[${embedding.join(",")}]`;
  const fields = {
    status: "pending",
    due_date: null,
    notes: null,
  };

  await sql`
    INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                         source, source_type, embedding, created_at, updated_at)
    VALUES (${id}, ${name}, 'tasks', ${content},
            ${sql.json(fields)}, ${sql.array([] as string[])}, ${0.9},
            'telegram', 'text',
            ${embeddingLiteral}::vector(4096),
            NOW(), NOW())
  `;

  return id;
}

async function getEntryStatus(
  sql: postgres.Sql,
  entryId: string,
): Promise<string | null> {
  const rows = await sql`
    SELECT fields->>'status' as status FROM entries WHERE id = ${entryId}
  `;
  if (rows.length === 0) return null;
  return (rows[0] as { status: string | null }).status;
}

// ---------------------------------------------------------------------------
// Imports — will fail until src/task-completion.ts exists
// ---------------------------------------------------------------------------

let detectTaskCompletion: (
  text: string,
  classificationResult: Record<string, unknown>,
  sql: postgres.Sql,
) => Promise<{
  autoCompleted: Array<{ entry_id: string; name: string; confidence: number }>;
  needsConfirmation: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
}>;

let confirmTaskCompletion: (
  entryId: string,
  sql: postgres.Sql,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Task Completion Detection Integration", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);

    const mod = await import("../../src/task-completion.js");
    detectTaskCompletion = mod.detectTaskCompletion;
    confirmTaskCompletion = mod.confirmTaskCompletion;
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-setup mock implementations cleared by clearAllMocks
    (createLLMProvider as any).mockReturnValue({ chat: mockChat });
    (getLLMConfig as any).mockResolvedValue({
      provider: "openai",
      apiKeys: { openai: "test-key" },
      model: "gpt-4",
      baseUrl: "",
    });
    (generateEmbedding as any).mockResolvedValue(createFakeEmbedding());
    (embedEntry as any).mockResolvedValue(undefined);
    (resolveConfigValue as any).mockImplementation((key: string) => {
      if (key === "confidence_threshold") return Promise.resolve("0.6");
      return Promise.resolve(null);
    });

    await db.sql`DELETE FROM entries`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // US-6: Cross-Source Support
  // ============================================================

  describe("US-6: Cross-source support", () => {
    it("TS-6.1: completion detection works for Telegram text", async () => {
      const taskId = await seedPendingTask(db.sql, {
        name: "Call landlord about Sendling",
      });

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: taskId, confidence: 0.9 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "I called the landlord",
        classResult,
        db.sql,
      );

      expect(result.autoCompleted.length).toBeGreaterThan(0);
      expect(result.autoCompleted[0].entry_id).toBe(taskId);

      const status = await getEntryStatus(db.sql, taskId);
      expect(status).toBe("done");
    });

    it("TS-6.2: completion detection works for Telegram voice", async () => {
      const taskId = await seedPendingTask(db.sql, {
        name: "Email the accountant",
      });

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: taskId, confidence: 0.85 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      // Voice messages are transcribed before reaching detectTaskCompletion.
      // The function receives the transcribed text — same interface as text.
      const result = await detectTaskCompletion(
        "I emailed the accountant about the tax returns",
        classResult,
        db.sql,
      );

      expect(result.autoCompleted.length).toBeGreaterThan(0);

      const status = await getEntryStatus(db.sql, taskId);
      expect(status).toBe("done");
    });

    it("TS-6.3: completion detection works for webapp capture", async () => {
      const taskId = await seedPendingTask(db.sql, {
        name: "Buy groceries",
      });

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: taskId, confidence: 0.8 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "Got all the groceries from the list",
        classResult,
        db.sql,
      );

      expect(result.autoCompleted.length).toBeGreaterThan(0);

      const status = await getEntryStatus(db.sql, taskId);
      expect(status).toBe("done");
    });

    it("TS-6.4: completion detection works for MCP add_thought", async () => {
      const taskId = await seedPendingTask(db.sql, {
        name: "Review pull request",
      });

      mockChat.mockResolvedValueOnce(
        createTaskMatchResponse([
          { entry_id: taskId, confidence: 0.88 },
        ]),
      );

      const classResult = createClassificationWithCompletion({
        is_task_completion: true,
      });

      const result = await detectTaskCompletion(
        "Reviewed and approved the pull request",
        classResult,
        db.sql,
      );

      // MCP response should include completed tasks info
      expect(result.autoCompleted.length).toBeGreaterThan(0);
      expect(result.autoCompleted[0].entry_id).toBe(taskId);
      expect(result.autoCompleted[0].name).toBeDefined();

      const status = await getEntryStatus(db.sql, taskId);
      expect(status).toBe("done");
    });
  });

  // US-7 (/fix undo) was removed — undo is handled via webapp UI.
});
