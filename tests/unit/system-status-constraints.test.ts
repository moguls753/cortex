/**
 * Cross-cutting constraint tests for the system-status feature.
 *
 * Scenarios: TS-10.3, TS-10.7
 *
 * Phase 4 contract: TS-10.3 passes trivially today (no deps added yet) and
 * will continue to pass unless Phase 5 introduces new deps. TS-10.7 fails
 * or passes depending on whether Phase 5 adds tables — it stays green if
 * the feature respects NG-6.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function readPackageJson(): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  return JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
}

// Snapshot of deps pinned at the start of this feature's implementation.
// If Phase 5 adds a new dep, it must also update this list AND the
// behavioral spec's C-3 constraint (explicit re-spec required).
const ALLOWED_DEPS = new Set<string>([
  "@anthropic-ai/sdk",
  "@hono/node-server",
  "@modelcontextprotocol/sdk",
  "@resvg/resvg-wasm",
  "bcryptjs",
  "cron-parser",
  "drizzle-orm",
  "grammy",
  "hono",
  "marked",
  "node-cron",
  "nodemailer",
  "openai",
  "postgres",
  "sanitize-html",
  "satori",
]);

const ALLOWED_DEV_DEPS = new Set<string>([
  "@tailwindcss/cli",
  "@tailwindcss/typography",
  "@testcontainers/postgresql",
  "@types/bcryptjs",
  "@types/node",
  "@types/node-cron",
  "@types/nodemailer",
  "@types/sanitize-html",
  "drizzle-kit",
  "tailwindcss",
  "testcontainers",
  "tsx",
  "typescript",
  "vitest",
]);

describe("System status — constraints", () => {
  it("TS-10.3 — no new npm dependencies were added by this feature", () => {
    const pkg = readPackageJson();
    const actualDeps = new Set(Object.keys(pkg.dependencies ?? {}));
    const actualDevDeps = new Set(Object.keys(pkg.devDependencies ?? {}));

    const newDeps = [...actualDeps].filter((d) => !ALLOWED_DEPS.has(d));
    const newDevDeps = [...actualDevDeps].filter(
      (d) => !ALLOWED_DEV_DEPS.has(d),
    );

    expect(newDeps).toEqual([]);
    expect(newDevDeps).toEqual([]);
  });

  it("TS-10.7 — no new database tables are created by this feature", () => {
    const dbSrc = readFileSync("src/db/index.ts", "utf8");
    // Collect all CREATE TABLE statements. Names may be unquoted or "quoted".
    const tableNames = new Set<string>();
    const re = /CREATE TABLE(?: IF NOT EXISTS)? (?:"([^"]+)"|(\w+))/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(dbSrc)) !== null) {
      tableNames.add(match[1] ?? match[2]);
    }

    // Baseline tables as of the start of this feature. If Phase 5 has added
    // anything beyond these, it contradicts NG-6 and this test fails.
    const BASELINE_TABLES = new Set<string>([
      "entries",
      "digests",
      "settings",
      "user",
    ]);

    const added = [...tableNames].filter((t) => !BASELINE_TABLES.has(t));
    expect(added).toEqual([]);
  });
});
