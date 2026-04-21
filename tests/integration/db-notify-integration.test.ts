/**
 * Integration tests for PG NOTIFY → SSE broadcaster.
 * Uses testcontainers with real PostgreSQL to verify the full chain:
 * trigger → pg_notify → sql.listen → broadcaster.broadcast
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import postgres from "postgres";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";

describe("DB NOTIFY Integration", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);
  }, 120_000);

  afterEach(async () => {
    await db.sql`DELETE FROM entries`;
  });

  afterAll(async () => {
    await db?.stop();
  });

  it("broadcasts entry:created on INSERT", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    // Use a dedicated connection for listening to avoid cross-test interference
    const listenSql = postgres(db.url);

    try {
      const broadcaster = createSSEBroadcaster();
      const received: unknown[] = [];
      broadcaster.subscribe((event) => received.push(event));

      await listenForEntryChanges(listenSql, broadcaster);

      await db.sql`
        INSERT INTO entries (name, content, source, source_type)
        VALUES ('Test entry', 'Some content', 'telegram', 'text')
      `;

      // NOTIFY is async — wait briefly
      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "entry:created",
        data: expect.objectContaining({
          name: "Test entry",
          category: null,
        }),
      });
    } finally {
      await listenSql.end();
    }
  });

  it("broadcasts entry:updated on UPDATE (category change)", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const listenSql = postgres(db.url);

    try {
      const broadcaster = createSSEBroadcaster();
      const received: unknown[] = [];

      // Insert the row first (before listener is active)
      const rows = await db.sql`
        INSERT INTO entries (name, content, source, source_type)
        VALUES ('Update test', 'Content', 'webapp', 'text')
        RETURNING id
      `;
      const entryId = rows[0].id;

      broadcaster.subscribe((event) => received.push(event));
      await listenForEntryChanges(listenSql, broadcaster);

      // Small delay to ensure the INSERT notification (if any) is drained
      await new Promise((r) => setTimeout(r, 100));

      await db.sql`UPDATE entries SET category = 'tasks', name = 'Updated' WHERE id = ${entryId}`;

      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "entry:updated",
        data: expect.objectContaining({
          id: entryId,
          name: "Updated",
          category: "tasks",
        }),
      });
    } finally {
      await listenSql.end();
    }
  });

  it("broadcasts entry:deleted on soft-delete", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const listenSql = postgres(db.url);

    try {
      const broadcaster = createSSEBroadcaster();
      const received: unknown[] = [];

      // Insert the row first (before listener is active)
      const rows = await db.sql`
        INSERT INTO entries (name, content, source, source_type)
        VALUES ('Delete test', 'Content', 'webapp', 'text')
        RETURNING id
      `;
      const entryId = rows[0].id;

      broadcaster.subscribe((event) => received.push(event));
      await listenForEntryChanges(listenSql, broadcaster);

      // Small delay to ensure the INSERT notification is drained
      await new Promise((r) => setTimeout(r, 100));

      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${entryId}`;

      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "entry:deleted",
        data: { id: entryId },
      });
    } finally {
      await listenSql.end();
    }
  });

  it("skips notification when only embedding changes", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const listenSql = postgres(db.url);

    try {
      const broadcaster = createSSEBroadcaster();
      const received: unknown[] = [];

      // Insert the row first (before listener is active)
      const rows = await db.sql`
        INSERT INTO entries (name, content, source, source_type)
        VALUES ('Embed test', 'Content', 'webapp', 'text')
        RETURNING id
      `;
      const entryId = rows[0].id;

      broadcaster.subscribe((event) => received.push(event));
      await listenForEntryChanges(listenSql, broadcaster);

      // Small delay to ensure the INSERT notification is drained
      await new Promise((r) => setTimeout(r, 100));

      // Simulate embedding update — generate a fake 4096-dim vector
      const fakeVec = `[${Array.from({ length: 4096 }, (_, i) => Math.sin(i) * 0.5).join(",")}]`;
      await db.sql`UPDATE entries SET embedding = ${fakeVec}::vector WHERE id = ${entryId}`;

      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(0);
    } finally {
      await listenSql.end();
    }
  });

  // ─── Entry Visibility — SSE payload ─────────────────────────────

  // TS-6.1
  it("entry:created NOTIFY payload includes visibility", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const listenSql = postgres(db.url);

    try {
      const broadcaster = createSSEBroadcaster();
      const received: unknown[] = [];
      broadcaster.subscribe((event) => received.push(event));
      await listenForEntryChanges(listenSql, broadcaster);

      await db.sql`
        INSERT INTO entries (name, content, source, source_type, visibility)
        VALUES ('Shared entry', 'body', 'telegram', 'text', 'shared')
      `;

      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "entry:created",
        data: expect.objectContaining({
          name: "Shared entry",
          visibility: "shared",
        }),
      });
    } finally {
      await listenSql.end();
    }
  });

  // TS-6.2
  it("entry:updated NOTIFY payload includes visibility", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const listenSql = postgres(db.url);

    try {
      const broadcaster = createSSEBroadcaster();
      const received: unknown[] = [];

      const rows = await db.sql`
        INSERT INTO entries (name, content, source, source_type, visibility)
        VALUES ('Update test', 'body', 'webapp', 'text', 'private')
        RETURNING id
      `;
      const entryId = (rows[0] as { id: string }).id;

      broadcaster.subscribe((event) => received.push(event));
      await listenForEntryChanges(listenSql, broadcaster);

      await new Promise((r) => setTimeout(r, 100));

      // Non-visibility update — should fire entry:updated, payload carries current visibility.
      await db.sql`UPDATE entries SET category = 'tasks' WHERE id = ${entryId}`;

      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "entry:updated",
        data: expect.objectContaining({
          id: entryId,
          visibility: "private",
        }),
      });
    } finally {
      await listenSql.end();
    }
  });

  // TS-6.3
  it("entry:deleted NOTIFY payload carries only id (no visibility)", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const listenSql = postgres(db.url);

    try {
      const broadcaster = createSSEBroadcaster();
      const received: unknown[] = [];

      const rows = await db.sql`
        INSERT INTO entries (name, content, source, source_type, visibility)
        VALUES ('Delete test', 'body', 'webapp', 'text', 'shared')
        RETURNING id
      `;
      const entryId = (rows[0] as { id: string }).id;

      broadcaster.subscribe((event) => received.push(event));
      await listenForEntryChanges(listenSql, broadcaster);

      await new Promise((r) => setTimeout(r, 100));

      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${entryId}`;

      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(1);
      const event = received[0] as {
        type: string;
        data: Record<string, unknown>;
      };
      expect(event.type).toBe("entry:deleted");
      expect(event.data).toEqual({ id: entryId });
      expect("visibility" in event.data).toBe(false);
    } finally {
      await listenSql.end();
    }
  });

  // TS-6.4
  it("visibility-only UPDATE fires an entry:updated event with the new value", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const listenSql = postgres(db.url);

    try {
      const broadcaster = createSSEBroadcaster();
      const received: unknown[] = [];

      const rows = await db.sql`
        INSERT INTO entries (name, content, source, source_type, visibility)
        VALUES ('Viz toggle test', 'body', 'webapp', 'text', 'private')
        RETURNING id
      `;
      const entryId = (rows[0] as { id: string }).id;

      broadcaster.subscribe((event) => received.push(event));
      await listenForEntryChanges(listenSql, broadcaster);

      await new Promise((r) => setTimeout(r, 100));

      await db.sql`UPDATE entries SET visibility = 'shared' WHERE id = ${entryId}`;

      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "entry:updated",
        data: expect.objectContaining({
          id: entryId,
          visibility: "shared",
        }),
      });
    } finally {
      await listenSql.end();
    }
  });
});
