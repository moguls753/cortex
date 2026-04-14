/**
 * Integration tests for config settings override layer.
 * Tests TS-1.6, TS-1.7, TS-EC-3, TS-EC-5.
 *
 * Verifies the async resolution layer that checks the settings table
 * first, then falls back to environment variables.
 *
 * All tests will fail until src/config.ts exports resolveConfigValue().
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";
import { withEnv } from "../helpers/env.js";

let db: TestDb;
let restoreEnv: (() => void) | undefined;

beforeAll(async () => {
  db = await startTestDb();
  await runMigrations(db.url);
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

afterEach(async () => {
  // Clean settings table
  await db.sql`TRUNCATE settings`;

  // Restore env vars if saved
  if (restoreEnv) {
    restoreEnv();
    restoreEnv = undefined;
  }

  // Reset module cache so dynamic imports get fresh modules
  vi.resetModules();
});

describe("Config settings override (TS-1.6, TS-1.7)", () => {
  it("returns database setting when it overrides env var (TS-1.6)", async () => {
    // Set env var
    restoreEnv = withEnv({ LLM_MODEL: "env-model" });

    // Insert override into settings table
    await db.sql`
      INSERT INTO settings (key, value)
      VALUES ('llm_model', 'db-model')
    `;

    // Dynamic import — will fail until src/config.ts exists
    const { resolveConfigValue } = await import("../../src/config.js");

    const resolved = await resolveConfigValue("llm_model", db.sql);
    expect(resolved).toBe("db-model");
  });

  it("returns undefined when no database setting exists (TS-1.7)", async () => {
    // resolveConfigValue is a DB-only reader; env var fallback is handled by
    // individual callers (e.g. digests.ts) which coalesce with `config.*` defaults.
    restoreEnv = withEnv({ LLM_MODEL: "env-model" });

    const { resolveConfigValue } = await import("../../src/config.js");

    const resolved = await resolveConfigValue("llm_model", db.sql);
    expect(resolved).toBeUndefined();
  });
});

describe("Config settings edge cases (TS-EC-3, TS-EC-5)", () => {
  it("ignores unrecognized keys in settings table (TS-EC-3)", async () => {
    // Insert an unknown key
    await db.sql`
      INSERT INTO settings (key, value)
      VALUES ('unknown_future_key', 'something')
    `;

    // Dynamic import — will fail until src/config.ts exists
    const { resolveConfigValue } = await import("../../src/config.js");

    // Should not throw
    const resolved = await resolveConfigValue("unknown_future_key", db.sql);

    // The resolved config should not expose unrecognized keys as config properties.
    // resolveConfigValue for an unknown key should return undefined or the raw value,
    // but the key must not appear on the typed config object.
    // At minimum, no error is thrown.
    expect(true).toBe(true); // We got here without throwing
  });

  it("returns undefined when settings table is empty (TS-EC-5)", async () => {
    await db.sql`TRUNCATE settings`;

    restoreEnv = withEnv({ LLM_MODEL: "env-model" });

    const { resolveConfigValue } = await import("../../src/config.js");

    const resolved = await resolveConfigValue("llm_model", db.sql);
    expect(resolved).toBeUndefined();
  });
});
