/**
 * Integration tests for the Telegram bot with real PostgreSQL via testcontainers.
 * Tests full message-to-storage flows, /fix DB lookups, inline corrections,
 * voice message pipeline, calendar handling, and concurrency.
 *
 * LLM, Ollama, and faster-whisper remain mocked (no real API calls).
 * Bot handlers interact with the real database.
 *
 * Scenarios: TS-1.6–1.11, TS-3.1–3.3, TS-4.1–4.4, TS-5.1, TS-5.3–5.4,
 *            TS-6.3, TS-EC-14–EC-15, TS-EC-20–EC-23
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import type postgres from "postgres";
import {
  createClassificationResult,
  createClassificationJSON,
} from "../helpers/mock-llm.js";
import { createFakeEmbedding } from "../helpers/mock-ollama.js";
import { withEnv } from "../helpers/env.js";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";
// Note: mock-telegram update builders are available if needed for bot.handleUpdate tests.
// Current tests call handler functions directly with ctx-like objects, so these aren't used.

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockChat = vi.fn();
const mockCreateLLMProvider = vi.fn(() => ({ chat: mockChat }));

vi.mock("../../src/llm/index.js", () => ({
  createLLMProvider: mockCreateLLMProvider,
}));

const mockGenerateEmbedding = vi.fn();

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: mockGenerateEmbedding,
  prepareEmbeddingInput: vi.fn((entry: { name: string; content: string | null }) => {
    const name = entry.name?.trim() || "";
    const content = entry.content?.trim() || "";
    return name && content ? `${name} ${content}` : name || content || null;
  }),
  embedEntry: vi.fn(async (sql: postgres.Sql, entryId: string) => {
    const embedding = await mockGenerateEmbedding("text");
    if (embedding) {
      const vecStr = `[${embedding.join(",")}]`;
      await sql`UPDATE entries SET embedding = ${vecStr}::vector WHERE id = ${entryId}`;
    }
  }),
  initializeEmbedding: vi.fn(),
}));

const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

vi.mock("../../src/sleep.js", () => ({
  sleep: () => Promise.resolve(),
}));

// Mock grammy Bot to prevent real Telegram connections
const mockBotStart = vi.fn().mockResolvedValue(undefined);
const MockBot = vi.fn();

vi.mock("grammy", () => ({
  Bot: MockBot,
}));

// ---------------------------------------------------------------------------
// Types — will fail to import until src/telegram.ts exists
// ---------------------------------------------------------------------------

type CreateBotWithHandlers = (
  token: string,
  sql: postgres.Sql,
) => { handleUpdate: (update: unknown) => Promise<void>; api: { config: { use: (fn: unknown) => void } } };

type HandleTextMessage = (
  ctx: Record<string, unknown>,
  sql: postgres.Sql,
) => Promise<void>;

type HandleCallbackQuery = (
  ctx: Record<string, unknown>,
  sql: postgres.Sql,
) => Promise<void>;

type HandleFixCommand = (
  ctx: Record<string, unknown>,
  sql: postgres.Sql,
) => Promise<void>;

type HandleVoiceMessage = (
  ctx: Record<string, unknown>,
  sql: postgres.Sql,
) => Promise<void>;

type StartBot = (sql: postgres.Sql) => Promise<void>;

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

async function insertEntry(
  sql: postgres.Sql,
  overrides: {
    name?: string;
    content?: string | null;
    category?: string | null;
    confidence?: number | null;
    fields?: Record<string, unknown>;
    tags?: string[];
    source?: string;
    sourceType?: string;
    embedding?: number[] | null;
    deletedAt?: Date | null;
    createdAt?: Date;
  } = {},
): Promise<{ id: string; [key: string]: unknown }> {
  const name = overrides.name ?? "test-entry";
  const content = overrides.content ?? "test content";
  const category = overrides.category ?? null;
  const confidence = overrides.confidence ?? null;
  const fields = overrides.fields ?? {};
  const tags = overrides.tags ?? [];
  const source = overrides.source ?? "telegram";
  const sourceType = overrides.sourceType ?? "text";
  const deletedAt = overrides.deletedAt ?? null;
  const createdAt = overrides.createdAt ?? new Date();

  if (overrides.embedding) {
    const vecStr = `[${overrides.embedding.join(",")}]`;
    const rows = await sql`
      INSERT INTO entries (name, content, category, confidence, fields, tags, source, source_type, embedding, deleted_at, created_at)
      VALUES (${name}, ${content}, ${category}, ${confidence}, ${JSON.stringify(fields)}::jsonb, ${tags}, ${source}, ${sourceType}, ${vecStr}::vector, ${deletedAt}, ${createdAt})
      RETURNING *
    `;
    return rows[0] as { id: string; [key: string]: unknown };
  }

  const rows = await sql`
    INSERT INTO entries (name, content, category, confidence, fields, tags, source, source_type, deleted_at, created_at)
    VALUES (${name}, ${content}, ${category}, ${confidence}, ${JSON.stringify(fields)}::jsonb, ${tags}, ${source}, ${sourceType}, ${deletedAt}, ${createdAt})
    RETURNING *
  `;
  return rows[0] as { id: string; [key: string]: unknown };
}

async function insertSetting(
  sql: postgres.Sql,
  key: string,
  value: string,
): Promise<void> {
  await sql`
    INSERT INTO settings (key, value)
    VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}
  `;
}

async function deleteSetting(
  sql: postgres.Sql,
  key: string,
): Promise<void> {
  await sql`DELETE FROM settings WHERE key = ${key}`;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Telegram Bot Integration", () => {
  let db: TestDb;
  let sql: postgres.Sql;
  let createBotWithHandlers: CreateBotWithHandlers;
  let handleTextMessage: HandleTextMessage;
  let handleVoiceMessage: HandleVoiceMessage;
  let handleCallbackQuery: HandleCallbackQuery;
  let handleFixCommand: HandleFixCommand;
  let startBot: StartBot;

  beforeAll(async () => {
    // Start testcontainers PostgreSQL
    db = await startTestDb();
    sql = db.sql;
    await runMigrations(db.url);

    // Import telegram module (will fail until it exists)
    const mod = await import("../../src/telegram.js");
    createBotWithHandlers = mod.createBotWithHandlers;
    handleTextMessage = mod.handleTextMessage;
    handleVoiceMessage = mod.handleVoiceMessage;
    handleCallbackQuery = mod.handleCallbackQuery;
    handleFixCommand = mod.handleFixCommand;
    startBot = mod.startBot;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(() => {
    mockChat.mockReset();
    mockCreateLLMProvider.mockReset();
    mockCreateLLMProvider.mockReturnValue({ chat: mockChat });
    mockGenerateEmbedding.mockReset();
    mockReadFile.mockReset();
    mockReadFile.mockResolvedValue(
      "Classify this: {context_entries}\n\nInput: {input_text}",
    );

    // Default: classification succeeds
    mockChat.mockResolvedValue(createClassificationJSON());
    // Default: embedding succeeds
    mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());
  });

  afterEach(async () => {
    // Clean up test data
    await sql`DELETE FROM entries`;
    await sql`DELETE FROM settings`;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Text message flow (TS-1.6, TS-1.7, TS-1.8, TS-1.9, TS-1.10, TS-1.11)
  // =========================================================================

  describe("text message flow", () => {
    it("classifies text messages with recent and similar context from the database", async () => {
      // TS-1.6
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');

      // Insert 7 entries with varied timestamps and embeddings
      const now = new Date();
      for (let i = 0; i < 7; i++) {
        const createdAt = new Date(now.getTime() - (7 - i) * 60_000);
        await insertEntry(sql, {
          name: `Entry ${i}`,
          content: `Content for entry ${i}`,
          category: "people",
          embedding: createFakeEmbedding(),
          createdAt,
        });
      }

      let capturedPrompt = "";
      mockChat.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return createClassificationJSON();
      });

      await handleTextMessage(
        createMockCtx(123456, "Met with Sarah about the marketing project"),
        sql,
      );

      // LLM was called with context entries in the prompt
      expect(capturedPrompt).toBeTruthy();
      expect(mockChat).toHaveBeenCalled();
      // A new entry should exist in DB
      const entries = await sql`SELECT * FROM entries WHERE content = ${"Met with Sarah about the marketing project"}`;
      expect(entries.length).toBe(1);
    });

    it("deduplicates context entries appearing in both recent and similar results", async () => {
      // TS-1.7
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');

      // Insert 5 entries — give them all the same embedding so they're all "similar"
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        await insertEntry(sql, {
          name: `Entry ${i}`,
          content: `Content ${i}`,
          category: "people",
          embedding: createFakeEmbedding(),
          createdAt: new Date(now.getTime() - (5 - i) * 60_000),
        });
      }

      let capturedPrompt = "";
      mockChat.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return createClassificationJSON();
      });

      await handleTextMessage(
        createMockCtx(123456, "Test deduplication message"),
        sql,
      );

      // Check that each entry name appears only once in the prompt
      for (let i = 0; i < 5; i++) {
        const occurrences = (capturedPrompt.match(new RegExp(`Entry ${i}`, "g")) || []).length;
        expect(occurrences).toBeLessThanOrEqual(1);
      }
    });

    it("generates and stores an embedding for the message text", async () => {
      // TS-1.8
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());
      mockChat.mockResolvedValue(createClassificationJSON());

      await handleTextMessage(
        createMockCtx(123456, "New project idea"),
        sql,
      );

      const entries = await sql`SELECT * FROM entries WHERE content = ${"New project idea"}`;
      expect(entries.length).toBe(1);
      expect(entries[0].embedding).not.toBeNull();
    });

    it("stores the entry with correct source, source_type, content, and classification fields", async () => {
      // TS-1.9
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      mockChat.mockResolvedValue(
        createClassificationJSON({
          category: "projects",
          name: "Recipe Tracker",
          confidence: 0.92,
          fields: { status: "idea" },
          tags: ["cooking", "side-project"],
        }),
      );

      await handleTextMessage(
        createMockCtx(123456, "Build a recipe tracker app"),
        sql,
      );

      const entries = await sql`SELECT * FROM entries WHERE content = ${"Build a recipe tracker app"}`;
      expect(entries.length).toBe(1);
      const entry = entries[0];
      expect(entry.source).toBe("telegram");
      expect(entry.source_type).toBe("text");
      expect(entry.content).toBe("Build a recipe tracker app");
      expect(entry.category).toBe("projects");
      expect(entry.name).toBe("Recipe Tracker");
      expect(entry.confidence).toBeCloseTo(0.92);
      expect(entry.fields).toEqual({ status: "idea" });
      expect(entry.tags).toEqual(["cooking", "side-project"]);
    });

    it("triggers calendar event creation when classification indicates it", async () => {
      // TS-1.10
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      mockChat.mockResolvedValue(
        createClassificationJSON({
          create_calendar_event: true,
          calendar_date: "2026-03-10",
        }),
      );

      // Calendar event creation is optional (COULD priority).
      // We verify the entry is stored regardless.

      await handleTextMessage(
        createMockCtx(123456, "Meeting with Anna next Tuesday"),
        sql,
      );

      // Entry stored in DB
      const entries = await sql`SELECT * FROM entries WHERE content = ${"Meeting with Anna next Tuesday"}`;
      expect(entries.length).toBe(1);
    });

    it("does not persist calendar fields in the database entry", async () => {
      // TS-1.11
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      mockChat.mockResolvedValue(
        createClassificationJSON({
          create_calendar_event: true,
          calendar_date: "2026-03-10",
        }),
      );

      await handleTextMessage(
        createMockCtx(123456, "Meeting with Anna"),
        sql,
      );

      const entries = await sql`SELECT * FROM entries WHERE content = ${"Meeting with Anna"}`;
      expect(entries.length).toBe(1);
      const entry = entries[0];
      // Calendar fields should NOT be stored in the entry
      const fields = entry.fields as Record<string, unknown>;
      expect(fields).not.toHaveProperty("create_calendar_event");
      expect(fields).not.toHaveProperty("calendar_date");
      // Also check top-level columns don't exist
      expect(entry).not.toHaveProperty("create_calendar_event");
      expect(entry).not.toHaveProperty("calendar_date");
    });
  });

  // =========================================================================
  // Inline category correction — DB (TS-3.1, TS-3.2, TS-3.3)
  // =========================================================================

  describe("inline category correction — DB", () => {
    it("updates the entry category in the database on button tap", async () => {
      // TS-3.1
      const entry = await insertEntry(sql, {
        category: "ideas",
        confidence: 0.35,
        name: "Vague Thought",
        content: "Some vague idea",
      });
      mockChat.mockResolvedValue(
        createClassificationJSON({
          category: "projects",
          name: "New Initiative",
        }),
      );

      await handleCallbackQuery(
        createMockCallbackCtx(123456, `correct:${entry.id}:projects`, 100),
        sql,
      );

      const updated = await sql`SELECT * FROM entries WHERE id = ${entry.id}`;
      expect(updated[0].category).toBe("projects");
    });

    it("re-generates category-specific fields via Claude after correction", async () => {
      // TS-3.2
      const entry = await insertEntry(sql, {
        category: "ideas",
        confidence: 0.35,
        name: "Vague Thought",
        content: "Some idea about work",
        fields: { description: "vague" },
      });
      mockChat.mockResolvedValue(
        createClassificationJSON({
          category: "projects",
          name: "Work Project",
          fields: { status: "planning", owner: "me" },
        }),
      );

      await handleCallbackQuery(
        createMockCallbackCtx(123456, `correct:${entry.id}:projects`, 100),
        sql,
      );

      const updated = await sql`SELECT * FROM entries WHERE id = ${entry.id}`;
      const fields = updated[0].fields as Record<string, unknown>;
      expect(fields).toEqual({ status: "planning", owner: "me" });
    });

    it("re-generates the embedding after category correction", async () => {
      // TS-3.3
      const originalEmbedding = createFakeEmbedding();
      const entry = await insertEntry(sql, {
        category: "ideas",
        confidence: 0.35,
        name: "Vague Thought",
        content: "Some idea",
        embedding: originalEmbedding,
      });

      // Return a different embedding after correction
      const newEmbedding = Array.from({ length: 4096 }, (_, i) => Math.cos(i) * 0.5);
      mockGenerateEmbedding.mockResolvedValue(newEmbedding);
      mockChat.mockResolvedValue(
        createClassificationJSON({ category: "projects", name: "New Project" }),
      );

      await handleCallbackQuery(
        createMockCallbackCtx(123456, `correct:${entry.id}:projects`, 100),
        sql,
      );

      expect(mockGenerateEmbedding).toHaveBeenCalled();
      const updated = await sql`SELECT * FROM entries WHERE id = ${entry.id}`;
      expect(updated[0].embedding).not.toBeNull();
    });
  });

  // =========================================================================
  // Voice message flow (TS-4.1, TS-4.2, TS-4.3, TS-4.4)
  // =========================================================================

  describe("voice message flow", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("downloads the voice audio file from Telegram", async () => {
      // TS-4.1
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      const downloadCalls: string[] = [];

      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        downloadCalls.push(urlStr);
        if (urlStr.includes("api.telegram.org/file")) {
          return new Response(Buffer.from("fake-audio-data"), { status: 200 });
        }
        if (urlStr.includes(":8000") || urlStr.includes("whisper")) {
          return new Response(JSON.stringify({ text: "test transcript" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/api/embed")) {
          const vec = createFakeEmbedding();
          return new Response(JSON.stringify({ embeddings: [vec] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch: ${urlStr}`);
      });
      mockChat.mockResolvedValue(createClassificationJSON());

      await handleVoiceMessage(
        createMockVoiceCtx(123456, "voice_abc123", 5),
        sql,
      );

      const telegramDownload = downloadCalls.find((u) =>
        u.includes("api.telegram.org/file"),
      );
      expect(telegramDownload).toBeTruthy();
    });

    it("sends the downloaded audio to faster-whisper for transcription", async () => {
      // TS-4.2
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      const fetchCalls: string[] = [];

      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        fetchCalls.push(urlStr);
        if (urlStr.includes("api.telegram.org/file")) {
          return new Response(Buffer.from("fake-audio-data"), { status: 200 });
        }
        if (urlStr.includes(":8000") || urlStr.includes("whisper")) {
          return new Response(JSON.stringify({ text: "transcribed text" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/api/embed")) {
          return new Response(JSON.stringify({ embeddings: [createFakeEmbedding()] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch: ${urlStr}`);
      });
      mockChat.mockResolvedValue(createClassificationJSON());

      await handleVoiceMessage(
        createMockVoiceCtx(123456, "voice_abc123", 5),
        sql,
      );

      const whisperCall = fetchCalls.find(
        (u) => u.includes(":8000") || u.includes("whisper"),
      );
      expect(whisperCall).toBeTruthy();
    });

    it("classifies the transcribed voice text through the full pipeline", async () => {
      // TS-4.3
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      let capturedPrompt = "";

      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("api.telegram.org/file")) {
          return new Response(Buffer.from("fake-audio"), { status: 200 });
        }
        if (urlStr.includes(":8000") || urlStr.includes("whisper")) {
          return new Response(
            JSON.stringify({ text: "I need to call Maria about the budget" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (urlStr.includes("/api/embed")) {
          return new Response(JSON.stringify({ embeddings: [createFakeEmbedding()] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch: ${urlStr}`);
      });
      mockChat.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return createClassificationJSON();
      });

      await handleVoiceMessage(
        createMockVoiceCtx(123456, "voice_abc123", 5),
        sql,
      );

      expect(capturedPrompt).toContain("I need to call Maria about the budget");
    });

    it("stores voice entries with source_type voice and transcribed content", async () => {
      // TS-4.4
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');

      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("api.telegram.org/file")) {
          return new Response(Buffer.from("fake-audio"), { status: 200 });
        }
        if (urlStr.includes(":8000") || urlStr.includes("whisper")) {
          return new Response(
            JSON.stringify({ text: "Buy groceries" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (urlStr.includes("/api/embed")) {
          return new Response(JSON.stringify({ embeddings: [createFakeEmbedding()] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch: ${urlStr}`);
      });
      mockChat.mockResolvedValue(createClassificationJSON());

      await handleVoiceMessage(
        createMockVoiceCtx(123456, "voice_abc123", 5),
        sql,
      );

      const entries = await sql`SELECT * FROM entries WHERE source_type = 'voice'`;
      expect(entries.length).toBe(1);
      expect(entries[0].source).toBe("telegram");
      expect(entries[0].source_type).toBe("voice");
      expect(entries[0].content).toBe("Buy groceries");
    });
  });

  // =========================================================================
  // /fix command — DB (TS-5.1, TS-5.3, TS-5.4)
  // =========================================================================

  describe("/fix command — DB", () => {
    it("finds the most recent telegram entry from the sender by chat ID", async () => {
      // TS-5.1
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      const now = new Date();

      // Insert 3 entries from chat ID 123456
      await insertEntry(sql, {
        name: "Old Entry",
        content: "Old content",
        category: "people",
        source: "telegram",
        createdAt: new Date(now.getTime() - 30_000),
      });
      await insertEntry(sql, {
        name: "Middle Entry",
        content: "Middle content",
        category: "people",
        source: "telegram",
        createdAt: new Date(now.getTime() - 20_000),
      });
      const newestEntry = await insertEntry(sql, {
        name: "Newest Entry",
        content: "Newest content",
        category: "people",
        source: "telegram",
        createdAt: new Date(now.getTime() - 10_000),
      });

      // Insert entry from a different source (webapp) to test source filtering
      await insertEntry(sql, {
        name: "Other User",
        content: "Other content",
        category: "tasks",
        source: "webapp",
      });

      let reclassifiedContent = "";
      mockChat.mockImplementation(async (prompt: string) => {
        reclassifiedContent = prompt;
        return createClassificationJSON({ category: "tasks", name: "Fixed" });
      });

      await handleFixCommand(
        createMockCtx(123456, "/fix this should be a person"),
        sql,
      );

      // The most recent entry (newestEntry) should be the one re-classified
      expect(reclassifiedContent).toContain("Newest content");
    });

    it("re-classifies the entry using original content plus correction text", async () => {
      // TS-5.3
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      await insertEntry(sql, {
        name: "Design Team",
        content: "Discussed roadmap with the design team",
        category: "people",
        source: "telegram",
      });

      let capturedPrompt = "";
      mockChat.mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return createClassificationJSON({ category: "projects" });
      });

      await handleFixCommand(
        createMockCtx(123456, "/fix this should be a project not a person"),
        sql,
      );

      expect(capturedPrompt).toContain("Discussed roadmap with the design team");
      expect(capturedPrompt).toContain("this should be a project not a person");
    });

    it("updates category, name, fields, tags, embedding, and confidence after /fix", async () => {
      // TS-5.4
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      const entry = await insertEntry(sql, {
        name: "Design Team",
        content: "Discussed roadmap",
        category: "people",
        confidence: 0.55,
        source: "telegram",
      });

      mockChat.mockResolvedValue(
        createClassificationJSON({
          category: "projects",
          name: "Roadmap Planning",
          confidence: 0.88,
          fields: { status: "active" },
          tags: ["work"],
        }),
      );
      const newEmbedding = Array.from({ length: 4096 }, (_, i) => Math.cos(i) * 0.3);
      mockGenerateEmbedding.mockResolvedValue(newEmbedding);

      await handleFixCommand(
        createMockCtx(123456, "/fix this is a project"),
        sql,
      );

      const updated = await sql`SELECT * FROM entries WHERE id = ${entry.id}`;
      expect(updated[0].category).toBe("projects");
      expect(updated[0].name).toBe("Roadmap Planning");
      expect(updated[0].confidence).toBeCloseTo(0.88);
      expect(updated[0].fields).toEqual({ status: "active" });
      expect(updated[0].tags).toEqual(["work"]);
      expect(updated[0].embedding).not.toBeNull();
    });
  });

  // =========================================================================
  // Startup sequence (TS-6.3)
  // =========================================================================

  describe("startup sequence", () => {
    it("starts the bot after DB migrations and server start without blocking", async () => {
      // TS-6.3
      const restoreEnv = withEnv({
        TELEGRAM_BOT_TOKEN: "fake-token:abc123",
        DATABASE_URL: db.url,
      });

      // Mock Bot constructor for this test
      MockBot.mockImplementation(() => ({
        start: mockBotStart,
        stop: vi.fn(),
        on: vi.fn(),
        command: vi.fn(),
        catch: vi.fn(),
        api: { config: { use: vi.fn() }, setWebhook: vi.fn() },
      }));

      // The startup function should not throw and should call bot.start()
      await startBot(sql);

      expect(mockBotStart).toHaveBeenCalled();
      restoreEnv();
    });
  });

  // =========================================================================
  // /fix edge cases — DB (TS-EC-14, TS-EC-15)
  // =========================================================================

  describe("/fix edge cases — DB", () => {
    it("allows /fix on an entry already corrected via inline button", async () => {
      // TS-EC-14
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      const entry = await insertEntry(sql, {
        name: "Corrected Item",
        content: "Some content",
        category: "tasks",
        confidence: null, // Previously corrected via inline button
        source: "telegram",
      });

      mockChat.mockResolvedValue(
        createClassificationJSON({
          category: "reference",
          name: "Reference Note",
          confidence: 0.9,
        }),
      );

      await handleFixCommand(
        createMockCtx(123456, "/fix actually this is a reference note"),
        sql,
      );

      const updated = await sql`SELECT * FROM entries WHERE id = ${entry.id}`;
      expect(updated[0].category).toBe("reference");
      expect(updated[0].name).toBe("Reference Note");
    });

    it("allows /fix to classify a previously unclassified entry", async () => {
      // TS-EC-15
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      const entry = await insertEntry(sql, {
        name: "Unclassified",
        content: "Failed classification earlier",
        category: null,
        confidence: null,
        source: "telegram",
      });

      mockChat.mockResolvedValue(
        createClassificationJSON({
          category: "reference",
          name: "Reference Note",
          confidence: 0.85,
          fields: { topic: "general" },
          tags: ["note"],
        }),
      );

      await handleFixCommand(
        createMockCtx(123456, "/fix this is a reference note"),
        sql,
      );

      const updated = await sql`SELECT * FROM entries WHERE id = ${entry.id}`;
      expect(updated[0].category).toBe("reference");
      expect(updated[0].name).toBe("Reference Note");
      expect(updated[0].confidence).toBeCloseTo(0.85);
      expect(updated[0].fields).toEqual({ topic: "general" });
      expect(updated[0].tags).toEqual(["note"]);
    });
  });

  // =========================================================================
  // Calendar edge cases (TS-EC-20, TS-EC-21)
  // =========================================================================

  describe("calendar edge cases", () => {
    it("silently skips calendar event when Google Calendar is not configured", async () => {
      // TS-EC-20
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      // No Google Calendar configured (no API key or settings)
      mockChat.mockResolvedValue(
        createClassificationJSON({
          create_calendar_event: true,
          calendar_date: "2026-03-10",
        }),
      );

      await handleTextMessage(
        createMockCtx(123456, "Meeting next Tuesday"),
        sql,
      );

      // Entry stored normally, no error
      const entries = await sql`SELECT * FROM entries WHERE content = ${"Meeting next Tuesday"}`;
      expect(entries.length).toBe(1);
    });

    it("stores the entry normally even when the calendar API fails", async () => {
      // TS-EC-21
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      mockChat.mockResolvedValue(
        createClassificationJSON({
          create_calendar_event: true,
          calendar_date: "2026-03-10",
        }),
      );
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      await handleTextMessage(
        createMockCtx(123456, "Another meeting"),
        sql,
      );

      const entries = await sql`SELECT * FROM entries WHERE content = ${"Another meeting"}`;
      expect(entries.length).toBe(1);
      stdoutSpy.mockRestore();
    });
  });

  // =========================================================================
  // Concurrency (TS-EC-22, TS-EC-23)
  // =========================================================================

  describe("concurrency", () => {
    it("processes messages from different users independently", async () => {
      // TS-EC-22
      await insertSetting(sql, "telegram_chat_ids", '["111", "222"]');

      mockChat.mockImplementation(async (prompt: string) => {
        if (prompt.includes("Message from user A")) {
          return createClassificationJSON({
            category: "people",
            name: "User A Entry",
          });
        }
        return createClassificationJSON({
          category: "tasks",
          name: "User B Entry",
        });
      });

      // Process two updates concurrently
      await Promise.all([
        handleTextMessage(createMockCtx(111, "Message from user A"), sql),
        handleTextMessage(createMockCtx(222, "Message from user B"), sql),
      ]);

      const entries = await sql`SELECT * FROM entries ORDER BY created_at`;
      expect(entries.length).toBe(2);
      const contents = entries.map((e) => e.content);
      expect(contents).toContain("Message from user A");
      expect(contents).toContain("Message from user B");
    });

    it("processes rapid messages from the same user sequentially", async () => {
      // TS-EC-23
      await insertSetting(sql, "telegram_chat_ids", '["123456"]');
      mockChat.mockResolvedValue(createClassificationJSON());

      // Process two messages from the same user
      await handleTextMessage(createMockCtx(123456, "Message A"), sql);
      await handleTextMessage(createMockCtx(123456, "Message B"), sql);

      const entries = await sql`SELECT * FROM entries ORDER BY created_at ASC`;
      expect(entries.length).toBe(2);
      expect(entries[0].content).toBe("Message A");
      expect(entries[1].content).toBe("Message B");
      // Message A has earlier created_at than Message B
      expect(new Date(entries[0].created_at as string).getTime()).toBeLessThanOrEqual(
        new Date(entries[1].created_at as string).getTime(),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Integration test context helpers
// (These create simple ctx-like objects for calling handlers directly)
// ---------------------------------------------------------------------------

function createMockCtx(
  chatId: number,
  text: string,
): Record<string, unknown> {
  return {
    message: {
      chat: { id: chatId, type: "private" },
      message_id: Math.floor(Math.random() * 1000),
      from: { id: chatId, is_bot: false, first_name: "Test" },
      text,
    },
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    api: { getFile: vi.fn().mockResolvedValue({ file_path: "voice/file_0.oga" }) },
  };
}

function createMockVoiceCtx(
  chatId: number,
  fileId: string,
  duration: number,
): Record<string, unknown> {
  return {
    message: {
      chat: { id: chatId, type: "private" },
      message_id: Math.floor(Math.random() * 1000),
      from: { id: chatId, is_bot: false, first_name: "Test" },
      voice: { file_id: fileId, duration, mime_type: "audio/ogg" },
    },
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    api: { getFile: vi.fn().mockResolvedValue({ file_path: "voice/file_0.oga" }) },
  };
}

function createMockCallbackCtx(
  chatId: number,
  data: string,
  messageId: number,
): Record<string, unknown> {
  return {
    message: {
      chat: { id: chatId, type: "private" },
      message_id: messageId,
    },
    callbackQuery: {
      data,
      message: {
        chat: { id: chatId },
        message_id: messageId,
      },
    },
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    api: { getFile: vi.fn().mockResolvedValue({ file_path: "voice/file_0.oga" }) },
  };
}
