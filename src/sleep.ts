/**
 * Async delay utility. Extracted so tests can mock it
 * without needing fake timers (which conflict with real I/O).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
