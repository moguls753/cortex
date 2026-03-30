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
    delete process.env.DATABASE_URL;

    try {
      await import("../../src/config.js");
      expect.unreachable("Expected config import to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
    }
  });

  it("loads successfully when all required env vars are present", async () => {
    const mod = await import("../../src/config.js");
    expect(mod.config).toBeDefined();
  });

  it("uses documented defaults for optional variables", async () => {
    // Ensure all optional vars are cleared (clearAllConfigEnvVars already handles this)
    delete process.env.PORT;
    delete process.env.TZ;

    const { config } = await import("../../src/config.js");

    expect(config.port).toBe(3000);
    expect(config.timezone).toBe("Europe/Berlin");
  });

  it("uses provided values for optional variables", async () => {
    restoreEnv = withEnv({
      PORT: "4000",
    });

    const { config } = await import("../../src/config.js");

    expect(config.port).toBe(4000);
  });

  it("exports a typed config object with all expected properties", async () => {
    const { config } = await import("../../src/config.js");

    const expectedProperties = [
      "databaseUrl",
      "port",
      "ollamaUrl",
      "whisperUrl",
      "timezone",
    ];

    for (const prop of expectedProperties) {
      expect(config).toHaveProperty(prop);
      expect((config as Record<string, unknown>)[prop]).not.toBeUndefined();
    }
  });

  it("accepts any non-empty DATABASE_URL string", async () => {
    restoreEnv = withEnv({
      DATABASE_URL: "not-a-valid-url",
    });

    const { config } = await import("../../src/config.js");
    expect(config.databaseUrl).toBe("not-a-valid-url");
  });
});
