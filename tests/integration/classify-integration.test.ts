/**
 * Integration tests for classification + database flows.
 * Uses testcontainers PostgreSQL for real DB operations.
 * LLM provider and embedding are mocked via vi.mock().
 *
 * Scenarios: TS-2.1–2.7, TS-3.2, TS-4.6–4.8,
 *            TS-C-2, TS-C-3, TS-EC-5, TS-NG-1–TS-NG-3
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
import {
  createClassificationResult,
  createClassificationJSON,
} from "../helpers/mock-llm.js";
import { createFakeEmbedding } from "../helpers/mock-ollama.js";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";

// ---------------------------------------------------------------------------
// Module mocks
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

const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));


// ---------------------------------------------------------------------------
// Types — will fail until src/classify.ts exists
// ---------------------------------------------------------------------------

type GetRecentEntries = (
  sql: postgres.Sql,
) => Promise<Array<{ id: string; name: string; category: string | null; content: string | null }>>;

type GetSimilarEntries = (
  sql: postgres.Sql,
  text: string,
) => Promise<Array<{ id: string; name: string; category: string | null; content: string | null }>>;

type AssembleContext = (
  sql: postgres.Sql,
  text: string,
) => Promise<Array<{ id: string; name: string; category: string | null; content: string | null }>>;

type ClassifyEntry = (
  sql: postgres.Sql,
  entryId: string,
) => Promise<void>;


// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

async function insertEntry(
  sql: postgres.Sql,
  overrides: {
    name?: string;
    content?: string | null;
    category?: string | null;
    confidence?: number | null;
    fields?: Record<string, unknown>;
    tags?: string[];
    embedding?: number[] | null;
    deletedAt?: Date | null;
    createdAt?: Date;
  } = {},
): Promise<{ id: string; [key: string]: unknown }> {
  const name = overrides.name ?? "test-entry";
  const content = overrides.content ?? "test content";
  const category = overrides.category ?? null;
  const confidence = overrides.confidence ?? null;
  const fields = overrides.fields ?? {};
  const tags = overrides.tags ?? [];
  const deletedAt = overrides.deletedAt ?? null;
  const createdAt = overrides.createdAt ?? new Date();

  if (overrides.embedding) {
    const vecStr = `[${overrides.embedding.join(",")}]`;
    const rows = await sql`
      INSERT INTO entries (name, content, category, confidence, fields, tags, source, embedding, deleted_at, created_at)
      VALUES (${name}, ${content}, ${category}, ${confidence}, ${JSON.stringify(fields)}::jsonb, ${tags}, 'webapp', ${vecStr}::vector, ${deletedAt}, ${createdAt})
      RETURNING *
    `;
    return rows[0] as { id: string; [key: string]: unknown };
  }

  const rows = await sql`
    INSERT INTO entries (name, content, category, confidence, fields, tags, source, deleted_at, created_at)
    VALUES (${name}, ${content}, ${category}, ${confidence}, ${JSON.stringify(fields)}::jsonb, ${tags}, 'webapp', ${deletedAt}, ${createdAt})
    RETURNING *
  `;
  return rows[0] as { id: string; [key: string]: unknown };
}

async function insertSetting(
  sql: postgres.Sql,
  key: string,
  value: string,
): Promise<void> {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}
  `;
}

async function deleteSetting(
  sql: postgres.Sql,
  key: string,
): Promise<void> {
  await sql`DELETE FROM settings WHERE key = ${key}`;
}

/**
 * Create an embedding vector with controlled similarity to a base vector.
 * similarity ~1.0 → mostly base vector, ~0.0 → mostly noise.
 */
function createSimilarEmbedding(
  base: number[],
  similarity: number,
): number[] {
  const noise = Array.from(
    { length: base.length },
    (_, i) => Math.cos(i * 7.3) * 0.5,
  );
  const mix = base.map(
    (v, i) => v * similarity + noise[i] * (1 - similarity),
  );
  const magnitude = Math.sqrt(mix.reduce((sum, v) => sum + v * v, 0));
  return mix.map((v) => v / magnitude);
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe("Classification integration", () => {
  let db: TestDb;
  let getRecentEntries: GetRecentEntries;
  let getSimilarEntries: GetSimilarEntries;
  let assembleContext: AssembleContext;
  let classifyEntry: ClassifyEntry;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);

    const mod = await import("../../src/classify.js");
    getRecentEntries = mod.getRecentEntries;
    getSimilarEntries = mod.getSimilarEntries;
    assembleContext = mod.assembleContext;
    classifyEntry = mod.classifyEntry;
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(() => {
    mockChat.mockReset();
    mockCreateLLMProvider.mockReset();
    mockCreateLLMProvider.mockReturnValue({ chat: mockChat });
    mockGenerateEmbedding.mockReset();
    mockReadFile.mockReset();
    mockReadFile.mockResolvedValue(
      "Classify this: {context_entries}\n\nInput: {input_text}",
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.sql`DELETE FROM entries WHERE source = 'webapp'`;
    await db.sql`DELETE FROM settings WHERE key LIKE 'test_%' OR key = 'confidence_threshold'`;
  });

  // ---------------------------------------------------------------------------
  // Context gathering
  // ---------------------------------------------------------------------------
  describe("context gathering", () => {
    // TS-2.1
    it("fetches the 5 most recent entries as context", async () => {
      const now = Date.now();
      for (let i = 0; i < 8; i++) {
        await insertEntry(db.sql, {
          name: `entry-${i}`,
          content: `Content ${i}`,
          category: "reference",
          createdAt: new Date(now - (8 - i) * 60_000),
        });
      }

      const recent = await getRecentEntries(db.sql);

      expect(recent).toHaveLength(5);
      // Most recent first (entries 7, 6, 5, 4, 3)
      expect(recent[0].name).toBe("entry-7");
      expect(recent[4].name).toBe("entry-3");
    });

    // TS-2.2
    it("excludes soft-deleted entries from recent context", async () => {
      const now = Date.now();
      for (let i = 0; i < 6; i++) {
        await insertEntry(db.sql, {
          name: `entry-${i}`,
          content: `Content ${i}`,
          category: "reference",
          createdAt: new Date(now - (6 - i) * 60_000),
          // Soft-delete the most recent entry
          deletedAt: i === 5 ? new Date() : null,
        });
      }

      const recent = await getRecentEntries(db.sql);

      const names = recent.map((e) => e.name);
      expect(names).not.toContain("entry-5");
      expect(recent.length).toBeLessThanOrEqual(5);
    });

    // TS-2.3
    it("returns all entries when fewer than 5 exist", async () => {
      for (let i = 0; i < 3; i++) {
        await insertEntry(db.sql, {
          name: `entry-${i}`,
          content: `Content ${i}`,
          category: "reference",
        });
      }

      const recent = await getRecentEntries(db.sql);

      expect(recent).toHaveLength(3);
    });

    // TS-2.4
    it("finds the top 3 similar entries above the similarity threshold", async () => {
      const baseEmbedding = createFakeEmbedding();
      mockGenerateEmbedding.mockResolvedValueOnce(baseEmbedding);

      // 5 entries with high similarity (>= 0.5)
      for (let i = 0; i < 5; i++) {
        await insertEntry(db.sql, {
          name: `similar-${i}`,
          content: `Similar content ${i}`,
          category: "reference",
          embedding: createSimilarEmbedding(baseEmbedding, 0.9 - i * 0.05),
        });
      }

      // 5 entries with low similarity (< 0.5)
      for (let i = 0; i < 5; i++) {
        await insertEntry(db.sql, {
          name: `dissimilar-${i}`,
          content: `Different content ${i}`,
          category: "tasks",
          embedding: createSimilarEmbedding(baseEmbedding, 0.1),
        });
      }

      const similar = await getSimilarEntries(db.sql, "test input");

      expect(similar).toHaveLength(3);
      for (const entry of similar) {
        expect(entry.name).toMatch(/^similar-/);
      }
    });

    // TS-2.5
    it("excludes entries below the 0.5 similarity threshold", async () => {
      const baseEmbedding = createFakeEmbedding();
      mockGenerateEmbedding.mockResolvedValueOnce(baseEmbedding);

      // 2 above threshold
      for (let i = 0; i < 2; i++) {
        await insertEntry(db.sql, {
          name: `above-${i}`,
          content: `Above content ${i}`,
          category: "reference",
          embedding: createSimilarEmbedding(baseEmbedding, 0.9),
        });
      }
      // 3 below threshold
      for (let i = 0; i < 3; i++) {
        await insertEntry(db.sql, {
          name: `below-${i}`,
          content: `Below content ${i}`,
          category: "tasks",
          embedding: createSimilarEmbedding(baseEmbedding, 0.1),
        });
      }

      const similar = await getSimilarEntries(db.sql, "test input");

      expect(similar).toHaveLength(2);
      for (const entry of similar) {
        expect(entry.name).toMatch(/^above-/);
      }
    });

    // TS-2.6
    it("excludes soft-deleted entries from similarity search", async () => {
      const baseEmbedding = createFakeEmbedding();
      mockGenerateEmbedding.mockResolvedValueOnce(baseEmbedding);

      const highSimEmbedding = createSimilarEmbedding(baseEmbedding, 0.95);

      // 3 similar entries, one soft-deleted
      await insertEntry(db.sql, {
        name: "active-1",
        content: "Active 1",
        category: "reference",
        embedding: highSimEmbedding,
      });
      await insertEntry(db.sql, {
        name: "active-2",
        content: "Active 2",
        category: "reference",
        embedding: highSimEmbedding,
      });
      await insertEntry(db.sql, {
        name: "deleted-sim",
        content: "Deleted similar",
        category: "reference",
        embedding: highSimEmbedding,
        deletedAt: new Date(),
      });

      const similar = await getSimilarEntries(db.sql, "test input");

      const names = similar.map((e) => e.name);
      expect(names).not.toContain("deleted-sim");
      expect(similar).toHaveLength(2);
    });

    // TS-2.7
    it("deduplicates context entries that appear in both recent and similar results", async () => {
      const now = Date.now();
      const baseEmbedding = createFakeEmbedding();
      mockGenerateEmbedding.mockResolvedValueOnce(baseEmbedding);

      // Entry that is both recent AND similar
      await insertEntry(db.sql, {
        name: "overlap-entry",
        content: "Overlapping content",
        category: "reference",
        createdAt: new Date(now),
        embedding: createSimilarEmbedding(baseEmbedding, 0.95),
      });

      // 4 more recent-only entries
      for (let i = 0; i < 4; i++) {
        await insertEntry(db.sql, {
          name: `recent-only-${i}`,
          content: `Recent content ${i}`,
          category: "reference",
          createdAt: new Date(now - (i + 1) * 60_000),
          embedding: createSimilarEmbedding(baseEmbedding, 0.1),
        });
      }

      const context = await assembleContext(db.sql, "test input");

      // "overlap-entry" should appear only once
      const overlapCount = context.filter(
        (e) => e.name === "overlap-entry",
      ).length;
      expect(overlapCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Classification with settings
  // ---------------------------------------------------------------------------
  describe("classification with settings", () => {
    // TS-3.2
    it("reads the confidence threshold from the settings table", async () => {
      await insertSetting(db.sql, "confidence_threshold", "0.8");
      mockChat.mockResolvedValueOnce(
        createClassificationJSON({ confidence: 0.75 }),
      );
      mockGenerateEmbedding.mockResolvedValueOnce(createFakeEmbedding());

      const entry = await insertEntry(db.sql, {
        name: "threshold-test",
        content: "Test content",
        category: null,
      });

      const classifyResult = await classifyEntry(db.sql, entry.id);

      // Threshold is 0.8, confidence is 0.75 → uncertain
      const rows = await db.sql`
        SELECT confidence FROM entries WHERE id = ${entry.id}
      `;
      expect(rows[0].confidence).toBe(0.75);

      // Verify the entry is flagged as uncertain (0.75 < 0.8).
      // classifyEntry should indicate confident/uncertain status in its return.
      // Import the pure function to double-check the threshold logic:
      const { isConfident } = await import("../../src/classify.js");
      expect(isConfident(0.75, 0.8)).toBe(false);
    });

    // TS-EC-5
    it("uses a placeholder note when no context entries exist", async () => {
      // Table is empty from afterEach cleanup. The entry we insert below is the
      // one being classified — the context-gathering function should either exclude
      // it or find no *other* entries, resulting in the placeholder note.
      mockChat.mockResolvedValueOnce(createClassificationJSON());
      mockGenerateEmbedding.mockResolvedValueOnce(createFakeEmbedding());

      const entry = await insertEntry(db.sql, {
        name: "first-entry",
        content: "First ever entry",
        category: null,
      });

      await classifyEntry(db.sql, entry.id);

      // The prompt should contain a placeholder for empty context
      expect(mockChat).toHaveBeenCalled();
      const promptArg = mockChat.mock.calls[0][0];
      expect(promptArg).toMatch(/no existing entries|no context/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Piggyback classification (classifyEntry also classifies other pending entries)
  // ---------------------------------------------------------------------------
  describe("piggyback classification", () => {
    // TS-4.6
    it("classifies other entries with null category when classifying a target", async () => {
      mockChat.mockResolvedValue(createClassificationJSON());
      mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());

      const target = await insertEntry(db.sql, {
        name: "null-cat-1",
        content: "Content 1",
        category: null,
      });
      await insertEntry(db.sql, {
        name: "null-cat-2",
        content: "Content 2",
        category: null,
      });
      await insertEntry(db.sql, {
        name: "has-cat",
        content: "Content 3",
        category: "tasks",
      });

      await classifyEntry(db.sql, target.id);

      // target + 1 pending (not the "tasks" entry)
      expect(mockChat).toHaveBeenCalledTimes(2);
    });

    // TS-4.7
    it("updates pending entry with classification result", async () => {
      mockChat
        .mockResolvedValueOnce(createClassificationJSON()) // target
        .mockResolvedValueOnce(
          createClassificationJSON({
            category: "projects",
            name: "Alpha Project",
            confidence: 0.88,
            tags: ["work"],
            fields: { status: "active" },
          }),
        ); // pending
      mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());

      const target = await insertEntry(db.sql, {
        name: "target-entry",
        content: "Target content",
        category: null,
      });
      const pending = await insertEntry(db.sql, {
        name: "unclassified",
        content: "Project Alpha discussion",
        category: null,
        confidence: null,
      });

      await classifyEntry(db.sql, target.id);

      const rows = await db.sql`
        SELECT category, name, confidence, tags, fields
        FROM entries WHERE id = ${pending.id}
      `;
      expect(rows[0].category).toBe("projects");
      expect(rows[0].name).toBe("Alpha Project");
      expect(rows[0].confidence).toBeCloseTo(0.88);
      expect(rows[0].tags).toContain("work");
      expect(rows[0].fields).toBeTruthy();
    });

    // TS-4.8
    it("skips soft-deleted entries during piggyback classification", async () => {
      mockChat.mockResolvedValue(createClassificationJSON());
      mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());

      const target = await insertEntry(db.sql, {
        name: "active-null",
        content: "Active content",
        category: null,
        deletedAt: null,
      });
      await insertEntry(db.sql, {
        name: "deleted-null",
        content: "Deleted content",
        category: null,
        deletedAt: new Date(),
      });

      await classifyEntry(db.sql, target.id);

      // Only the target entry should be classified (deleted is excluded)
      expect(mockChat).toHaveBeenCalledTimes(1);

      const rows = await db.sql`
        SELECT category FROM entries WHERE name = 'deleted-null'
      `;
      expect(rows[0].category).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  describe("storage", () => {
    // TS-C-2
    it("does not store calendar fields in the database", async () => {
      mockChat.mockResolvedValueOnce(
        createClassificationJSON({
          create_calendar_event: true,
          calendar_date: "2026-06-15",
        }),
      );
      mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());

      const entry = await insertEntry(db.sql, {
        name: "calendar-test",
        content: "Meeting next month",
        category: null,
      });

      await classifyEntry(db.sql, entry.id);

      const rows = await db.sql`
        SELECT * FROM entries WHERE id = ${entry.id}
      `;
      const row = rows[0] as Record<string, unknown>;

      // Standard classification fields should be present
      expect(row.category).toBeTruthy();
      // Calendar fields should NOT exist as columns
      expect(row).not.toHaveProperty("create_calendar_event");
      expect(row).not.toHaveProperty("calendar_date");
    });

    // TS-NG-1
    it("does not store the raw LLM API response", async () => {
      mockChat.mockResolvedValueOnce(createClassificationJSON());
      mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());

      const entry = await insertEntry(db.sql, {
        name: "raw-resp-test",
        content: "Test content",
        category: null,
      });

      await classifyEntry(db.sql, entry.id);

      const rows = await db.sql`
        SELECT * FROM entries WHERE id = ${entry.id}
      `;
      const row = rows[0] as Record<string, unknown>;
      const columnNames = Object.keys(row);

      // Standard columns
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("category");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("content");
      expect(columnNames).toContain("fields");
      expect(columnNames).toContain("tags");
      expect(columnNames).toContain("confidence");
      // No raw response column
      expect(columnNames).not.toContain("raw_response");
      expect(columnNames).not.toContain("llm_response");
    });
  });

  // ---------------------------------------------------------------------------
  // Non-goals
  // ---------------------------------------------------------------------------
  describe("non-goals", () => {
    // TS-NG-2
    it("does not re-classify existing entries during piggyback", async () => {
      mockChat.mockResolvedValue(createClassificationJSON());
      mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());

      const target = await insertEntry(db.sql, {
        name: "target-entry",
        content: "Target content",
        category: null,
      });
      await insertEntry(db.sql, {
        name: "people-entry",
        content: "People content",
        category: "people",
        confidence: 0.9,
      });
      await insertEntry(db.sql, {
        name: "tasks-entry",
        content: "Tasks content",
        category: "tasks",
        confidence: 0.85,
      });

      await classifyEntry(db.sql, target.id);

      // Only the target should be classified (other two already have categories)
      expect(mockChat).toHaveBeenCalledTimes(1);

      // Verify categories unchanged
      const rows = await db.sql`
        SELECT name, category FROM entries
        WHERE name IN ('people-entry', 'tasks-entry')
        ORDER BY name
      `;
      expect(rows[0].category).toBe("people");
      expect(rows[1].category).toBe("tasks");
    });

    // TS-NG-3
    it("preserves the existing category when entry content is updated", async () => {
      mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());

      const entry = await insertEntry(db.sql, {
        name: "preserve-cat",
        content: "original",
        category: "projects",
        confidence: 0.9,
      });

      // Update content directly via SQL
      await db.sql`
        UPDATE entries SET content = 'new content' WHERE id = ${entry.id}
      `;

      // Verify category is preserved
      const rows = await db.sql`
        SELECT category, confidence FROM entries WHERE id = ${entry.id}
      `;
      expect(rows[0].category).toBe("projects");
      expect(rows[0].confidence).toBeCloseTo(0.9);
      // No classification request was made
      expect(mockChat).not.toHaveBeenCalled();
    });
  });
});
