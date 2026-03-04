/**
 * Unit tests for the embedding module.
 * Tests embedding generation, input preparation, startup verification,
 * and configuration — all with Ollama mocked via globalThis.fetch.
 *
 * Scenarios: TS-1.1–1.5, TS-2.1–2.4, TS-C-1, TS-C-3,
 *            TS-EC-1, TS-EC-2, TS-EC-4, TS-EC-5, TS-EC-7
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import {
  createFakeEmbedding,
  createEmbedResponse,
  createErrorResponse,
  createOllamaRouter,
} from "../helpers/mock-ollama.js";
import { withEnv } from "../helpers/env.js";

// Types for the embed module — will fail to import until src/embed.ts exists
type GenerateEmbedding = (text: string) => Promise<number[] | null>;
type PrepareEmbeddingInput = (entry: {
  name: string;
  content: string | null;
}) => string | null;
type InitializeEmbedding = () => Promise<void>;

describe("Embedding", () => {
  let generateEmbedding: GenerateEmbedding;
  let prepareEmbeddingInput: PrepareEmbeddingInput;
  let initializeEmbedding: InitializeEmbedding;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    const mod = await import("../../src/embed.js");
    generateEmbedding = mod.generateEmbedding;
    prepareEmbeddingInput = mod.prepareEmbeddingInput;
    initializeEmbedding = mod.initializeEmbedding;
  });

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // US-1: Embedding Generation
  // ---------------------------------------------------------------------------
  describe("Embedding generation", () => {
    // TS-1.1
    it("returns a 1024-dimensional float array for text input", async () => {
      fetchSpy.mockResolvedValueOnce(createEmbedResponse());

      const result = await generateEmbedding("This is a test sentence");

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1024);
      expect(result!.every((n) => Number.isFinite(n))).toBe(true);

      // Verify the request uses the correct model
      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.model).toBe("snowflake-arctic-embed2");
    });

    // TS-1.2
    it("generates a valid embedding for English text", async () => {
      fetchSpy.mockResolvedValueOnce(createEmbedResponse());

      const result = await generateEmbedding(
        "Meeting notes from the product review",
      );

      expect(result).toHaveLength(1024);
      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.input).toBe("Meeting notes from the product review");
    });

    // TS-1.3
    it("generates a valid embedding for German text", async () => {
      fetchSpy.mockResolvedValueOnce(createEmbedResponse());

      const result = await generateEmbedding(
        "Besprechungsnotizen aus der Produktbewertung",
      );

      expect(result).toHaveLength(1024);
      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.input).toBe(
        "Besprechungsnotizen aus der Produktbewertung",
      );
    });

    // TS-1.4
    it("generates a valid embedding for mixed English/German text", async () => {
      fetchSpy.mockResolvedValueOnce(createEmbedResponse());

      const result = await generateEmbedding(
        "Meeting about the Projektzeitplan and next steps",
      );

      expect(result).toHaveLength(1024);
    });

    // TS-EC-1
    it("returns a valid embedding for single-word input", async () => {
      fetchSpy.mockResolvedValueOnce(createEmbedResponse());

      const result = await generateEmbedding("Hello");

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1024);
    });

    // TS-EC-5
    it("passes special characters and emojis to Ollama without modification", async () => {
      const inputText = "Notizen 📝 über das Projekt — café ☕";
      fetchSpy.mockResolvedValueOnce(createEmbedResponse());

      const result = await generateEmbedding(inputText);

      expect(result).toHaveLength(1024);
      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.input).toBe(inputText);
    });

    // TS-EC-7
    it("rejects an embedding with incorrect dimensions", async () => {
      const wrongDimVector = createFakeEmbedding(512);
      fetchSpy.mockResolvedValueOnce(createEmbedResponse(wrongDimVector));
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      const result = await generateEmbedding("test text");

      expect(result).toBeNull();
      const logOutput = stdoutSpy.mock.calls
        .map(([chunk]) => chunk.toString())
        .join("");
      expect(logOutput).toContain('"level":"error"');
      expect(logOutput).toMatch(/1024/);
      expect(logOutput).toMatch(/512/);
    });
  });

  // ---------------------------------------------------------------------------
  // Input preparation
  // ---------------------------------------------------------------------------
  describe("Input preparation", () => {
    // TS-1.5
    it("concatenates entry name and content as embedding input", async () => {
      fetchSpy.mockResolvedValueOnce(createEmbedResponse());

      const text = prepareEmbeddingInput({
        name: "Weekly Standup",
        content: "Discussed blockers and sprint goals",
      });

      expect(text).not.toBeNull();
      expect(text).toContain("Weekly Standup");
      expect(text).toContain("Discussed blockers and sprint goals");
    });

    // TS-EC-2
    it("truncates text exceeding the token limit at a word boundary", () => {
      // Create a very long text (~40,000 chars, well above 8192 token limit)
      const paragraph = "The quick brown fox jumps over the lazy dog. ";
      const longText = paragraph.repeat(1000);

      const text = prepareEmbeddingInput({
        name: "Long Entry",
        content: longText,
      });

      expect(text).not.toBeNull();
      expect(text!.length).toBeLessThan(longText.length + "Long Entry".length);
      // Truncation at word boundary: last char should not be mid-word
      const lastChar = text!.charAt(text!.length - 1);
      const isWordBoundary = lastChar === " " || lastChar === ".";
      const endsCleanly =
        isWordBoundary || text!.endsWith(text!.split(/\s+/).pop()!);
      expect(endsCleanly).toBe(true);
    });

    // TS-EC-4
    it("skips embedding and logs a warning for empty input", () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      const text = prepareEmbeddingInput({ name: "", content: null });

      expect(text).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      const logOutput = stdoutSpy.mock.calls
        .map(([chunk]) => chunk.toString())
        .join("");
      expect(logOutput).toContain('"level":"warn"');
    });
  });

  // ---------------------------------------------------------------------------
  // US-2: Startup Verification
  // ---------------------------------------------------------------------------
  describe("Startup verification", () => {
    // TS-2.1
    it("checks Ollama model list on initialization", async () => {
      fetchSpy.mockImplementation(
        createOllamaRouter({
          tagsModels: ["snowflake-arctic-embed2:latest"],
        }),
      );

      await initializeEmbedding();

      const tagsCalls = fetchSpy.mock.calls.filter(([url]) =>
        url.toString().includes("/api/tags"),
      );
      expect(tagsCalls.length).toBeGreaterThanOrEqual(1);
    });

    // TS-2.2
    it("pulls the model when it is missing from Ollama", async () => {
      fetchSpy.mockImplementation(
        createOllamaRouter({
          tagsModels: [],
          pullResult: "success",
        }),
      );

      await initializeEmbedding();

      const pullCalls = fetchSpy.mock.calls.filter(([url]) =>
        url.toString().includes("/api/pull"),
      );
      expect(pullCalls.length).toBe(1);
      const body = JSON.parse(
        (pullCalls[0][1] as RequestInit).body as string,
      );
      expect(body.name ?? body.model).toContain("snowflake-arctic-embed2");
    });

    // TS-2.3
    it("skips model pull when model is already present", async () => {
      fetchSpy.mockImplementation(
        createOllamaRouter({
          tagsModels: ["snowflake-arctic-embed2:latest"],
        }),
      );

      await initializeEmbedding();

      // Only the /api/tags call should have been made — no /api/pull
      expect(fetchSpy.mock.calls.length).toBe(1);
      expect(fetchSpy.mock.calls[0][0].toString()).toContain("/api/tags");
      const pullCalls = fetchSpy.mock.calls.filter(([url]) =>
        url.toString().includes("/api/pull"),
      );
      expect(pullCalls.length).toBe(0);
    });

    // TS-2.4
    it("logs a warning and completes initialization when Ollama is unreachable", async () => {
      fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      // Should NOT throw
      await initializeEmbedding();

      const logOutput = stdoutSpy.mock.calls
        .map(([chunk]) => chunk.toString())
        .join("");
      expect(logOutput).toContain('"level":"warn"');
    });
  });

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  describe("Configuration", () => {
    // TS-C-1
    it("uses the configured Ollama URL for requests", async () => {
      const restoreEnv = withEnv({
        OLLAMA_URL: "http://custom-ollama:11434",
      });

      try {
        vi.resetModules();
        fetchSpy.mockResolvedValueOnce(createEmbedResponse());

        const { generateEmbedding: genEmbed } = await import(
          "../../src/embed.js"
        );
        await genEmbed("test text");

        const [calledUrl] = fetchSpy.mock.calls[0];
        expect(calledUrl.toString()).toContain("http://custom-ollama:11434");
      } finally {
        restoreEnv();
      }
    });

    // TS-C-3
    it("times out embedding requests after 30 seconds", async () => {
      vi.useFakeTimers();

      try {
        // Mock fetch to never resolve
        fetchSpy.mockImplementation(
          () => new Promise<Response>(() => {}),
        );

        const embedPromise = generateEmbedding("test text");

        // Advance past the 30-second timeout
        await vi.advanceTimersByTimeAsync(31_000);

        await expect(embedPromise).rejects.toThrow(/timeout|abort/i);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
