/**
 * Integration tests for the system-status feature.
 * Uses testcontainers PostgreSQL for real DB operations.
 * Ollama and Whisper are mocked via fetch spies.
 *
 * Scenarios covered:
 * - Full /health shape with live DB (smoke test)
 * - Sequential calls reflect state transitions (NG-10: no server-side caching)
 * - Indirect coverage of TS-3.6 (per-tab independence — each call is fresh)
 *
 * Phase 4 contract: these tests fail because src/web/service-checkers.ts
 * and the updated /health route do not yet exist.
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
import { Hono } from "hono";
import type postgres from "postgres";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";

describe("System status — integration", () => {
  let db: TestDb;
  let sql: postgres.Sql;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);
    sql = db.sql;
  });

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    // Clear settings between tests so we start from a known empty state.
    await sql`DELETE FROM settings`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockOllamaFetch(models: string[]): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("ollama") && url.includes("/api/tags")) {
        return new Response(
          JSON.stringify({
            models: models.map((name) => ({ name, model: name })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("whisper") && url.includes("/health")) {
        return new Response("{}", { status: 200 });
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`);
    });
  }

  async function buildApp(): Promise<Hono> {
    const { createHealthRoute } = await import("../../src/web/health.js");
    const { createServiceCheckers } = await import(
      "../../src/web/service-checkers.js"
    );
    const startTime = Date.now();
    const checkers = createServiceCheckers({
      sql,
      startTime,
      isBotRunning: () => false,
    });
    const app = new Hono();
    app.route("/", createHealthRoute(checkers));
    return app;
  }

  it("returns the full /health shape with live Postgres", async () => {
    mockOllamaFetch(["qwen3-embedding:latest"]);
    const app = await buildApp();

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      services: Record<string, { ready: boolean; detail: string | null }>;
      uptime: number;
    };

    expect(body.status).toBe("ok");
    expect(body.services.postgres.ready).toBe(true);
    expect(body.services.ollama.ready).toBe(true);
    expect(body.services.whisper.ready).toBe(true);
    // Telegram unconfigured → omitted from services.
    expect("telegram" in body.services).toBe(false);
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("reflects state transitions on sequential calls (no caching)", async () => {
    // First call: ollama models list is empty → ollama not-ready.
    const fetchSpy = mockOllamaFetch([]);
    const app = await buildApp();

    const res1 = await app.request("/health");
    const body1 = (await res1.json()) as {
      services: { ollama: { ready: boolean; detail: string | null } };
    };
    expect(body1.services.ollama.ready).toBe(false);
    expect(body1.services.ollama.detail).toMatch(/qwen3-embedding/i);

    // Second call: models list now contains embedding → ollama ready.
    fetchSpy.mockRestore();
    mockOllamaFetch(["qwen3-embedding:latest"]);

    const res2 = await app.request("/health");
    const body2 = (await res2.json()) as {
      services: { ollama: { ready: boolean; detail: string | null } };
    };
    expect(body2.services.ollama.ready).toBe(true);
    expect(body2.services.ollama.detail).toBeNull();
  });

  it("each /health call runs fresh checks independently (TS-3.6 property)", async () => {
    mockOllamaFetch(["qwen3-embedding:latest"]);
    const app = await buildApp();

    // Multiple rapid calls — each should hit the checkers fresh.
    const responses = await Promise.all([
      app.request("/health"),
      app.request("/health"),
      app.request("/health"),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ok");
    }
  });
});
