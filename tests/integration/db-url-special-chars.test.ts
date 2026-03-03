/**
 * Integration test for DATABASE_URL with special characters in password.
 * Test TS-EC-6.
 *
 * Starts a testcontainers PostgreSQL instance with a password containing
 * special characters and verifies the app's database connection logic
 * handles the encoded URL correctly.
 */

import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const PGVECTOR_IMAGE = "pgvector/pgvector:pg16";
const SPECIAL_PASSWORD = "p@ss%word!";

let container: StartedPostgreSqlContainer | undefined;

beforeEach(() => {
  vi.resetModules();
});

afterAll(async () => {
  if (container) await container.stop();
});

describe("DATABASE_URL with special characters (TS-EC-6)", () => {
  it("connects successfully with special characters in DATABASE_URL password", async () => {
    // Start container with a password containing special chars
    container = await new PostgreSqlContainer(PGVECTOR_IMAGE)
      .withPassword(SPECIAL_PASSWORD)
      .withDatabase("cortex_test")
      .withUsername("cortex_test")
      .start();

    // Build a properly percent-encoded DATABASE_URL
    const host = container.getHost();
    const port = container.getMappedPort(5432);
    const encodedPassword = encodeURIComponent(SPECIAL_PASSWORD);
    const databaseUrl = `postgresql://cortex_test:${encodedPassword}@${host}:${port}/cortex_test`;

    // Connect through the app's database connection logic.
    // Will fail until src/db/index.js is implemented.
    const { createDbConnection } = await import("../../src/db/index.js");
    const sql = createDbConnection(databaseUrl);

    try {
      const result = await sql`SELECT 1 AS connected`;
      expect(result).toHaveLength(1);
      expect(result[0].connected).toBe(1);
    } finally {
      await sql.end();
    }
  }, 120_000);
});
