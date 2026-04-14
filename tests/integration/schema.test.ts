/**
 * Integration tests for database schema (entries + settings tables).
 * Tests TS-3.1 through TS-3.6.
 *
 * Requires a running pgvector container via testcontainers.
 * All tests will fail until src/db/ is implemented.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
  await runMigrations(db.url);
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("Schema — entries table (TS-3.1)", () => {
  it("creates entries table with all columns and constraints", async () => {
    // Query column information
    const columns = await db.sql`
      SELECT column_name, data_type, is_nullable, udt_name
      FROM information_schema.columns
      WHERE table_name = 'entries'
      ORDER BY ordinal_position
    `;

    const colMap = new Map(
      columns.map((c: { column_name: string }) => [c.column_name, c]),
    );

    // Verify all 13 columns exist
    expect(colMap.size).toBeGreaterThanOrEqual(13);

    // id — uuid
    expect(colMap.get("id")).toBeDefined();
    expect(colMap.get("id")!.udt_name).toBe("uuid");

    // category — text, nullable
    expect(colMap.get("category")).toBeDefined();
    expect(colMap.get("category")!.data_type).toBe("text");
    expect(colMap.get("category")!.is_nullable).toBe("YES");

    // name — text, not null
    expect(colMap.get("name")).toBeDefined();
    expect(colMap.get("name")!.data_type).toBe("text");
    expect(colMap.get("name")!.is_nullable).toBe("NO");

    // content — text
    expect(colMap.get("content")).toBeDefined();
    expect(colMap.get("content")!.data_type).toBe("text");

    // fields — jsonb
    expect(colMap.get("fields")).toBeDefined();
    expect(colMap.get("fields")!.udt_name).toBe("jsonb");

    // tags — ARRAY (text[])
    expect(colMap.get("tags")).toBeDefined();
    expect(colMap.get("tags")!.data_type).toBe("ARRAY");

    // confidence — real
    expect(colMap.get("confidence")).toBeDefined();
    expect(colMap.get("confidence")!.udt_name).toBe("float4");

    // source — text, not null
    expect(colMap.get("source")).toBeDefined();
    expect(colMap.get("source")!.data_type).toBe("text");
    expect(colMap.get("source")!.is_nullable).toBe("NO");

    // source_type — text
    expect(colMap.get("source_type")).toBeDefined();
    expect(colMap.get("source_type")!.data_type).toBe("text");

    // embedding — USER-DEFINED (vector)
    expect(colMap.get("embedding")).toBeDefined();
    expect(colMap.get("embedding")!.data_type).toBe("USER-DEFINED");

    // deleted_at — timestamptz
    expect(colMap.get("deleted_at")).toBeDefined();
    expect(colMap.get("deleted_at")!.udt_name).toBe("timestamptz");

    // created_at — timestamptz
    expect(colMap.get("created_at")).toBeDefined();
    expect(colMap.get("created_at")!.udt_name).toBe("timestamptz");

    // updated_at — timestamptz
    expect(colMap.get("updated_at")).toBeDefined();
    expect(colMap.get("updated_at")!.udt_name).toBe("timestamptz");

    // Verify CHECK constraints
    const checks = await db.sql`
      SELECT constraint_name, check_clause
      FROM information_schema.check_constraints
      WHERE constraint_schema = 'public'
    `;

    const checkClauses = checks.map(
      (c: { check_clause: string }) => c.check_clause,
    );
    const allChecks = checkClauses.join(" ");

    // category allows: 'people', 'projects', 'tasks', 'ideas', 'reference'
    expect(allChecks).toContain("people");
    expect(allChecks).toContain("projects");
    expect(allChecks).toContain("tasks");
    expect(allChecks).toContain("ideas");
    expect(allChecks).toContain("reference");

    // source allows: 'telegram', 'webapp', 'mcp'
    expect(allChecks).toContain("telegram");
    expect(allChecks).toContain("webapp");
    expect(allChecks).toContain("mcp");

    // source_type allows: 'text', 'voice'
    expect(allChecks).toContain("text");
    expect(allChecks).toContain("voice");
  });
});

describe("Schema — settings table (TS-3.2)", () => {
  it("creates settings table with correct schema", async () => {
    const columns = await db.sql`
      SELECT column_name, data_type, is_nullable, udt_name
      FROM information_schema.columns
      WHERE table_name = 'settings'
      ORDER BY ordinal_position
    `;

    const colMap = new Map(
      columns.map((c: { column_name: string }) => [c.column_name, c]),
    );

    // key — text
    expect(colMap.get("key")).toBeDefined();
    expect(colMap.get("key")!.data_type).toBe("text");

    // value — text, not null
    expect(colMap.get("value")).toBeDefined();
    expect(colMap.get("value")!.data_type).toBe("text");
    expect(colMap.get("value")!.is_nullable).toBe("NO");

    // updated_at — timestamptz
    expect(colMap.get("updated_at")).toBeDefined();
    expect(colMap.get("updated_at")!.udt_name).toBe("timestamptz");

    // Verify primary key on 'key'
    const pkConstraints = await db.sql`
      SELECT tc.constraint_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = 'settings'
        AND tc.constraint_type = 'PRIMARY KEY'
    `;

    expect(pkConstraints.length).toBeGreaterThanOrEqual(1);
    expect(pkConstraints[0].column_name).toBe("key");
  });
});

describe("Schema — indexes (TS-3.3)", () => {
  it("creates category, created_at, and GIN tags indexes", async () => {
    const indexes = await db.sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'entries'
    `;

    const indexDefs = indexes.map(
      (i: { indexdef: string }) => i.indexdef.toLowerCase(),
    );

    // HNSW index is intentionally not created: pgvector HNSW does not support
    // vectors with more than 2000 dimensions, and qwen3-embedding is 4096-dim.
    const hnswIndex = indexDefs.find(
      (d: string) => d.includes("hnsw") && d.includes("vector_cosine_ops"),
    );
    expect(hnswIndex).toBeUndefined();

    // Index on category
    const categoryIndex = indexDefs.find((d: string) => d.includes("category"));
    expect(categoryIndex).toBeDefined();

    // Index on created_at
    const createdAtIndex = indexDefs.find(
      (d: string) => d.includes("created_at"),
    );
    expect(createdAtIndex).toBeDefined();

    // GIN index on tags
    const ginIndex = indexDefs.find(
      (d: string) => d.includes("gin") && d.includes("tags"),
    );
    expect(ginIndex).toBeDefined();
  });
});

describe("Schema — updated_at triggers", () => {
  afterEach(async () => {
    // Clean up test rows
    await db.sql`DELETE FROM entries WHERE name LIKE 'trigger-test-%'`;
    await db.sql`DELETE FROM settings WHERE key LIKE 'test_trigger%'`;
  });

  it("auto-updates updated_at on entries row update (TS-3.4)", async () => {
    // INSERT in its own statement (auto-commit = own transaction)
    const inserted = await db.sql`
      INSERT INTO entries (id, name, source)
      VALUES (gen_random_uuid(), 'trigger-test-entry', 'telegram')
      RETURNING id, updated_at
    `;
    const originalUpdatedAt = new Date(inserted[0].updated_at);
    const entryId = inserted[0].id;

    // UPDATE in a separate statement (separate transaction)
    await db.sql`
      UPDATE entries SET name = 'trigger-test-entry-modified'
      WHERE id = ${entryId}
    `;

    // SELECT the new updated_at
    const updated = await db.sql`
      SELECT updated_at FROM entries WHERE id = ${entryId}
    `;
    const newUpdatedAt = new Date(updated[0].updated_at);

    expect(newUpdatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  it("auto-updates updated_at on settings row update (TS-3.5)", async () => {
    // INSERT in its own statement
    const inserted = await db.sql`
      INSERT INTO settings (key, value)
      VALUES ('test_trigger', 'original')
      RETURNING updated_at
    `;
    const originalUpdatedAt = new Date(inserted[0].updated_at);

    // UPDATE in a separate statement
    await db.sql`
      UPDATE settings SET value = 'changed'
      WHERE key = 'test_trigger'
    `;

    // SELECT the new updated_at
    const updated = await db.sql`
      SELECT updated_at FROM settings WHERE key = 'test_trigger'
    `;
    const newUpdatedAt = new Date(updated[0].updated_at);

    expect(newUpdatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });
});

describe("Schema — null category (TS-3.6)", () => {
  afterEach(async () => {
    await db.sql`DELETE FROM entries WHERE name = 'null-category-test'`;
  });

  it("accepts entry with null category", async () => {
    const inserted = await db.sql`
      INSERT INTO entries (id, category, name, source)
      VALUES (gen_random_uuid(), NULL, 'null-category-test', 'webapp')
      RETURNING id, category
    `;

    expect(inserted.length).toBe(1);
    expect(inserted[0].category).toBeNull();

    // Also verify via SELECT
    const selected = await db.sql`
      SELECT category FROM entries WHERE id = ${inserted[0].id}
    `;
    expect(selected[0].category).toBeNull();
  });
});
