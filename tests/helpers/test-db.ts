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
 * Also seeds a default test user with password "test-password" (bcrypt cost 10)
 * so integration tests that go through the setup-wizard-based login route can
 * authenticate without an explicit seed step. Integration tests that need a
 * clean user table can TRUNCATE it in their own beforeEach.
 */
export async function runMigrations(url: string): Promise<void> {
  const { runMigrations: migrate } = await import("../../src/db/index.js");
  await migrate(url);

  const sql = postgres(url);
  try {
    const rows =
      (await sql`SELECT COUNT(*)::int AS count FROM "user"`) as unknown as [
        { count: number },
      ];
    if ((rows[0]?.count ?? 0) === 0) {
      // bcrypt hash of "test-password" (cost 10). The user table CHECKs
      // id = 1 (single-row table by design), so we pin the id explicitly.
      const hash =
        "$2b$10$fT48FucaYsd.UewWh8yHfeSSuDImEjthP.X2wLVChUyMOGwVtm6..";
      await sql`INSERT INTO "user" (id, password_hash) VALUES (1, ${hash})`;
    }
  } catch {
    // User table may not exist in every migration set — safe to skip.
  } finally {
    await sql.end();
  }
}
