/**
 * Test helpers for PostgreSQL testcontainers setup.
 * Used by integration tests that need a real pgvector database.
 */

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import postgres from "postgres";

const PGVECTOR_IMAGE = "pgvector/pgvector:pg16";

export interface TestDb {
  url: string;
  sql: postgres.Sql;
  container: StartedPostgreSqlContainer;
  stop: () => Promise<void>;
}

/**
 * Starts a pgvector PostgreSQL container and returns a connection.
 * Use in beforeAll hooks. Call stop() in afterAll.
 */
export async function startTestDb(
  password = "test-password",
): Promise<TestDb> {
  const container = await new PostgreSqlContainer(PGVECTOR_IMAGE)
    .withPassword(password)
    .withDatabase("cortex_test")
    .withUsername("cortex_test")
    .start();

  const url = container.getConnectionUri();
  const sql = postgres(url);

  // Enable pgvector extension
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  return {
    url,
    sql,
    container,
    stop: async () => {
      await sql.end();
      await container.stop();
    },
  };
}

/**
 * Runs Drizzle migrations against the provided database URL.
 * Imports the migration runner from the source code.
 * Will fail until src/db/ is implemented — expected in Phase 4.
 */
export async function runMigrations(url: string): Promise<void> {
  // Dynamic import so the test file compiles even before src/db exists.
  // This will throw "module not found" until the source code is implemented.
  const { runMigrations: migrate } = await import("../../src/db/index.js");
  await migrate(url);
}
