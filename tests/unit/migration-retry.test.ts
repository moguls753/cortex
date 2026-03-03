import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Migration retry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries migrations with backoff until Postgres becomes available", async () => {
    const { migrateWithRetry } = await import("../../src/db/migrate.js");

    const mockRunner = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED: connection refused"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED: connection refused"))
      .mockResolvedValueOnce(undefined);

    // Start the retry process (don't await yet — it will wait on timers)
    const migrationPromise = migrateWithRetry(mockRunner);

    // Advance past the first retry delay (~1s)
    await vi.advanceTimersByTimeAsync(1_000);

    // Advance past the second retry delay (~2s)
    await vi.advanceTimersByTimeAsync(2_000);

    // The migration should now resolve successfully
    await expect(migrationPromise).resolves.toBeUndefined();

    // The runner should have been called 3 times (2 failures + 1 success)
    expect(mockRunner).toHaveBeenCalledTimes(3);
  });
});
