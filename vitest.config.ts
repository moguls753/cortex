import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fakeTimers: {
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    },
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/cortex_test",
      LLM_API_KEY: "test-api-key",
      TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
      WEBAPP_PASSWORD: "test-password",
      SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
    },
  },
});
