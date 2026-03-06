# SSE via PostgreSQL NOTIFY — Design Document

Status: Approved
Date: 2026-03-06

## Problem

The dashboard spec (AC-5.2) requires "New entries from any source (Telegram, MCP, webapp) appear in real-time." Currently only the webapp capture route calls `broadcaster.broadcast()`. Entries created via Telegram or future MCP appear only on page reload.

## Solution

Replace application-level SSE broadcasting with a PostgreSQL trigger that calls `pg_notify()` on every `entries` table change. The application listens with `sql.listen()` and forwards events to the existing `SSEBroadcaster`.

## Architecture

```
[Any source] -> INSERT/UPDATE entries -> PG trigger -> pg_notify('entries_changed', JSON)
                                                              |
                                                       sql.listen('entries_changed')
                                                              |
                                                       SSEBroadcaster.broadcast()
                                                              |
                                                       EventSource clients (dashboard)
```

Zero coupling: no module needs to import or know about the broadcaster. Anything that touches the `entries` table triggers SSE automatically.

## PG Trigger

A single function `notify_entry_change()` fires `AFTER INSERT OR UPDATE` on `entries`:

- **INSERT**: Sends `entry:created` with `{id, name, category, confidence}`
- **UPDATE where `deleted_at` changes NULL -> non-NULL**: Sends `entry:deleted` with `{id}`
- **UPDATE (other)**: Sends `entry:updated` with `{id, name, category, confidence}`
- **Skip**: Updates that only change `embedding` or `updated_at` (avoids noisy events during embedding generation)

No DELETE trigger needed — the project uses soft-delete exclusively.

The JSON payload matches the existing `SSEEvent` interface: `{type, data}`.

## Application Listener

In `src/index.ts`, after creating DB connection and broadcaster:

```typescript
sql.listen('entries_changed', (payload) => {
  const event = JSON.parse(payload);
  broadcaster.broadcast(event);
});
```

The manual `broadcaster.broadcast()` call in the dashboard capture route is removed — the PG trigger handles it.

The `digest:updated` event remains application-level (not an entries table operation).

## Migration

Add trigger function and trigger to `runMigrations()` in `src/db/index.ts`. Uses `CREATE OR REPLACE FUNCTION` for idempotency.

## Testing

- **Unit test**: Mock `sql.listen`, verify listener parses payload and calls `broadcaster.broadcast()` with correct shape
- **Integration test**: INSERT/UPDATE/soft-delete entries via SQL, verify SSE events received with correct types and data
- **Existing tests**: 31 dashboard tests unchanged — TS-5.2/5.3/5.4 test SSE transport via manual `broadcaster.broadcast()`, which still works. Integration tests that use the capture API route get the broadcast from the trigger instead of application code — same observable result.

## Scope

- Adds: PG trigger function, PG trigger, `sql.listen` wiring in index.ts
- Removes: Manual `broadcaster.broadcast()` in dashboard capture route
- Keeps: `digest:updated` broadcast in application code, `SSEBroadcaster` interface unchanged, client-side EventSource handlers unchanged
