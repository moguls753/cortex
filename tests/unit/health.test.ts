/**
 * Unit tests for the system-status feature — /health endpoint + service checkers.
 *
 * Scenarios: TS-4.1, TS-4.2, TS-5.1–5.10, TS-6.1–6.3, TS-7.1–7.3,
 *            TS-8.1–8.10, TS-10.6
 *
 * Phase 4 contract: every test in this file MUST fail until Phase 5 lands
 * `src/web/service-checkers.ts` and updates `src/web/health.ts` to the new
 * response shape defined in system-status-specification.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createMockSql, createFailingMockSql } from "../helpers/mock-sql.js";

// ─── Types under test ──────────────────────────────────────────────

type ServiceStatus = { ready: boolean; detail: string | null };

type HealthServices = {
  postgres: ServiceStatus;
  ollama: ServiceStatus;
  whisper: ServiceStatus;
  telegram?: ServiceStatus;
};

type HealthResponse = {
  status: "ok" | "degraded";
  services: HealthServices;
  uptime: number;
};

// ─── ServiceCheckers factory for endpoint tests ────────────────────

type ServiceCheckers = {
  checkPostgres: () => Promise<ServiceStatus>;
  checkOllama: () => Promise<ServiceStatus>;
  checkWhisper: () => Promise<ServiceStatus>;
  /** Returns null to signal omission from the response. */
  checkTelegram: () => Promise<ServiceStatus | null>;
  getUptime: () => number;
};

const ready: ServiceStatus = { ready: true, detail: null };
const notReady = (detail: string): ServiceStatus => ({ ready: false, detail });

function createAllReadyCheckers(overrides: Partial<ServiceCheckers> = {}): ServiceCheckers {
  return {
    checkPostgres: vi.fn().mockResolvedValue(ready),
    checkOllama: vi.fn().mockResolvedValue(ready),
    checkWhisper: vi.fn().mockResolvedValue(ready),
    checkTelegram: vi.fn().mockResolvedValue(ready),
    getUptime: vi.fn().mockReturnValue(42),
    ...overrides,
  };
}

// ─── Test suite ────────────────────────────────────────────────────

describe("System status — service checkers and /health endpoint", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 4: PostgreSQL checker
  // ─────────────────────────────────────────────────────────────────

  describe("Group 4 — Postgres checker", () => {
    it("TS-4.1 — postgres ready when SELECT 1 succeeds", async () => {
      const { checkPostgres } = await import(
        "../../src/web/service-checkers.js"
      );
      const sql = createMockSql({
        onQuery: async () => [{ "?column?": 1 }],
      });
      const result = await checkPostgres(sql as never);
      expect(result).toEqual({ ready: true, detail: null });
    });

    it("TS-4.2 — postgres not-ready when SELECT 1 throws", async () => {
      const { checkPostgres } = await import(
        "../../src/web/service-checkers.js"
      );
      const sql = createFailingMockSql(new Error("connection refused"));
      const result = await checkPostgres(sql as never);
      expect(result).toEqual({ ready: false, detail: "Database unreachable" });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 5: Ollama checker
  // ─────────────────────────────────────────────────────────────────

  describe("Group 5 — Ollama checker", () => {
    function mockTagsResponse(models: string[]): Response {
      return new Response(
        JSON.stringify({
          models: models.map((name) => ({ name, model: name })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    it("TS-5.1 — ready when tags include qwen3-embedding (no LLM check)", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockTagsResponse(["qwen3-embedding:latest"]),
      );
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "",
        llmModel: "",
      });
      expect(result).toEqual({ ready: true, detail: null });
    });

    it("TS-5.2 — not-ready when models list is empty", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockTagsResponse([]));
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "",
        llmModel: "",
      });
      expect(result).toEqual({
        ready: false,
        detail: "Downloading embedding model (qwen3-embedding)",
      });
    });

    it("TS-5.3 — not-ready when /api/tags unreachable", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("ECONNREFUSED"),
      );
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "",
        llmModel: "",
      });
      expect(result).toEqual({
        ready: false,
        detail: "Ollama unreachable",
      });
    });

    it("TS-5.4 — ready with exact model name match", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockTagsResponse(["qwen3-embedding"]),
      );
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "",
        llmModel: "",
      });
      expect(result.ready).toBe(true);
    });

    it("TS-5.5 — ready when both embedding and classification models present", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockTagsResponse(["qwen3-embedding:latest", "llama3.1:8b"]),
      );
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "http://ollama:11434/v1",
        llmModel: "llama3.1:8b",
      });
      expect(result).toEqual({ ready: true, detail: null });
    });

    it("TS-5.6 — not-ready when classification model is missing", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockTagsResponse(["qwen3-embedding:latest"]),
      );
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "http://ollama:11434/v1",
        llmModel: "llama3.1:8b",
      });
      expect(result).toEqual({
        ready: false,
        detail: "Downloading classification model (llama3.1:8b)",
      });
    });

    it("TS-5.7 — embedding-missing detail takes precedence over classification-missing", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockTagsResponse([]));
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "http://ollama:11434/v1",
        llmModel: "llama3.1:8b",
      });
      expect(result).toEqual({
        ready: false,
        detail: "Downloading embedding model (qwen3-embedding)",
      });
    });

    it("TS-5.8 — Anthropic provider skips classification check (empty llm_base_url)", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockTagsResponse(["qwen3-embedding:latest"]),
      );
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "",
        llmModel: "claude-sonnet-4-5",
      });
      expect(result).toEqual({ ready: true, detail: null });
    });

    it("TS-5.9 — non-Ollama OpenAI base URL skips classification check", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockTagsResponse(["qwen3-embedding:latest"]),
      );
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "https://api.openai.com/v1",
        llmModel: "gpt-4o-mini",
      });
      expect(result).toEqual({ ready: true, detail: null });
    });

    it("TS-5.10 — empty llm_model skips classification check", async () => {
      const { checkOllama } = await import("../../src/web/service-checkers.js");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockTagsResponse(["qwen3-embedding:latest"]),
      );
      const result = await checkOllama({
        ollamaUrl: "http://ollama:11434",
        llmBaseUrl: "http://ollama:11434/v1",
        llmModel: "",
      });
      expect(result).toEqual({ ready: true, detail: null });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 6: Whisper checker
  // ─────────────────────────────────────────────────────────────────

  describe("Group 6 — Whisper checker", () => {
    it("TS-6.1 — ready when /health returns 200", async () => {
      const { checkWhisper } = await import(
        "../../src/web/service-checkers.js"
      );
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 200 }),
      );
      const result = await checkWhisper("http://whisper:8000");
      expect(result).toEqual({ ready: true, detail: null });
    });

    it("TS-6.2 — not-ready on ECONNREFUSED", async () => {
      const { checkWhisper } = await import(
        "../../src/web/service-checkers.js"
      );
      const err = new Error("ECONNREFUSED") as Error & { code?: string };
      err.code = "ECONNREFUSED";
      vi.spyOn(globalThis, "fetch").mockRejectedValue(err);
      const result = await checkWhisper("http://whisper:8000");
      expect(result).toEqual({
        ready: false,
        detail: "Loading Whisper model — first boot can take several minutes",
      });
    });

    it("TS-6.3 — not-ready on HTTP 500", async () => {
      const { checkWhisper } = await import(
        "../../src/web/service-checkers.js"
      );
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("err", { status: 500 }),
      );
      const result = await checkWhisper("http://whisper:8000");
      expect(result).toEqual({
        ready: false,
        detail: "Whisper unreachable",
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 7: Telegram checker
  // ─────────────────────────────────────────────────────────────────

  describe("Group 7 — Telegram checker", () => {
    it("TS-7.1 — returns null when token empty (key absent from response)", async () => {
      const { checkTelegram } = await import(
        "../../src/web/service-checkers.js"
      );
      const result = await checkTelegram({
        telegramBotToken: "",
        isBotRunning: () => false,
      });
      expect(result).toBeNull();
    });

    it("TS-7.2 — ready when bot is polling", async () => {
      const { checkTelegram } = await import(
        "../../src/web/service-checkers.js"
      );
      const result = await checkTelegram({
        telegramBotToken: "123:abc",
        isBotRunning: () => true,
      });
      expect(result).toEqual({ ready: true, detail: null });
    });

    it("TS-7.3 — not-ready when bot stopped but token present", async () => {
      const { checkTelegram } = await import(
        "../../src/web/service-checkers.js"
      );
      const result = await checkTelegram({
        telegramBotToken: "123:abc",
        isBotRunning: () => false,
      });
      expect(result).toEqual({
        ready: false,
        detail: "Telegram bot stopped or crashed",
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 8: /health endpoint contract
  // ─────────────────────────────────────────────────────────────────

  describe("Group 8 — /health endpoint", () => {
    async function request(checkers: ServiceCheckers): Promise<HealthResponse> {
      const { createHealthRoute } = await import("../../src/web/health.js");
      const app = new Hono();
      app.route("/", createHealthRoute(checkers));
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      return (await res.json()) as HealthResponse;
    }

    it("TS-8.1 — response has status, services, uptime top-level keys and no others", async () => {
      const body = await request(createAllReadyCheckers());
      expect(Object.keys(body).sort()).toEqual(
        ["services", "status", "uptime"].sort(),
      );
    });

    it("TS-8.2 — services values match ServiceStatus shape", async () => {
      const body = await request(createAllReadyCheckers());
      for (const [, value] of Object.entries(body.services)) {
        expect(Object.keys(value as object).sort()).toEqual(
          ["detail", "ready"].sort(),
        );
        expect(typeof (value as ServiceStatus).ready).toBe("boolean");
        const detail = (value as ServiceStatus).detail;
        expect(detail === null || typeof detail === "string").toBe(true);
      }
    });

    it("TS-8.3 — ready field is strictly boolean, never a string literal", async () => {
      const body = await request(
        createAllReadyCheckers({
          checkWhisper: vi.fn().mockResolvedValue(notReady("Loading")),
        }),
      );
      expect(typeof body.services.whisper.ready).toBe("boolean");
      expect(body.services.whisper.ready).toBe(false);
    });

    it("TS-8.4 — status is ok when all services ready", async () => {
      const body = await request(createAllReadyCheckers());
      expect(body.status).toBe("ok");
      expect(body.services).toBeDefined();
      expect(body.services.postgres.ready).toBe(true);
    });

    it("TS-8.5 — status is degraded when Postgres not ready", async () => {
      const body = await request(
        createAllReadyCheckers({
          checkPostgres: vi.fn().mockResolvedValue(notReady("Database unreachable")),
        }),
      );
      expect(body.status).toBe("degraded");
      expect(body.services.postgres.ready).toBe(false);
    });

    it("TS-8.6 — status is ok when only non-Postgres services are not ready", async () => {
      const body = await request(
        createAllReadyCheckers({
          checkOllama: vi.fn().mockResolvedValue(notReady("Downloading embedding model (qwen3-embedding)")),
          checkWhisper: vi.fn().mockResolvedValue(notReady("Loading Whisper model — first boot can take several minutes")),
        }),
      );
      expect(body.status).toBe("ok");
      expect(body.services.postgres.ready).toBe(true);
      expect(body.services.ollama.ready).toBe(false);
      expect(body.services.whisper.ready).toBe(false);
    });

    it("TS-8.7 — accessible without authentication", async () => {
      const { createHealthRoute } = await import("../../src/web/health.js");
      const { createAuthMiddleware } = await import("../../src/web/auth.js");
      const app = new Hono();
      app.use("*", createAuthMiddleware("test-secret-at-least-32-chars-long!!"));
      app.route("/", createHealthRoute(createAllReadyCheckers()));
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthResponse;
      // Validate the new shape so this test fails until Phase 5 lands.
      expect(body.services).toBeDefined();
      expect(body.services.postgres).toMatchObject({ ready: true, detail: null });
    });

    it("TS-8.8 — a single slow check does not exceed ~3s total", async () => {
      const { createHealthRoute } = await import("../../src/web/health.js");
      // Build checkers where checkWhisper "hangs" forever (but the route
      // handler must impose its own timeout per AC-4.5).
      const checkers = createAllReadyCheckers({
        checkWhisper: vi.fn(
          () =>
            new Promise<ServiceStatus>(() => {
              /* never resolves */
            }),
        ),
      });
      const app = new Hono();
      app.route("/", createHealthRoute(checkers));

      const started = Date.now();
      const res = await app.request("/health");
      const elapsed = Date.now() - started;

      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(3500);
      const body = (await res.json()) as HealthResponse;
      expect(body.services.whisper.ready).toBe(false);
      expect(body.services.whisper.detail).toMatch(/time(d )?out|timeout/i);
    });

    it("TS-8.9 — checks run in parallel not sequentially", async () => {
      const { createHealthRoute } = await import("../../src/web/health.js");
      const delay = (ms: number) =>
        new Promise<ServiceStatus>((r) =>
          setTimeout(() => r(ready), ms),
        );

      // Each checker takes ~500ms. Sequential = ~2000ms. Parallel = ~500ms.
      const checkers: ServiceCheckers = {
        checkPostgres: () => delay(500),
        checkOllama: () => delay(500),
        checkWhisper: () => delay(500),
        checkTelegram: () => delay(500),
        getUptime: () => 1,
      };
      const app = new Hono();
      app.route("/", createHealthRoute(checkers));

      const started = Date.now();
      const res = await app.request("/health");
      const elapsed = Date.now() - started;

      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(1500);
      // Validate the new shape so this test fails until Phase 5 lands.
      const body = (await res.json()) as HealthResponse;
      expect(body.services).toBeDefined();
      expect(body.services.ollama).toMatchObject({ ready: true });
    });

    it("TS-8.10 — uptime is a non-negative integer", async () => {
      const body = await request(createAllReadyCheckers());
      expect(Number.isInteger(body.uptime)).toBe(true);
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      // Paired with the shape contract so it fails until Phase 5 lands.
      expect(body.services).toBeDefined();
    });

    it("TS-10.6 — response has no legacy string literals", async () => {
      const body = await request(
        createAllReadyCheckers({
          checkWhisper: vi.fn().mockResolvedValue(notReady("Loading Whisper model — first boot can take several minutes")),
          checkTelegram: vi.fn().mockResolvedValue(null),
        }),
      );
      // Contract: response must use the new nested services shape.
      expect(body.services).toBeDefined();
      expect("telegram" in body.services).toBe(false);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/\bconnected\b/);
      expect(serialized).not.toMatch(/\bdisconnected\b/);
      expect(serialized).not.toMatch(/"polling"/);
      expect(serialized).not.toMatch(/"stopped"/);
    });

    it("TS-7.1 (endpoint side) — telegram key omitted when checker returns null", async () => {
      const body = await request(
        createAllReadyCheckers({
          checkTelegram: vi.fn().mockResolvedValue(null),
        }),
      );
      expect("telegram" in body.services).toBe(false);
    });
  });
});
