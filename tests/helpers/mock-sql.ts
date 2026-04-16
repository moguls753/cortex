/**
 * Lightweight postgres.js-style mock for tests that don't need a real DB.
 *
 * Only supports the shapes used by the system-status checkers:
 * - sql`SELECT 1` (tagged template returning a promise)
 * - sql`SELECT value FROM settings WHERE key = ${key}` (resolves to rows)
 *
 * Integration tests should use tests/helpers/test-db.ts instead.
 */

import { vi } from "vitest";

export interface MockSqlOptions {
  /**
   * Called for every tagged-template invocation with the template strings and
   * their interpolated values. Return a promise that resolves to the rows the
   * caller should see. To simulate a connection failure, throw or reject.
   */
  onQuery?: (strings: readonly string[], values: unknown[]) => Promise<unknown>;
}

export type MockSql = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>) & {
  unsafe: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

/**
 * Returns a fake postgres.Sql function whose body is controlled by `onQuery`.
 * Defaults to resolving every query to an empty array.
 */
export function createMockSql(options: MockSqlOptions = {}): MockSql {
  const onQuery =
    options.onQuery ?? (async () => [] as unknown);

  const sql = ((
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown> => {
    return onQuery([...strings], values);
  }) as MockSql;

  sql.unsafe = vi.fn().mockResolvedValue([]);
  sql.end = vi.fn().mockResolvedValue(undefined);

  return sql;
}

/**
 * Convenience: an sql mock whose every query rejects with the given error.
 * Used by TS-4.2 to simulate a postgres outage.
 */
export function createFailingMockSql(error: Error = new Error("connection refused")): MockSql {
  return createMockSql({
    onQuery: async () => {
      throw error;
    },
  });
}
