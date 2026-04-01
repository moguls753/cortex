/**
 * Integration tests for embedding + database flows.
 * Uses testcontainers PostgreSQL for real DB operations.
 * Ollama is mocked via globalThis.fetch.
 *
 * Scenarios: TS-3.1–3.4, TS-C-2, TS-EC-3, TS-EC-6,
 *            TS-EC-8, TS-NG-1, TS-NG-2
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
  createFakeEmbedding,
  createEmbedResponse,
  createErrorResponse,
} from "../helpers/mock-ollama.js";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";

// Types for the embed module
type EmbedEntry = (sql: postgres.Sql, entryId: string) => Promise<void>;

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

async function insertEntry(
  sql: postgres.Sql,
  overrides: {
    name?: string;
    content?: string | null;
    embedding?: number[] | null;
    createdAt?: Date;
  } = {},
): Promise<{ id: string; name: string; content: string | null }> {
  const name = overrides.name ?? "test-entry";
  const content = overrides.content ?? null;
  const createdAt = overrides.createdAt ?? new Date();

  if (overrides.embedding) {
    const vecStr = `[${overrides.embedding.join(",")}]`;
    const rows = await sql`
      INSERT INTO entries (name, content, source, embedding, created_at)
      VALUES (${name}, ${content}, 'webapp', ${vecStr}::vector, ${createdAt})
      RETURNING id, name, content
    `;
    return rows[0] as { id: string; name: string; content: string | null };
  }

  const rows = await sql`
    INSERT INTO entries (name, content, source, created_at)
    VALUES (${name}, ${content}, 'webapp', ${createdAt})
    RETURNING id, name, content
  `;
  return rows[0] as { id: string; name: string; content: string | null };
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe("Embedding integration", () => {
  let db: TestDb;
  let embedEntry: EmbedEntry;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);

    const mod = await import("../../src/embed.js");
    embedEntry = mod.embedEntry;
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Clean up test entries
    await db.sql`DELETE FROM entries WHERE source = 'webapp'`;
    await db.sql`DELETE FROM settings WHERE key LIKE 'test_%' OR key = 'ollama_url'`;
  });

  // ---------------------------------------------------------------------------
  // Entry embedding
  // ---------------------------------------------------------------------------
  describe("Entry embedding", () => {
    // TS-3.1
    it("stores entry with null embedding when Ollama is unavailable", async () => {
      fetchSpy.mockRejectedValue(new TypeError("fetch failed"));

      const entry = await insertEntry(db.sql, {
        name: "Test",
        content: "Some content",
      });

      await embedEntry(db.sql, entry.id);

      const rows = await db.sql`
        SELECT embedding IS NULL as is_null
        FROM entries WHERE id = ${entry.id}
      `;
      expect(rows[0].is_null).toBe(true);
    });

    // TS-EC-3
    it("handles model deletion by logging error and storing null embedding", async () => {
      fetchSpy.mockResolvedValue(
        createErrorResponse(500, "model 'qwen3-embedding' not found"),
      );
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      const entry = await insertEntry(db.sql, {
        name: "Test",
        content: "Some content",
      });

      await embedEntry(db.sql, entry.id);

      const logOutput = stdoutSpy.mock.calls
        .map(([chunk]) => chunk.toString())
        .join("");
      expect(logOutput).toContain('"level":"error"');

      const rows = await db.sql`
        SELECT embedding IS NULL as is_null
        FROM entries WHERE id = ${entry.id}
      `;
      expect(rows[0].is_null).toBe(true);
    });

    // TS-NG-2
    it("makes separate embedding requests for identical text", async () => {
      fetchSpy.mockResolvedValue(createEmbedResponse());

      const entry1 = await insertEntry(db.sql, {
        name: "Same",
        content: "Identical content",
      });
      const entry2 = await insertEntry(db.sql, {
        name: "Same",
        content: "Identical content",
      });

      await embedEntry(db.sql, entry1.id);
      await embedEntry(db.sql, entry2.id);

      const embedCalls = fetchSpy.mock.calls.filter(([url]) =>
        url.toString().includes("/api/embed"),
      );
      expect(embedCalls.length).toBe(2);

      const rows = await db.sql`
        SELECT id, embedding IS NOT NULL as has_embedding
        FROM entries WHERE id IN (${entry1.id}, ${entry2.id})
      `;
      expect(rows.every((r: { has_embedding: boolean }) => r.has_embedding)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Piggyback embedding (embedEntry also embeds other pending entries)
  // ---------------------------------------------------------------------------
  describe("Piggyback embedding", () => {
    // TS-3.2
    it("embeds other entries with null embeddings when embedding a target", async () => {
      fetchSpy.mockResolvedValue(createEmbedResponse());

      const entry1 = await insertEntry(db.sql, {
        name: "target-entry",
        content: "Content 1",
      });
      await insertEntry(db.sql, {
        name: "pending-entry",
        content: "Content 2",
      });
      await insertEntry(db.sql, {
        name: "has-embed",
        content: "Content 3",
        embedding: createFakeEmbedding(),
      });

      await embedEntry(db.sql, entry1.id);

      const embedCalls = fetchSpy.mock.calls.filter(([url]) =>
        url.toString().includes("/api/embed"),
      );
      // target + 1 pending (not the one that already has embedding)
      expect(embedCalls.length).toBe(2);
    });

    // TS-3.3
    it("generates and stores embedding for pending entries", async () => {
      fetchSpy.mockResolvedValue(createEmbedResponse());

      const target = await insertEntry(db.sql, {
        name: "target",
        content: "Target content",
      });
      const pending = await insertEntry(db.sql, {
        name: "pending",
        content: "Pending content",
      });

      await embedEntry(db.sql, target.id);

      const rows = await db.sql`
        SELECT embedding IS NOT NULL as has_embedding,
               vector_dims(embedding) as dim
        FROM entries WHERE id = ${pending.id}
      `;
      expect(rows[0].has_embedding).toBe(true);
      expect(rows[0].dim).toBe(4096);
    });

    // TS-3.4
    it("silently skips pending entries that fail to embed", async () => {
      let callCount = 0;
      fetchSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(createEmbedResponse());
        return Promise.resolve(createErrorResponse(500, "internal error"));
      });

      const target = await insertEntry(db.sql, {
        name: "target",
        content: "Target content",
      });
      const failing = await insertEntry(db.sql, {
        name: "will-fail",
        content: "Content",
      });

      await embedEntry(db.sql, target.id);

      const rows = await db.sql`
        SELECT embedding IS NULL as is_null
        FROM entries WHERE id = ${failing.id}
      `;
      expect(rows[0].is_null).toBe(true);
    });

    // TS-EC-6
    it("processes pending entries in created_at order", async () => {
      fetchSpy.mockResolvedValue(createEmbedResponse());

      const now = Date.now();
      const entryA = await insertEntry(db.sql, {
        name: "entry-a",
        content: "Content A",
        createdAt: new Date(now - 180_000),
      });
      await insertEntry(db.sql, {
        name: "entry-b",
        content: "Content B",
        createdAt: new Date(now - 120_000),
      });
      await insertEntry(db.sql, {
        name: "entry-c",
        content: "Content C",
        createdAt: new Date(now - 60_000),
      });

      await embedEntry(db.sql, entryA.id);

      const embedCalls = fetchSpy.mock.calls.filter(([url]) =>
        url.toString().includes("/api/embed"),
      );
      // entry-a (target) + entry-b + entry-c (pending, ordered by created_at)
      expect(embedCalls.length).toBe(3);

      const texts = embedCalls.map(([, options]) => {
        const body = JSON.parse((options as RequestInit).body as string);
        return body.input as string;
      });
      expect(texts[0]).toContain("entry-a");
      expect(texts[1]).toContain("entry-b");
      expect(texts[2]).toContain("entry-c");
    });
  });

  // ---------------------------------------------------------------------------
  // Re-embedding
  // ---------------------------------------------------------------------------
  describe("Re-embedding", () => {
    // TS-NG-1
    it("regenerates embedding when entry content is updated", async () => {
      const originalEmbedding = createFakeEmbedding();
      const newEmbedding = Array.from({ length: 4096 }, (_, i) =>
        Math.cos(i) * 0.5,
      );

      // Insert entry with original embedding
      const entry = await insertEntry(db.sql, {
        name: "re-embed-test",
        content: "Original content",
        embedding: originalEmbedding,
      });

      // Update entry content
      await db.sql`
        UPDATE entries SET content = 'Updated content' WHERE id = ${entry.id}
      `;

      // Mock fetch to return new embedding
      fetchSpy.mockResolvedValueOnce(createEmbedResponse(newEmbedding));

      // Re-embed the entry
      await embedEntry(db.sql, entry.id);

      // Verify the embedding changed
      const rows = await db.sql`
        SELECT embedding IS NOT NULL as has_embedding
        FROM entries WHERE id = ${entry.id}
      `;
      expect(rows[0].has_embedding).toBe(true);

      // Verify fetch was called with the new content
      const embedCalls = fetchSpy.mock.calls.filter(([url]) =>
        url.toString().includes("/api/embed"),
      );
      expect(embedCalls.length).toBe(1);
      const body = JSON.parse(
        (embedCalls[0][1] as RequestInit).body as string,
      );
      expect(body.input).toContain("Updated content");
    });
  });
});
