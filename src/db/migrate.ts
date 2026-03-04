export async function migrateWithRetry(
  runner: () => Promise<void>,
  maxTimeoutMs = 30_000,
): Promise<void> {
  let delay = 1_000;
  let totalWaited = 0;

  for (;;) {
    try {
      await runner();
      return;
    } catch (error) {
      if (totalWaited >= maxTimeoutMs) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      totalWaited += delay;
      delay *= 2;
    }
  }
}
