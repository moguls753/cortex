/**
 * Integration tests for the onboarding wizard setup flow.
 * Uses testcontainers PostgreSQL for real DB operations.
 *
 * Scenarios: TS-2.3, TS-2.5, TS-E9 (integration variants)
 *
 * These tests exercise the full stack: HTTP request -> Hono route -> bcrypt
 * hashing -> PostgreSQL write -> query verification. No mocks for DB or
 * bcrypt — only real implementations.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { Hono } from "hono";
import type postgres from "postgres";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Creates a Hono app wired to the real setup routes and DB.
 * The setup routes module (`src/web/setup.ts`) is imported dynamically
 * so the test file compiles even before the source exists.
 */
async function createSetupApp(sql: postgres.Sql): Promise<Hono> {
  const { createSetupRoutes } = await import("../../src/web/setup.js");

  const app = new Hono();
  app.route("/", createSetupRoutes(sql));

  return app;
}

function buildAccountFormData(
  overrides: Record<string, string> = {},
): URLSearchParams {
  return new URLSearchParams({
    display_name: "Eike",
    password: "securepass123",
    confirm_password: "securepass123",
    ...overrides,
  });
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("Onboarding Integration", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    // Clean slate: remove all users and settings between tests.
    // The "user" table is created by the onboarding migration; if it
    // doesn't exist yet (feature not implemented), this will fail —
    // which is expected and correct (tests must fail before impl).
    await db.sql`TRUNCATE "user" CASCADE`;
    await db.sql`TRUNCATE settings`;
  });

  // ═══════════════════════════════════════════════════════════════════
  // TS-2.3 (integration): Account creation hashes password with bcrypt
  //                        and stores user
  // ═══════════════════════════════════════════════════════════════════
  it("TS-2.3 — account creation hashes password with bcrypt and stores user", async () => {
    const app = await createSetupApp(db.sql);

    const res = await app.request("/setup/step/1", {
      method: "POST",
      body: buildAccountFormData(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    // The request should succeed (redirect to step 2)
    expect(res.status).toBe(302);

    // Query the user table directly
    const rows = await db.sql`SELECT * FROM "user"`;
    expect(rows.length).toBe(1);

    const user = rows[0];

    // Password hash is bcrypt with cost factor 12
    expect(user.password_hash).toMatch(/^\$2b\$12\$/);

    // Display name is stored
    expect(user.display_name).toBe("Eike");

    // created_at is set
    expect(user.created_at).not.toBeNull();
    expect(user.created_at).toBeInstanceOf(Date);
  });

  // ═══════════════════════════════════════════════════════════════════
  // TS-2.5 (integration): Auto-login after account creation
  // ═══════════════════════════════════════════════════════════════════
  it("TS-2.5 — auto-login after account creation sets session cookie and redirects to step 2", async () => {
    const app = await createSetupApp(db.sql);

    const res = await app.request("/setup/step/1", {
      method: "POST",
      body: buildAccountFormData(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    // Response sets a session cookie
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("cortex_session");

    // Response redirects to step 2
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("/setup/step/2");
  });

  // ═══════════════════════════════════════════════════════════════════
  // TS-E9: Double-submit creates only one user (CHECK constraint)
  // ═══════════════════════════════════════════════════════════════════
  it("TS-E9 — double-submit of account step creates only one user", async () => {
    const app = await createSetupApp(db.sql);

    const formData = buildAccountFormData();

    // Submit twice concurrently
    const [res1, res2] = await Promise.all([
      app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams(formData),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
      app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams(formData),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    ]);

    // Exactly one user row exists (enforced by CHECK (id = 1) constraint)
    const rows = await db.sql`SELECT COUNT(*)::int AS count FROM "user"`;
    expect(rows[0].count).toBe(1);

    // At least one response is a redirect (successful creation)
    const statuses = [res1.status, res2.status];
    expect(statuses.some((s) => s === 302)).toBe(true);

    // Neither response is a 500 (no server crash)
    expect(res1.status).not.toBe(500);
    expect(res2.status).not.toBe(500);
  });
});
