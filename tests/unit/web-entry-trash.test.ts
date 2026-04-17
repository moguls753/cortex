/**
 * Unit tests for the entry detail page trash features:
 * - "Delete permanently" button rendering
 * - POST /entry/:id/permanent-delete route
 *
 * Scenarios: TS-4.1a, TS-4.1b, TS-4.2, TS-4.3, TS-4.5, TS-4.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
const TEST_UUID = "11111111-1111-1111-1111-111111111111";

// ─── Module Mocks (hoisted) ─────────────────────────────────────────

vi.mock("../../src/web/entry-queries.js", () => ({
  getEntry: vi.fn().mockResolvedValue(null),
  updateEntry: vi.fn().mockResolvedValue(undefined),
  softDeleteEntry: vi.fn().mockResolvedValue(undefined),
  restoreEntry: vi.fn().mockResolvedValue(undefined),
  permanentDeleteEntry: vi.fn().mockResolvedValue(true),
  getAllTags: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(4096).fill(0)),
  embedEntry: vi.fn().mockResolvedValue(undefined),
}));

// ─── Types & Factories ─────────────────────────────────────────────

interface Entry {
  id: string;
  name: string;
  category: string | null;
  content: string | null;
  fields: Record<string, unknown>;
  tags: string[];
  confidence: number | null;
  source: string;
  source_type: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function createMockEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: TEST_UUID,
    name: "Test Entry",
    category: "tasks",
    content: "Test content",
    fields: {},
    tags: [],
    confidence: 0.85,
    source: "telegram",
    source_type: "text",
    deleted_at: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

async function createTestEntry(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createEntryRoutes } = await import("../../src/web/entry.js");

  const mockSql = {} as any;

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createEntryRoutes(mockSql));

  return { app };
}

async function loginAndGetCookie(
  app: Hono,
  password = TEST_PASSWORD,
): Promise<string> {
  const res = await app.request("/login", {
    method: "POST",
    body: new URLSearchParams({ password }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("No Set-Cookie header in login response");
  }
  return setCookie.split(";")[0]!;
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("Web Entry — Trash Features", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Delete Permanently Button (US-4)
  // ═══════════════════════════════════════════════════════════════════
  describe("Delete Permanently Button (US-4)", () => {
    // TS-4.1a
    it("shows Delete permanently button for deleted entry", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({
          deleted_at: new Date("2026-04-15T10:00:00Z"),
        }),
      );

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // "Delete permanently" button present
      expect(body).toMatch(/delete permanently/i);
      // Form action points to permanent-delete route
      expect(body).toContain(`/entry/${TEST_UUID}/permanent-delete`);
      // Destructive styling
      expect(body).toContain("text-destructive");
      // Restore button also present
      expect(body).toContain(`/entry/${TEST_UUID}/restore`);
    });

    // TS-4.1b
    it("does not show Delete permanently for active entry", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({ deleted_at: null }),
      );

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // "Delete permanently" should NOT be present
      expect(body).not.toMatch(/delete permanently/i);
      expect(body).not.toContain("permanent-delete");
      // Normal Edit and Delete buttons should be present
      expect(body).toContain(`/entry/${TEST_UUID}/edit`);
      expect(body).toContain(`/entry/${TEST_UUID}/delete`);
    });

    // TS-4.2
    it("permanent delete button has confirmation", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({
          deleted_at: new Date("2026-04-15T10:00:00Z"),
        }),
      );

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Form with onsubmit confirmation containing "Permanently delete"
      expect(body).toMatch(/onsubmit="[^"]*[Pp]ermanently delete/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Permanent Delete Route (US-4)
  // ═══════════════════════════════════════════════════════════════════
  describe("Permanent Delete Route (US-4)", () => {
    // TS-4.3
    it("permanent delete removes entry and redirects to /trash", async () => {
      const { getEntry, permanentDeleteEntry } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({
          deleted_at: new Date("2026-04-15T10:00:00Z"),
        }),
      );
      vi.mocked(permanentDeleteEntry).mockResolvedValue(true);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}/permanent-delete`, {
        method: "POST",
        headers: { Cookie: cookie },
        redirect: "manual",
      });

      // permanentDeleteEntry called with sql and entry ID
      expect(vi.mocked(permanentDeleteEntry)).toHaveBeenCalledWith(
        expect.anything(),
        TEST_UUID,
      );
      // Redirects to /trash
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/trash");
    });

    // TS-4.5
    it("permanent delete returns 404 for missing entry", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(null);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(
        `/entry/${TEST_UUID}/permanent-delete`,
        {
          method: "POST",
          headers: { Cookie: cookie },
        },
      );

      expect(res.status).toBe(404);
    });

    // TS-4.6
    it("permanent delete returns 404 for non-deleted entry", async () => {
      const { getEntry, permanentDeleteEntry } = await import(
        "../../src/web/entry-queries.js"
      );
      // Active entry (deleted_at is null)
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({ deleted_at: null }),
      );

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(
        `/entry/${TEST_UUID}/permanent-delete`,
        {
          method: "POST",
          headers: { Cookie: cookie },
        },
      );

      expect(res.status).toBe(404);
      // permanentDeleteEntry should NOT have been called
      expect(vi.mocked(permanentDeleteEntry)).not.toHaveBeenCalled();
    });
  });
});
