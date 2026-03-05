import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

type ServiceCheckers = {
  checkPostgres: () => Promise<"connected" | "disconnected">;
  checkOllama: () => Promise<"connected" | "disconnected">;
  checkWhisper: () => Promise<"connected" | "disconnected">;
  checkTelegram: () => Promise<"polling" | "stopped">;
  getUptime: () => number;
};

function createAllConnectedCheckers(): ServiceCheckers {
  return {
    checkPostgres: vi.fn().mockResolvedValue("connected"),
    checkOllama: vi.fn().mockResolvedValue("connected"),
    checkWhisper: vi.fn().mockResolvedValue("connected"),
    checkTelegram: vi.fn().mockResolvedValue("polling"),
    getUptime: vi.fn().mockReturnValue(42),
  };
}

describe("Health endpoint", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns JSON with status, postgres, ollama, whisper, telegram, and uptime", async () => {
    const { createHealthRoute } = await import("../../src/web/health.js");
    const checkers = createAllConnectedCheckers();

    const app = new Hono();
    app.route("/", createHealthRoute(checkers));

    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("postgres");
    expect(body).toHaveProperty("ollama");
    expect(body).toHaveProperty("whisper");
    expect(body).toHaveProperty("telegram");
    expect(body).toHaveProperty("uptime");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(body.uptime)).toBe(true);
  });

  it("reports 'ok' when all services are connected", async () => {
    const { createHealthRoute } = await import("../../src/web/health.js");
    const checkers = createAllConnectedCheckers();

    const app = new Hono();
    app.route("/", createHealthRoute(checkers));

    const res = await app.request("/health");
    const body = await res.json();

    expect(body.status).toBe("ok");
    expect(body.postgres).toBe("connected");
    expect(body.ollama).toBe("connected");
    expect(body.whisper).toBe("connected");
    expect(body.telegram).toBe("polling");
  });

  it("is accessible without authentication", async () => {
    const { createHealthRoute } = await import("../../src/web/health.js");
    const { createAuthMiddleware } = await import("../../src/web/auth.js");
    const checkers = createAllConnectedCheckers();

    const app = new Hono();
    app.use("*", createAuthMiddleware("test-secret-at-least-32-chars-long!!"));
    app.route("/", createHealthRoute(checkers));

    // Request with no auth header or cookie
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("status");
  });

  it("reports 'degraded' when PostgreSQL is unreachable", async () => {
    const { createHealthRoute } = await import("../../src/web/health.js");
    const checkers = createAllConnectedCheckers();
    checkers.checkPostgres = vi.fn().mockResolvedValue("disconnected");

    const app = new Hono();
    app.route("/", createHealthRoute(checkers));

    const res = await app.request("/health");
    const body = await res.json();

    expect(body.status).toBe("degraded");
    expect(body.postgres).toBe("disconnected");
  });

  it("reports 'ok' when Ollama is unreachable but Postgres is connected", async () => {
    const { createHealthRoute } = await import("../../src/web/health.js");
    const checkers = createAllConnectedCheckers();
    checkers.checkOllama = vi.fn().mockResolvedValue("disconnected");

    const app = new Hono();
    app.route("/", createHealthRoute(checkers));

    const res = await app.request("/health");
    const body = await res.json();

    expect(body.status).toBe("ok");
    expect(body.ollama).toBe("disconnected");
  });

  it("reports disconnected services without error", async () => {
    const { createHealthRoute } = await import("../../src/web/health.js");
    const checkers: ServiceCheckers = {
      checkPostgres: vi.fn().mockResolvedValue("connected"),
      checkOllama: vi.fn().mockResolvedValue("disconnected"),
      checkWhisper: vi.fn().mockResolvedValue("disconnected"),
      checkTelegram: vi.fn().mockResolvedValue("stopped"),
      getUptime: vi.fn().mockReturnValue(100),
    };

    const app = new Hono();
    app.route("/", createHealthRoute(checkers));

    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.ollama).toBe("disconnected");
    expect(body.whisper).toBe("disconnected");
  });
});
