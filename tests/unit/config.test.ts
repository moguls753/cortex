import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clearAllConfigEnvVars,
  setRequiredEnvVars,
  withEnv,
} from "../helpers/env.js";

describe("Configuration", () => {
  let restoreEnv: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    clearAllConfigEnvVars();
    setRequiredEnvVars();
  });

  afterEach(() => {
    restoreEnv?.();
    restoreEnv = undefined;
  });

  it("fails startup when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;

    try {
      await import("../../src/config.js");
      expect.unreachable("Expected config import to throw");
    } catch (error) {
      expect((error as Error).message).toContain("DATABASE_URL");
    }
  });

  it("fails startup naming all missing required variables", async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.SESSION_SECRET;

    try {
      await import("../../src/config.js");
      expect.unreachable("Expected config import to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("LLM_API_KEY");
      expect(message).toContain("SESSION_SECRET");
    }
  });

  it("loads successfully when all required env vars are present", async () => {
    const mod = await import("../../src/config.js");
    expect(mod.config).toBeDefined();
  });

  it("uses documented defaults for optional variables", async () => {
    // Ensure all optional vars are cleared (clearAllConfigEnvVars already handles this)
    delete process.env.PORT;
    delete process.env.OLLAMA_MODEL;
    delete process.env.TZ;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
    delete process.env.DAILY_DIGEST_CRON;
    delete process.env.WEEKLY_DIGEST_CRON;

    const { config } = await import("../../src/config.js");

    expect(config.port).toBe(3000);
    expect(config.ollamaModel).toBe("snowflake-arctic-embed2");
    expect(config.timezone).toBe("Europe/Berlin");
    expect(config.llmProvider).toBe("anthropic");
    expect(config.llmModel).toBe("claude-sonnet-4-20250514");
    expect(config.dailyDigestCron).toBe("30 7 * * *");
    expect(config.weeklyDigestCron).toBe("0 16 * * 0");
  });

  it("uses provided values for optional variables", async () => {
    restoreEnv = withEnv({
      PORT: "4000",
      LLM_PROVIDER: "openai-compatible",
      LLM_MODEL: "gpt-4o",
      LLM_BASE_URL: "http://localhost:1234/v1",
    });

    const { config } = await import("../../src/config.js");

    expect(config.port).toBe(4000);
    expect(config.llmProvider).toBe("openai-compatible");
    expect(config.llmModel).toBe("gpt-4o");
    expect(config.llmBaseUrl).toBe("http://localhost:1234/v1");
  });

  it("exports a typed config object with all expected properties", async () => {
    const { config } = await import("../../src/config.js");

    const expectedProperties = [
      "databaseUrl",
      "llmProvider",
      "llmApiKey",
      "llmModel",
      "llmBaseUrl",
      "telegramBotToken",
      "webappPassword",
      "sessionSecret",
      "port",
      "ollamaModel",
      "timezone",
      "dailyDigestCron",
      "weeklyDigestCron",
    ];

    for (const prop of expectedProperties) {
      expect(config).toHaveProperty(prop);
      expect((config as Record<string, unknown>)[prop]).not.toBeUndefined();
    }
  });

  it("fails startup with clear error for malformed DATABASE_URL", async () => {
    restoreEnv = withEnv({
      DATABASE_URL: "not-a-valid-url",
    });

    try {
      await import("../../src/config.js");
      expect.unreachable("Expected config import to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toMatch(/malformed|invalid|format/i);
    }
  });
});
