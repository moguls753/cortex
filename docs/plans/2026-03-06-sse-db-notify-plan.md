# SSE via PostgreSQL NOTIFY — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace application-level SSE broadcasting with a PostgreSQL trigger so entries from any source (Telegram, webapp, MCP) trigger live dashboard updates automatically.

**Architecture:** A PG trigger on the `entries` table calls `pg_notify('entries_changed', JSON)` on INSERT and UPDATE. The app listens with `sql.listen()` and forwards events to the existing `SSEBroadcaster`. The manual `broadcaster.broadcast()` in the dashboard capture route is removed.

**Tech Stack:** PostgreSQL triggers/NOTIFY, `postgres` library's `sql.listen()`, existing SSEBroadcaster

---

### Task 1: Add PG trigger function and trigger to migrations

**Files:**
- Modify: `src/db/index.ts:41-59` (add after existing trigger definitions)

**Step 1: Add the trigger function and trigger to `runMigrations()`**

Add this SQL after the existing `settings_updated_at` trigger block (after line 59, before the closing backtick):

```sql
CREATE OR REPLACE FUNCTION notify_entry_change()
RETURNS TRIGGER AS $$
DECLARE
  event_type TEXT;
  payload JSONB;
BEGIN
  -- Determine event type
  IF TG_OP = 'INSERT' THEN
    event_type := 'entry:created';
  ELSIF NEW.deleted_at IS NOT NULL AND (OLD.deleted_at IS NULL) THEN
    event_type := 'entry:deleted';
  ELSE
    -- Skip if only embedding or updated_at changed
    IF NEW.name = OLD.name
       AND NEW.category IS NOT DISTINCT FROM OLD.category
       AND NEW.confidence IS NOT DISTINCT FROM OLD.confidence
       AND NEW.fields = OLD.fields
       AND NEW.tags = OLD.tags
       AND NEW.content IS NOT DISTINCT FROM OLD.content
       AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
      RETURN NEW;
    END IF;
    event_type := 'entry:updated';
  END IF;

  -- Build payload
  IF event_type = 'entry:deleted' THEN
    payload := jsonb_build_object('type', event_type, 'data', jsonb_build_object('id', NEW.id));
  ELSE
    payload := jsonb_build_object(
      'type', event_type,
      'data', jsonb_build_object(
        'id', NEW.id,
        'name', NEW.name,
        'category', NEW.category,
        'confidence', NEW.confidence
      )
    );
  END IF;

  PERFORM pg_notify('entries_changed', payload::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entries_notify ON entries;
CREATE TRIGGER entries_notify
  AFTER INSERT OR UPDATE ON entries
  FOR EACH ROW
  EXECUTE FUNCTION notify_entry_change();
```

**Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 2: Add listener helper function

**Files:**
- Create: `src/db/notify.ts`

**Step 1: Write the failing test**

Create `tests/unit/db-notify.test.ts`:

```typescript
/**
 * Unit tests for DB NOTIFY → SSE broadcaster wiring.
 * Mocks sql.listen to verify event parsing and broadcasting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("listenForEntryChanges", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls sql.listen on 'entries_changed' channel", async () => {
    const mockListen = vi.fn().mockResolvedValue({ unlisten: vi.fn() });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    expect(mockListen).toHaveBeenCalledWith(
      "entries_changed",
      expect.any(Function),
    );
  });

  it("broadcasts parsed entry:created event", async () => {
    let capturedCallback: (payload: string) => void = () => {};
    const mockListen = vi.fn().mockImplementation((_channel, cb) => {
      capturedCallback = cb;
      return Promise.resolve({ unlisten: vi.fn() });
    });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    capturedCallback(JSON.stringify({
      type: "entry:created",
      data: { id: "abc-123", name: "Test", category: "tasks", confidence: 0.9 },
    }));

    expect(mockBroadcaster.broadcast).toHaveBeenCalledWith({
      type: "entry:created",
      data: { id: "abc-123", name: "Test", category: "tasks", confidence: 0.9 },
    });
  });

  it("broadcasts parsed entry:updated event", async () => {
    let capturedCallback: (payload: string) => void = () => {};
    const mockListen = vi.fn().mockImplementation((_channel, cb) => {
      capturedCallback = cb;
      return Promise.resolve({ unlisten: vi.fn() });
    });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    capturedCallback(JSON.stringify({
      type: "entry:updated",
      data: { id: "abc-123", name: "Updated", category: "ideas", confidence: 0.8 },
    }));

    expect(mockBroadcaster.broadcast).toHaveBeenCalledWith({
      type: "entry:updated",
      data: { id: "abc-123", name: "Updated", category: "ideas", confidence: 0.8 },
    });
  });

  it("broadcasts parsed entry:deleted event", async () => {
    let capturedCallback: (payload: string) => void = () => {};
    const mockListen = vi.fn().mockImplementation((_channel, cb) => {
      capturedCallback = cb;
      return Promise.resolve({ unlisten: vi.fn() });
    });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    capturedCallback(JSON.stringify({
      type: "entry:deleted",
      data: { id: "abc-123" },
    }));

    expect(mockBroadcaster.broadcast).toHaveBeenCalledWith({
      type: "entry:deleted",
      data: { id: "abc-123" },
    });
  });

  it("does not broadcast on invalid JSON payload", async () => {
    let capturedCallback: (payload: string) => void = () => {};
    const mockListen = vi.fn().mockImplementation((_channel, cb) => {
      capturedCallback = cb;
      return Promise.resolve({ unlisten: vi.fn() });
    });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    capturedCallback("not-json");

    expect(mockBroadcaster.broadcast).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/db-notify.test.ts`
Expected: FAIL — `src/db/notify.ts` does not exist

**Step 3: Write implementation**

Create `src/db/notify.ts`:

```typescript
import type postgres from "postgres";
import type { SSEBroadcaster, SSEEvent } from "../web/sse.js";
import { createLogger } from "../logger.js";

const log = createLogger("notify");

export async function listenForEntryChanges(
  sql: postgres.Sql,
  broadcaster: SSEBroadcaster,
): Promise<void> {
  await sql.listen("entries_changed", (payload) => {
    try {
      const event = JSON.parse(payload) as SSEEvent;
      broadcaster.broadcast(event);
    } catch {
      log.error("Failed to parse entry change notification", { payload });
    }
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/db-notify.test.ts`
Expected: 5 tests PASS

---

### Task 3: Wire listener in index.ts and remove manual broadcast from dashboard

**Files:**
- Modify: `src/index.ts:12,35` (add import, add listen call)
- Modify: `src/web/dashboard.ts:556-559` (remove manual broadcast)

**Step 1: Add import and listener call to `src/index.ts`**

Add import after line 12:
```typescript
import { listenForEntryChanges } from "./db/notify.js";
```

Add listener call after the `const broadcaster = createSSEBroadcaster();` line (after line 35):
```typescript
  // Listen for DB entry changes and broadcast via SSE
  listenForEntryChanges(sql, broadcaster).catch((err) => {
    log.warn("Failed to start entry change listener", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
```

**Step 2: Remove manual broadcast from dashboard capture route**

In `src/web/dashboard.ts`, delete lines 556-559:
```typescript
    broadcaster.broadcast({
      type: "entry:created",
      data: { id: entryId, name: name ?? "Untitled", category, confidence },
    });
```

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Run all unit tests**

Run: `npx vitest run tests/unit/`
Expected: All pass (new db-notify tests + existing tests unchanged)

---

### Task 4: Integration test — PG trigger fires NOTIFY on entry changes

**Files:**
- Create: `tests/integration/db-notify-integration.test.ts`

**Step 1: Write integration tests**

```typescript
/**
 * Integration tests for PG NOTIFY → SSE broadcaster.
 * Uses testcontainers with real PostgreSQL to verify the full chain:
 * trigger → pg_notify → sql.listen → broadcaster.broadcast
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import postgres from "postgres";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

describe("DB NOTIFY Integration", () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;

  beforeAll(async () => {
    container = await new GenericContainer("pgvector/pgvector:pg16")
      .withEnvironment({
        POSTGRES_DB: "cortex_test",
        POSTGRES_USER: "cortex",
        POSTGRES_PASSWORD: "test",
      })
      .withExposedPorts(5432)
      .start();

    const port = container.getMappedPort(5432);
    const url = `postgresql://cortex:test@localhost:${port}/cortex_test`;

    // Run migrations to create tables and triggers
    const { runMigrations } = await import("../../src/db/index.js");
    await runMigrations(url);

    sql = postgres(url);
  }, 60_000);

  afterEach(async () => {
    await sql`DELETE FROM entries`;
  });

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  it("broadcasts entry:created on INSERT", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const broadcaster = createSSEBroadcaster();
    const received: unknown[] = [];
    broadcaster.subscribe((event) => received.push(event));

    await listenForEntryChanges(sql, broadcaster);

    await sql`
      INSERT INTO entries (name, content, source, source_type)
      VALUES ('Test entry', 'Some content', 'telegram', 'text')
    `;

    // NOTIFY is async — wait briefly
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "entry:created",
      data: expect.objectContaining({
        name: "Test entry",
        category: null,
      }),
    });

    await sql.unlisten("entries_changed");
  });

  it("broadcasts entry:updated on UPDATE (category change)", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const broadcaster = createSSEBroadcaster();
    const received: unknown[] = [];
    broadcaster.subscribe((event) => received.push(event));

    const rows = await sql`
      INSERT INTO entries (name, content, source, source_type)
      VALUES ('Update test', 'Content', 'webapp', 'text')
      RETURNING id
    `;
    const entryId = rows[0].id;

    await listenForEntryChanges(sql, broadcaster);

    await sql`UPDATE entries SET category = 'tasks', name = 'Updated' WHERE id = ${entryId}`;

    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "entry:updated",
      data: expect.objectContaining({
        id: entryId,
        name: "Updated",
        category: "tasks",
      }),
    });

    await sql.unlisten("entries_changed");
  });

  it("broadcasts entry:deleted on soft-delete", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const broadcaster = createSSEBroadcaster();
    const received: unknown[] = [];
    broadcaster.subscribe((event) => received.push(event));

    const rows = await sql`
      INSERT INTO entries (name, content, source, source_type)
      VALUES ('Delete test', 'Content', 'webapp', 'text')
      RETURNING id
    `;
    const entryId = rows[0].id;

    await listenForEntryChanges(sql, broadcaster);

    await sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${entryId}`;

    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "entry:deleted",
      data: { id: entryId },
    });

    await sql.unlisten("entries_changed");
  });

  it("skips notification when only embedding changes", async () => {
    const { createSSEBroadcaster } = await import("../../src/web/sse.js");
    const { listenForEntryChanges } = await import("../../src/db/notify.js");

    const broadcaster = createSSEBroadcaster();
    const received: unknown[] = [];
    broadcaster.subscribe((event) => received.push(event));

    const rows = await sql`
      INSERT INTO entries (name, content, source, source_type)
      VALUES ('Embed test', 'Content', 'webapp', 'text')
      RETURNING id
    `;
    const entryId = rows[0].id;

    await listenForEntryChanges(sql, broadcaster);

    // Simulate embedding update — generate a fake 1024-dim vector
    const fakeVec = `[${Array.from({ length: 1024 }, (_, i) => Math.sin(i) * 0.5).join(",")}]`;
    await sql`UPDATE entries SET embedding = ${fakeVec}::vector WHERE id = ${entryId}`;

    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(0);

    await sql.unlisten("entries_changed");
  });
});
```

**Step 2: Run integration tests**

Run: `npx vitest run tests/integration/db-notify-integration.test.ts`
Expected: 4 tests PASS

---

### Task 5: Verify all existing tests still pass

**Step 1: Run full unit test suite**

Run: `npx vitest run tests/unit/`
Expected: All pass (existing 207 passing + 17 expected web-new-note failures + 5 new db-notify tests)

**Step 2: Run full integration test suite**

Run: `npx vitest run tests/integration/`
Expected: All pass (existing tests + 4 new db-notify tests)

---
