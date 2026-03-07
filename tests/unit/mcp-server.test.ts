/**
 * Unit tests for the MCP server.
 * Uses mocked query layer, embedding, and classification.
 *
 * Scenarios: TS-1.1, 1.3, 1.4, 1.6–1.10,
 *            TS-2.1–2.5,
 *            TS-3.1–3.3, 3.5,
 *            TS-4.1–4.4,
 *            TS-5.1–5.2b, 5.3–5.10,
 *            TS-6.1–6.4,
 *            TS-8.1–8.2,
 *            TS-9.3–9.4,
 *            TS-10.1–10.3
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createFakeEmbedding } from "../helpers/mock-ollama.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Module Mocks (hoisted) ─────────────────────────────────────────

vi.mock("../../src/mcp-queries.js", () => ({
  searchBySimilarity: vi.fn().mockResolvedValue([]),
  insertMcpEntry: vi.fn(),
  listRecentEntries: vi.fn().mockResolvedValue([]),
  getEntryById: vi.fn().mockResolvedValue(null),
  updateEntryFields: vi.fn(),
  softDeleteEntry: vi.fn(),
  getBrainStats: vi.fn(),
}));

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock("../../src/classify.js", () => ({
  classifyText: vi.fn(),
  assembleContext: vi.fn().mockResolvedValue(""),
}));

// ─── Constants & Helpers ────────────────────────────────────────────

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000";
const mockSql = {} as any;

function createMockEntry(overrides?: any) {
  return {
    id: VALID_UUID,
    category: "people",
    name: "Test Entry",
    content: "Test content",
    fields: {},
    tags: ["test"],
    confidence: 0.9,
    source: "mcp",
    source_type: "text",
    deleted_at: null,
    created_at: new Date("2026-03-01T10:00:00Z"),
    updated_at: new Date("2026-03-01T10:00:00Z"),
    ...overrides,
  };
}

function createMockSearchResult(overrides?: any) {
  return {
    ...createMockEntry(overrides),
    similarity: 0.85,
    ...overrides,
  };
}

async function createTestApp() {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  // Mount a simple handler at /mcp that returns 200 — auth middleware should block
  app.post("/mcp", (c) => c.text("OK"));
  return app;
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("MCP Server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── search_brain ───────────────────────────────────────────────

  describe("search_brain", () => {
    it("returns ranked results with correct shape", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { searchBySimilarity } = await import("../../src/mcp-queries.js");
      const { handleSearchBrain } = await import("../../src/mcp-tools.js");

      const fakeVector = createFakeEmbedding();
      vi.mocked(generateEmbedding).mockResolvedValue(fakeVector);

      const longContent = "x".repeat(600);
      vi.mocked(searchBySimilarity).mockResolvedValue([
        createMockSearchResult({ similarity: 0.95, name: "Result 1" }),
        createMockSearchResult({ similarity: 0.8, name: "Result 2", content: longContent }),
        createMockSearchResult({ similarity: 0.6, name: "Result 3" }),
      ]);

      const result = await handleSearchBrain(mockSql, { query: "machine learning" });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(3);

      // Each has required fields
      for (const item of data) {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("category");
        expect(item).toHaveProperty("name");
        expect(item).toHaveProperty("content");
        expect(item).toHaveProperty("tags");
        expect(item).toHaveProperty("similarity");
        expect(item).toHaveProperty("created_at");
      }

      // Long content truncated to 500 chars
      const longItem = data.find((d: any) => d.name === "Result 2");
      expect(longItem.content.length).toBeLessThanOrEqual(500);

      // Ordered by similarity desc
      expect(data[0].similarity).toBeGreaterThanOrEqual(data[1].similarity);
      expect(data[1].similarity).toBeGreaterThanOrEqual(data[2].similarity);
    });

    it("respects custom limit", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { searchBySimilarity } = await import("../../src/mcp-queries.js");
      const { handleSearchBrain } = await import("../../src/mcp-tools.js");

      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(searchBySimilarity).mockResolvedValue([
        createMockSearchResult({ similarity: 0.9 }),
        createMockSearchResult({ similarity: 0.8 }),
        createMockSearchResult({ similarity: 0.7 }),
      ]);

      await handleSearchBrain(mockSql, { query: "test", limit: 3 });

      expect(vi.mocked(searchBySimilarity)).toHaveBeenCalledWith(
        mockSql,
        expect.any(Array),
        3,
      );
    });

    it("clamps limit above 50 to 50", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { searchBySimilarity } = await import("../../src/mcp-queries.js");
      const { handleSearchBrain } = await import("../../src/mcp-tools.js");

      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(searchBySimilarity).mockResolvedValue([]);

      await handleSearchBrain(mockSql, { query: "test", limit: 100 });

      expect(vi.mocked(searchBySimilarity)).toHaveBeenCalledWith(
        mockSql,
        expect.any(Array),
        50,
      );
    });

    it("returns error for empty query", async () => {
      const { handleSearchBrain } = await import("../../src/mcp-tools.js");

      const result1 = await handleSearchBrain(mockSql, { query: "" });
      expect(result1.isError).toBe(true);
      expect(result1.content[0].text).toContain("Query cannot be empty");

      const result2 = await handleSearchBrain(mockSql, { query: "   " });
      expect(result2.isError).toBe(true);
      expect(result2.content[0].text).toContain("Query cannot be empty");
    });

    it("returns error when Ollama is unavailable", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { handleSearchBrain } = await import("../../src/mcp-tools.js");

      vi.mocked(generateEmbedding).mockRejectedValue(new Error("Connection refused"));

      const result = await handleSearchBrain(mockSql, { query: "test" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Embedding service unavailable");
    });

    it("returns empty array when no matches above threshold", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { searchBySimilarity } = await import("../../src/mcp-queries.js");
      const { handleSearchBrain } = await import("../../src/mcp-tools.js");

      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(searchBySimilarity).mockResolvedValue([]);

      const result = await handleSearchBrain(mockSql, { query: "niche topic" });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data).toEqual([]);
    });

    it("returns empty array for empty database", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { searchBySimilarity } = await import("../../src/mcp-queries.js");
      const { handleSearchBrain } = await import("../../src/mcp-tools.js");

      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(searchBySimilarity).mockResolvedValue([]);

      const result = await handleSearchBrain(mockSql, { query: "anything" });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data).toEqual([]);
    });

    it("uses default limit for zero or negative values", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { searchBySimilarity } = await import("../../src/mcp-queries.js");
      const { handleSearchBrain } = await import("../../src/mcp-tools.js");

      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(searchBySimilarity).mockResolvedValue([]);

      await handleSearchBrain(mockSql, { query: "test", limit: 0 });
      expect(vi.mocked(searchBySimilarity)).toHaveBeenCalledWith(
        mockSql,
        expect.any(Array),
        10,
      );

      vi.clearAllMocks();
      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(searchBySimilarity).mockResolvedValue([]);

      await handleSearchBrain(mockSql, { query: "test", limit: -5 });
      expect(vi.mocked(searchBySimilarity)).toHaveBeenCalledWith(
        mockSql,
        expect.any(Array),
        10,
      );
    });
  });

  // ─── add_thought ────────────────────────────────────────────────

  describe("add_thought", () => {
    it("captures thought with classification and embedding", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { classifyText, assembleContext } = await import("../../src/classify.js");
      const { insertMcpEntry } = await import("../../src/mcp-queries.js");
      const { handleAddThought } = await import("../../src/mcp-tools.js");

      const fakeVector = createFakeEmbedding();
      vi.mocked(classifyText).mockResolvedValue({
        category: "people",
        name: "Sarah Meeting",
        confidence: 0.9,
        fields: {},
        tags: ["work"],
      });
      vi.mocked(assembleContext).mockResolvedValue("some context");
      vi.mocked(generateEmbedding).mockResolvedValue(fakeVector);
      vi.mocked(insertMcpEntry).mockResolvedValue(
        createMockEntry({
          category: "people",
          name: "Sarah Meeting",
          confidence: 0.9,
          tags: ["work"],
        }),
      );

      const result = await handleAddThought(mockSql, { text: "Met with Sarah about Q3" });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe(VALID_UUID);
      expect(data.category).toBe("people");
      expect(data.name).toBe("Sarah Meeting");
      expect(data.confidence).toBe(0.9);
      expect(data.tags).toEqual(["work"]);

      expect(vi.mocked(insertMcpEntry)).toHaveBeenCalledWith(
        mockSql,
        expect.objectContaining({
          source: "mcp",
          source_type: "text",
        }),
      );
      expect(vi.mocked(assembleContext)).toHaveBeenCalled();
    });

    it("returns error for empty text", async () => {
      const { handleAddThought } = await import("../../src/mcp-tools.js");

      const result1 = await handleAddThought(mockSql, { text: "" });
      expect(result1.isError).toBe(true);
      expect(result1.content[0].text).toContain("Text cannot be empty");

      const result2 = await handleAddThought(mockSql, { text: "   " });
      expect(result2.isError).toBe(true);
      expect(result2.content[0].text).toContain("Text cannot be empty");
    });

    it("stores unclassified entry when Claude is unavailable", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { classifyText } = await import("../../src/classify.js");
      const { insertMcpEntry } = await import("../../src/mcp-queries.js");
      const { handleAddThought } = await import("../../src/mcp-tools.js");

      vi.mocked(classifyText).mockRejectedValue(new Error("LLM unavailable"));
      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(insertMcpEntry).mockResolvedValue(
        createMockEntry({ category: null, confidence: null, name: "Some thought" }),
      );

      const result = await handleAddThought(mockSql, { text: "Some thought" });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.category).toBeNull();
      expect(data.confidence).toBeNull();

      expect(vi.mocked(insertMcpEntry)).toHaveBeenCalledWith(
        mockSql,
        expect.objectContaining({
          category: null,
          confidence: null,
          fields: {},
        }),
      );
    });

    it("stores unclassified entry when Claude returns malformed JSON", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { classifyText } = await import("../../src/classify.js");
      const { insertMcpEntry } = await import("../../src/mcp-queries.js");
      const { handleAddThought } = await import("../../src/mcp-tools.js");

      vi.mocked(classifyText).mockRejectedValue(new SyntaxError("Unexpected token"));
      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(insertMcpEntry).mockResolvedValue(
        createMockEntry({ category: null, confidence: null, name: "Some thought" }),
      );

      const result = await handleAddThought(mockSql, { text: "Some thought" });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.category).toBeNull();
      expect(data.confidence).toBeNull();

      expect(vi.mocked(insertMcpEntry)).toHaveBeenCalledWith(
        mockSql,
        expect.objectContaining({
          category: null,
          confidence: null,
          fields: {},
        }),
      );
    });

    it("stores entry without embedding when Ollama is unavailable", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { classifyText } = await import("../../src/classify.js");
      const { insertMcpEntry } = await import("../../src/mcp-queries.js");
      const { handleAddThought } = await import("../../src/mcp-tools.js");

      vi.mocked(classifyText).mockResolvedValue({
        category: "tasks",
        name: "Buy groceries",
        confidence: 0.85,
        fields: {},
        tags: ["shopping"],
      });
      vi.mocked(generateEmbedding).mockRejectedValue(new Error("Ollama down"));
      vi.mocked(insertMcpEntry).mockResolvedValue(
        createMockEntry({
          category: "tasks",
          name: "Buy groceries",
          confidence: 0.85,
          tags: ["shopping"],
        }),
      );

      const result = await handleAddThought(mockSql, { text: "Some thought" });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.category).toBe("tasks");
      expect(data.name).toBe("Buy groceries");
      expect(data.confidence).toBe(0.85);
      expect(data.tags).toEqual(["shopping"]);

      expect(vi.mocked(insertMcpEntry)).toHaveBeenCalledWith(
        mockSql,
        expect.objectContaining({
          embedding: null,
        }),
      );
    });
  });

  // ─── list_recent ────────────────────────────────────────────────

  describe("list_recent", () => {
    it("lists recent entries with defaults", async () => {
      const { listRecentEntries } = await import("../../src/mcp-queries.js");
      const { handleListRecent } = await import("../../src/mcp-tools.js");

      vi.mocked(listRecentEntries).mockResolvedValue([
        createMockEntry({ name: "Entry 1", created_at: new Date("2026-03-01T10:00:00Z") }),
        createMockEntry({ name: "Entry 2", created_at: new Date("2026-03-02T10:00:00Z") }),
        createMockEntry({ name: "Entry 3", created_at: new Date("2026-03-03T10:00:00Z") }),
      ]);

      const result = await handleListRecent(mockSql, {});

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(3);

      // Each has required fields but NOT content or fields
      for (const item of data) {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("category");
        expect(item).toHaveProperty("name");
        expect(item).toHaveProperty("tags");
        expect(item).toHaveProperty("created_at");
        expect(item).toHaveProperty("updated_at");
        expect(item).not.toHaveProperty("content");
        expect(item).not.toHaveProperty("fields");
      }

      expect(vi.mocked(listRecentEntries)).toHaveBeenCalledWith(
        mockSql,
        7,
        undefined,
      );
    });

    it("filters by category", async () => {
      const { listRecentEntries } = await import("../../src/mcp-queries.js");
      const { handleListRecent } = await import("../../src/mcp-tools.js");

      vi.mocked(listRecentEntries).mockResolvedValue([
        createMockEntry({ name: "Task 1", category: "tasks" }),
        createMockEntry({ name: "Task 2", category: "tasks" }),
      ]);

      const result = await handleListRecent(mockSql, { category: "tasks" });

      expect(vi.mocked(listRecentEntries)).toHaveBeenCalledWith(
        mockSql,
        7,
        "tasks",
      );

      const data = JSON.parse(result.content[0].text);
      for (const item of data) {
        expect(item.category).toBe("tasks");
      }
    });

    it("returns error for invalid category", async () => {
      const { handleListRecent } = await import("../../src/mcp-tools.js");

      const result = await handleListRecent(mockSql, { category: "invalid_category" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid category");
    });

    it("accepts custom days parameter", async () => {
      const { listRecentEntries } = await import("../../src/mcp-queries.js");
      const { handleListRecent } = await import("../../src/mcp-tools.js");

      vi.mocked(listRecentEntries).mockResolvedValue([
        createMockEntry(),
      ]);

      await handleListRecent(mockSql, { days: 5 });

      expect(vi.mocked(listRecentEntries)).toHaveBeenCalledWith(
        mockSql,
        5,
        undefined,
      );
    });
  });

  // ─── get_entry ──────────────────────────────────────────────────

  describe("get_entry", () => {
    it("returns full entry", async () => {
      const { getEntryById } = await import("../../src/mcp-queries.js");
      const { handleGetEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(createMockEntry());

      const result = await handleGetEntry(mockSql, { id: VALID_UUID });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("category");
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("content");
      expect(data).toHaveProperty("fields");
      expect(data).toHaveProperty("tags");
      expect(data).toHaveProperty("confidence");
      expect(data).toHaveProperty("source");
      expect(data).toHaveProperty("source_type");
      expect(data).toHaveProperty("created_at");
      expect(data).toHaveProperty("updated_at");
    });

    it("returns error for nonexistent entry", async () => {
      const { getEntryById } = await import("../../src/mcp-queries.js");
      const { handleGetEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(null);

      const result = await handleGetEntry(mockSql, { id: VALID_UUID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Entry not found");
    });

    it("returns error for soft-deleted entry", async () => {
      const { getEntryById } = await import("../../src/mcp-queries.js");
      const { handleGetEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(
        createMockEntry({ deleted_at: new Date("2026-03-05T12:00:00Z") }),
      );

      const result = await handleGetEntry(mockSql, { id: VALID_UUID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Entry has been deleted");
    });

    it("returns error for invalid UUID format", async () => {
      const { handleGetEntry } = await import("../../src/mcp-tools.js");

      const result = await handleGetEntry(mockSql, { id: "not-a-uuid" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid entry ID");
    });
  });

  // ─── update_entry ───────────────────────────────────────────────

  describe("update_entry", () => {
    it("updates only provided fields", async () => {
      const { getEntryById, updateEntryFields } = await import("../../src/mcp-queries.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(
        createMockEntry({ name: "Old Name", content: "Old content" }),
      );
      vi.mocked(updateEntryFields).mockResolvedValue(
        createMockEntry({ name: "New Name", content: "Old content" }),
      );

      const result = await handleUpdateEntry(mockSql, { id: VALID_UUID, name: "New Name" });

      expect(result.isError).toBeFalsy();

      // updateEntryFields called with name only (no content key)
      const updateCall = vi.mocked(updateEntryFields).mock.calls[0];
      expect(updateCall).toBeDefined();
      const updateArgs = updateCall[2]; // sql, id, updates
      expect(updateArgs).toHaveProperty("name", "New Name");
      expect(updateArgs).not.toHaveProperty("content");

      // Result includes all entry fields
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("category");
    });

    it("re-embeds on content change", async () => {
      const { getEntryById, updateEntryFields } = await import("../../src/mcp-queries.js");
      const { generateEmbedding } = await import("../../src/embed.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(createMockEntry());
      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(updateEntryFields).mockResolvedValue(
        createMockEntry({ content: "New content" }),
      );

      await handleUpdateEntry(mockSql, { id: VALID_UUID, content: "New content" });

      expect(vi.mocked(generateEmbedding)).toHaveBeenCalled();

      const updateCall = vi.mocked(updateEntryFields).mock.calls[0];
      const updateArgs = updateCall[2];
      expect(updateArgs).toHaveProperty("embedding");
    });

    it("re-embeds on name change", async () => {
      const { getEntryById, updateEntryFields } = await import("../../src/mcp-queries.js");
      const { generateEmbedding } = await import("../../src/embed.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(
        createMockEntry({ name: "Old Name" }),
      );
      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(updateEntryFields).mockResolvedValue(
        createMockEntry({ name: "New Name" }),
      );

      await handleUpdateEntry(mockSql, { id: VALID_UUID, name: "New Name" });

      expect(vi.mocked(generateEmbedding)).toHaveBeenCalled();

      // Content unchanged — updateEntryFields should not have content override
      const updateCall = vi.mocked(updateEntryFields).mock.calls[0];
      const updateArgs = updateCall[2];
      expect(updateArgs).not.toHaveProperty("content");
    });

    it("preserves existing fields on category change without fields", async () => {
      const { getEntryById, updateEntryFields } = await import("../../src/mcp-queries.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(
        createMockEntry({
          category: "tasks",
          fields: { status: "pending" },
        }),
      );
      vi.mocked(updateEntryFields).mockResolvedValue(
        createMockEntry({ category: "ideas", fields: { status: "pending" } }),
      );

      await handleUpdateEntry(mockSql, { id: VALID_UUID, category: "ideas" });

      const updateCall = vi.mocked(updateEntryFields).mock.calls[0];
      const updateArgs = updateCall[2];
      expect(updateArgs).toHaveProperty("category", "ideas");
      // Fields should NOT be cleared
      expect(updateArgs).not.toHaveProperty("fields");
    });

    it("returns error for nonexistent entry", async () => {
      const { getEntryById } = await import("../../src/mcp-queries.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(null);

      const result = await handleUpdateEntry(mockSql, { id: VALID_UUID, name: "Test" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Entry not found");
    });

    it("returns error for soft-deleted entry", async () => {
      const { getEntryById, updateEntryFields } = await import("../../src/mcp-queries.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(
        createMockEntry({ deleted_at: new Date("2026-03-05T12:00:00Z") }),
      );

      const result = await handleUpdateEntry(mockSql, { id: VALID_UUID, name: "Test" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Entry has been deleted");
      expect(vi.mocked(updateEntryFields)).not.toHaveBeenCalled();
    });

    it("returns error for invalid UUID", async () => {
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      const result = await handleUpdateEntry(mockSql, { id: "not-a-uuid", name: "Test" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid entry ID");
    });

    it("returns error for invalid category", async () => {
      const { getEntryById } = await import("../../src/mcp-queries.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(createMockEntry());

      const result = await handleUpdateEntry(mockSql, { id: VALID_UUID, category: "invalid" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid category");
    });

    it("does not re-embed when only tags change", async () => {
      const { getEntryById, updateEntryFields } = await import("../../src/mcp-queries.js");
      const { generateEmbedding } = await import("../../src/embed.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(createMockEntry());
      vi.mocked(updateEntryFields).mockResolvedValue(
        createMockEntry({ tags: ["new-tag"] }),
      );

      await handleUpdateEntry(mockSql, { id: VALID_UUID, tags: ["new-tag"] });

      expect(vi.mocked(generateEmbedding)).not.toHaveBeenCalled();
    });

    it("returns entry unchanged for empty update", async () => {
      const { getEntryById, updateEntryFields } = await import("../../src/mcp-queries.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      const entry = createMockEntry();
      vi.mocked(getEntryById).mockResolvedValue(entry);

      const result = await handleUpdateEntry(mockSql, { id: VALID_UUID });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe(VALID_UUID);
      expect(data.name).toBe("Test Entry");

      // updateEntryFields NOT called (or called with empty)
      expect(vi.mocked(updateEntryFields)).not.toHaveBeenCalled();
    });

    it("updates content but nullifies embedding when Ollama is down", async () => {
      const { getEntryById, updateEntryFields } = await import("../../src/mcp-queries.js");
      const { generateEmbedding } = await import("../../src/embed.js");
      const { handleUpdateEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(createMockEntry());
      vi.mocked(generateEmbedding).mockRejectedValue(new Error("Ollama down"));
      vi.mocked(updateEntryFields).mockResolvedValue(
        createMockEntry({ content: "New content" }),
      );

      const result = await handleUpdateEntry(mockSql, { id: VALID_UUID, content: "New content" });

      expect(result.isError).toBeFalsy();

      const updateCall = vi.mocked(updateEntryFields).mock.calls[0];
      const updateArgs = updateCall[2];
      expect(updateArgs).toHaveProperty("content", "New content");
      expect(updateArgs).toHaveProperty("embedding", null);
    });
  });

  // ─── delete_entry ───────────────────────────────────────────────

  describe("delete_entry", () => {
    it("soft deletes an active entry", async () => {
      const { getEntryById, softDeleteEntry } = await import("../../src/mcp-queries.js");
      const { handleDeleteEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(createMockEntry());
      vi.mocked(softDeleteEntry).mockResolvedValue(undefined);

      const result = await handleDeleteEntry(mockSql, { id: VALID_UUID });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Entry deleted");
      expect(vi.mocked(softDeleteEntry)).toHaveBeenCalledWith(mockSql, VALID_UUID);
    });

    it("returns error for nonexistent entry", async () => {
      const { getEntryById } = await import("../../src/mcp-queries.js");
      const { handleDeleteEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(null);

      const result = await handleDeleteEntry(mockSql, { id: VALID_UUID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Entry not found");
    });

    it("returns error for already-deleted entry", async () => {
      const { getEntryById, softDeleteEntry } = await import("../../src/mcp-queries.js");
      const { handleDeleteEntry } = await import("../../src/mcp-tools.js");

      vi.mocked(getEntryById).mockResolvedValue(
        createMockEntry({ deleted_at: new Date("2026-03-05T12:00:00Z") }),
      );

      const result = await handleDeleteEntry(mockSql, { id: VALID_UUID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Entry is already deleted");
      expect(vi.mocked(softDeleteEntry)).not.toHaveBeenCalled();
    });

    it("returns error for invalid UUID", async () => {
      const { handleDeleteEntry } = await import("../../src/mcp-tools.js");

      const result = await handleDeleteEntry(mockSql, { id: "not-a-uuid" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid entry ID");
    });
  });

  // ─── stdio transport ───────────────────────────────────────────

  describe("stdio transport", () => {
    it("creates MCP server configured for stdio", async () => {
      const { createMcpServer } = await import("../../src/mcp-tools.js");
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");

      const server = createMcpServer(mockSql);

      expect(server).toBeInstanceOf(Server);
    });

    it("registers all 7 tools with descriptions and schemas", async () => {
      const { createMcpServer } = await import("../../src/mcp-tools.js");
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

      const server = createMcpServer(mockSql);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      const client = new Client({ name: "test", version: "1.0" });
      await client.connect(clientTransport);

      const { tools } = await client.listTools();

      const expectedTools = [
        "search_brain",
        "add_thought",
        "list_recent",
        "get_entry",
        "update_entry",
        "delete_entry",
        "brain_stats",
      ];

      expect(tools).toHaveLength(7);

      const toolNames = tools.map((t: any) => t.name);
      for (const name of expectedTools) {
        expect(toolNames).toContain(name);
      }

      // Each has description and inputSchema
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
      }

      await client.close();
      await server.close();
    });
  });

  // ─── HTTP transport ─────────────────────────────────────────────

  describe("HTTP transport", () => {
    it("returns 401 for unauthenticated request", async () => {
      const app = await createTestApp();

      const res = await app.request("/mcp", { method: "POST" });

      expect(res.status).toBe(401);
    });

    it("returns 401 for expired session cookie", async () => {
      const { createHmac } = await import("node:crypto");

      const app = await createTestApp();

      // Create an expired session cookie (issued_at > 30 days ago)
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const payload = JSON.stringify({ issued_at: thirtyOneDaysAgo });
      const signature = createHmac("sha256", TEST_SECRET)
        .update(payload)
        .digest("base64url");
      const token = `${payload}.${signature}`;
      const cookieValue = encodeURIComponent(token);

      const res = await app.request("/mcp", {
        method: "POST",
        headers: {
          cookie: `cortex_session=${cookieValue}`,
        },
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── constraints ────────────────────────────────────────────────

  describe("constraints", () => {
    it("does not expose database internals in error messages", async () => {
      const { getEntryById } = await import("../../src/mcp-queries.js");
      const { searchBySimilarity } = await import("../../src/mcp-queries.js");
      const { generateEmbedding } = await import("../../src/embed.js");
      const {
        handleGetEntry,
        handleDeleteEntry,
        handleUpdateEntry,
        handleListRecent,
        handleSearchBrain,
      } = await import("../../src/mcp-tools.js");

      const dbError = new Error("connection refused to pg_catalog SELECT FROM entries WHERE ECONNREFUSED INSERT");

      // Test handlers that do DB lookups
      vi.mocked(getEntryById).mockRejectedValue(dbError);
      vi.mocked(generateEmbedding).mockResolvedValue(createFakeEmbedding());
      vi.mocked(searchBySimilarity).mockRejectedValue(dbError);

      const forbiddenPatterns = ["SELECT", "INSERT", "FROM", "WHERE", "entries", "pg_", "ECONNREFUSED"];

      const results = await Promise.all([
        handleGetEntry(mockSql, { id: VALID_UUID }),
        handleDeleteEntry(mockSql, { id: VALID_UUID }),
        handleUpdateEntry(mockSql, { id: VALID_UUID, name: "Test" }),
      ]);

      for (const result of results) {
        expect(result.isError).toBe(true);
        const text = result.content[0].text;
        for (const pattern of forbiddenPatterns) {
          expect(text).not.toContain(pattern);
        }
      }
    });

    it("advertises tools capability only", async () => {
      const { createMcpServer } = await import("../../src/mcp-tools.js");
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

      const server = createMcpServer(mockSql);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      const client = new Client({ name: "test", version: "1.0" });
      await client.connect(clientTransport);

      const capabilities = server.getCapabilities();

      expect(capabilities.tools).toBeDefined();
      expect(capabilities.resources).toBeUndefined();
      expect(capabilities.prompts).toBeUndefined();
      expect(capabilities.sampling).toBeUndefined();

      await client.close();
      await server.close();
    });

    it("uses snake_case tool names", async () => {
      const { createMcpServer } = await import("../../src/mcp-tools.js");
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

      const server = createMcpServer(mockSql);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      const client = new Client({ name: "test", version: "1.0" });
      await client.connect(clientTransport);

      const { tools } = await client.listTools();

      const expectedNames = [
        "search_brain",
        "add_thought",
        "list_recent",
        "get_entry",
        "update_entry",
        "delete_entry",
        "brain_stats",
      ];

      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames.sort()).toEqual(expectedNames.sort());

      for (const name of toolNames) {
        expect(name).toMatch(/^[a-z_]+$/);
      }

      await client.close();
      await server.close();
    });
  });
});
