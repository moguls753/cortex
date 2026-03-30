/**
 * Test helpers for environment variable manipulation.
 * Used by config tests to isolate env state between tests.
 */

const REQUIRED_ENV_VARS = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/cortex_test",
} as const;

/**
 * Saves the current process.env state, applies overrides, and returns
 * a restore function. Keys set to `undefined` are deleted from process.env.
 */
export function withEnv(
  overrides: Record<string, string | undefined>,
): () => void {
  const saved: Record<string, string | undefined> = {};

  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

/**
 * Sets all required environment variables to valid placeholder values.
 * Useful as a baseline for tests that only need to manipulate specific vars.
 */
export function setRequiredEnvVars(): void {
  for (const [key, value] of Object.entries(REQUIRED_ENV_VARS)) {
    process.env[key] = value;
  }
}

/**
 * Clears all known config-related env vars (required + optional).
 * Provides a clean slate so tests control exactly which vars are set.
 */
export function clearAllConfigEnvVars(): void {
  const allKeys = [
    ...Object.keys(REQUIRED_ENV_VARS),
    "PORT",
    "TZ",
    "OLLAMA_URL",
    "WHISPER_URL",
  ];
  for (const key of allKeys) {
    delete process.env[key];
  }
}
