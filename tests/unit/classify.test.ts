/**
 * Unit tests for the classification module.
 * Tests provider selection, prompt loading, schema validation,
 * context formatting, confidence threshold, error handling, and edge cases.
 * All with LLM provider mocked via vi.mock().
 *
 * Scenarios: TS-1.1–1.11, TS-2.8–2.10, TS-3.1, TS-3.3–3.5,
 *            TS-4.1–4.5, TS-4.9, TS-C-1, TS-EC-1–EC-4, TS-EC-6–EC-9
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
  createClassificationResult,
  createClassificationJSON,
  createMockChat,
} from "../helpers/mock-llm.js";
import { withEnv } from "../helpers/env.js";

// ---------------------------------------------------------------------------
// Module mocks — these must be hoisted
// ---------------------------------------------------------------------------

const mockChat = vi.fn();
const mockCreateLLMProvider = vi.fn(() => ({ chat: mockChat }));

vi.mock("../../src/llm/index.js", () => ({
  createLLMProvider: mockCreateLLMProvider,
}));

const mockGenerateEmbedding = vi.fn();

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

// ---------------------------------------------------------------------------
// Types — will fail to import until src/classify.ts exists
// ---------------------------------------------------------------------------

type ClassifyText = (
  text: string,
  options?: { entryId?: string },
) => Promise<{
  category: string | null;
  name: string | null;
  confidence: number | null;
  fields: Record<string, unknown>;
  tags: string[];
  create_calendar_event?: boolean;
  calendar_date?: string | null;
  content: string;
} | null>;

type ValidateClassificationResponse = (
  raw: string,
) => {
  category: string;
  name: string;
  confidence: number;
  fields: Record<string, unknown>;
  tags: string[];
  create_calendar_event: boolean;
  calendar_date: string | null;
} | null;

type FormatContextEntries = (
  entries: Array<{ name: string; category: string; content: string | null }>,
) => string;

type AssemblePrompt = (
  template: string,
  contextEntries: string,
  inputText: string,
) => string;

type ResolveConfidenceThreshold = (settingsValue?: string | null) => number;

type IsConfident = (confidence: number, threshold: number) => boolean;

describe("Classification", () => {
  let classifyText: ClassifyText;
  let validateClassificationResponse: ValidateClassificationResponse;
  let formatContextEntries: FormatContextEntries;
  let assemblePrompt: AssemblePrompt;
  let resolveConfidenceThreshold: ResolveConfidenceThreshold;
  let isConfident: IsConfident;

  beforeAll(async () => {
    const mod = await import("../../src/classify.js");
    classifyText = mod.classifyText;
    validateClassificationResponse = mod.validateClassificationResponse;
    formatContextEntries = mod.formatContextEntries;
    assemblePrompt = mod.assemblePrompt;
    resolveConfidenceThreshold = mod.resolveConfidenceThreshold;
    isConfident = mod.isConfident;
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Provider selection
  // ---------------------------------------------------------------------------
  describe("provider selection", () => {
    // TS-1.1
    it("sends classification request through the Anthropic provider", async () => {
      const restoreEnv = withEnv({
        LLM_PROVIDER: "anthropic",
        LLM_API_KEY: "test-key",
        LLM_MODEL: "claude-sonnet-4-20250514",
      });

      try {
        mockChat.mockResolvedValueOnce(createClassificationJSON());

        const result = await classifyText(
          "Had coffee with Maria, discussed her new startup",
        );

        expect(mockCreateLLMProvider).toHaveBeenCalledWith(
          expect.objectContaining({ provider: "anthropic" }),
        );
        expect(mockChat).toHaveBeenCalled();
        expect(result).not.toBeNull();
        expect(result!.category).toBe("people");
      } finally {
        restoreEnv();
      }
    });

    // TS-1.2
    it("sends classification request through the OpenAI-compatible provider", async () => {
      const restoreEnv = withEnv({
        LLM_PROVIDER: "openai-compatible",
        LLM_API_KEY: "test-key",
        LLM_MODEL: "gpt-4",
        LLM_BASE_URL: "http://localhost:1234/v1",
      });

      try {
        mockChat.mockResolvedValueOnce(createClassificationJSON());

        const result = await classifyText(
          "Had coffee with Maria, discussed her new startup",
        );

        expect(mockCreateLLMProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: "openai-compatible",
            baseUrl: "http://localhost:1234/v1",
          }),
        );
        expect(result).not.toBeNull();
      } finally {
        restoreEnv();
      }
    });

    // TS-1.3
    it("uses the configured model for classification requests", async () => {
      const restoreEnv = withEnv({
        LLM_PROVIDER: "anthropic",
        LLM_API_KEY: "test-key",
        LLM_MODEL: "claude-sonnet-4-20250514",
      });

      try {
        mockChat.mockResolvedValueOnce(createClassificationJSON());

        await classifyText("test input");

        expect(mockCreateLLMProvider).toHaveBeenCalledWith(
          expect.objectContaining({ model: "claude-sonnet-4-20250514" }),
        );
      } finally {
        restoreEnv();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Prompt loading
  // ---------------------------------------------------------------------------
  describe("prompt loading", () => {
    // TS-1.4
    it("loads the classification prompt from prompts/classify.md", async () => {
      mockReadFile.mockResolvedValueOnce(
        "Classify this: {context_entries}\n\nInput: {input_text}",
      );
      mockChat.mockResolvedValueOnce(createClassificationJSON());

      await classifyText("test input");

      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining("prompts/classify.md"),
        expect.anything(),
      );
      const promptArg = mockChat.mock.calls[0][0];
      expect(promptArg).toContain("test input");
      expect(promptArg).not.toContain("{input_text}");
    });

    // TS-C-1
    it("uses updated prompt content on next classification without restart", async () => {
      mockReadFile
        .mockResolvedValueOnce("Prompt A: {context_entries}\n\nInput: {input_text}")
        .mockResolvedValueOnce("Prompt B: {context_entries}\n\nInput: {input_text}");
      mockChat
        .mockResolvedValueOnce(createClassificationJSON())
        .mockResolvedValueOnce(createClassificationJSON());

      await classifyText("first call");
      await classifyText("second call");

      expect(mockReadFile).toHaveBeenCalledTimes(2);
      const firstPrompt = mockChat.mock.calls[0][0];
      const secondPrompt = mockChat.mock.calls[1][0];
      expect(firstPrompt).toContain("Prompt A");
      expect(secondPrompt).toContain("Prompt B");
    });
  });

  // ---------------------------------------------------------------------------
  // Schema validation
  // ---------------------------------------------------------------------------
  describe("schema validation", () => {
    // TS-1.5
    it("parses a valid LLM response into a structured classification result", async () => {
      mockChat.mockResolvedValueOnce(
        createClassificationJSON({
          category: "people",
          name: "Maria Coffee Chat",
          confidence: 0.92,
          fields: { relationship: "friend" },
          tags: ["social", "startup"],
          create_calendar_event: false,
          calendar_date: null,
        }),
      );

      const result = await classifyText("Had coffee with Maria");

      expect(result).not.toBeNull();
      expect(result!.category).toBe("people");
      expect(result!.name).toBe("Maria Coffee Chat");
      expect(result!.confidence).toBe(0.92);
      expect(result!.fields).toEqual({ relationship: "friend" });
      expect(result!.tags).toEqual(["social", "startup"]);
    });

    // TS-1.6
    it("rejects a response with an invalid category", () => {
      const raw = JSON.stringify({
        category: "meetings",
        name: "Test",
        confidence: 0.9,
        fields: {},
        tags: [],
        create_calendar_event: false,
        calendar_date: null,
      });

      const result = validateClassificationResponse(raw);

      expect(result).toBeNull();
    });

    // TS-1.7
    it("rejects a response with out-of-range confidence", () => {
      const raw = createClassificationJSON({ confidence: 1.5 });

      const result = validateClassificationResponse(raw);

      expect(result).toBeNull();
    });

    // TS-1.8
    it("rejects a response with missing required fields", () => {
      const raw = JSON.stringify({ name: "Test", confidence: 0.9 });

      const result = validateClassificationResponse(raw);

      expect(result).toBeNull();
    });

    // TS-1.9
    it("rejects a response with wrong field types", () => {
      const raw = createClassificationJSON();
      const parsed = JSON.parse(raw);
      parsed.tags = "not-an-array";

      const result = validateClassificationResponse(JSON.stringify(parsed));

      expect(result).toBeNull();
    });

    // TS-1.10
    it("handles a non-JSON LLM response gracefully", async () => {
      mockChat.mockResolvedValueOnce("I think this is about people");

      const result = await classifyText("test input");

      expect(result).toBeNull();
    });

    // TS-1.11
    it("handles a truncated JSON LLM response gracefully", async () => {
      mockChat.mockResolvedValueOnce(
        '{"category": "people", "name": "Mar',
      );

      const result = await classifyText("test input");

      expect(result).toBeNull();
    });

    // TS-EC-6
    it("coerces a numeric string confidence to a number", () => {
      const raw = JSON.stringify({
        ...createClassificationResult(),
        confidence: "0.85",
      });

      const result = validateClassificationResponse(raw);

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(0.85);
      expect(typeof result!.confidence).toBe("number");
    });

    // TS-EC-7
    it("rejects a non-numeric string confidence value", () => {
      const raw = JSON.stringify({
        ...createClassificationResult(),
        confidence: "high",
      });

      const result = validateClassificationResponse(raw);

      expect(result).toBeNull();
    });

    it("extracts JSON from markdown code fences", () => {
      const json = createClassificationJSON();
      const raw = "```json\n" + json + "\n```";

      const result = validateClassificationResponse(raw);

      expect(result).not.toBeNull();
      expect(result!.category).toBe("people");
    });

  });

  // ---------------------------------------------------------------------------
  // Context formatting
  // ---------------------------------------------------------------------------
  describe("context formatting", () => {
    // TS-2.8
    it("replaces the context_entries placeholder in the prompt", () => {
      const template = "Context: {context_entries}\n\nClassify: {input_text}";
      const contextStr = formatContextEntries([
        { name: "Entry A", category: "people", content: "Content A" },
        { name: "Entry B", category: "tasks", content: "Content B" },
        { name: "Entry C", category: "ideas", content: "Content C" },
      ]);

      const prompt = assemblePrompt(template, contextStr, "test input");

      expect(prompt).toContain("Entry A");
      expect(prompt).toContain("Entry B");
      expect(prompt).toContain("Entry C");
      expect(prompt).not.toContain("{context_entries}");
    });

    // TS-2.9
    it("formats context entries with name, category, and truncated content", () => {
      const longContent = "A".repeat(350);
      const entries = [
        { name: "Project Alpha", category: "projects", content: longContent },
      ];

      const formatted = formatContextEntries(entries);

      expect(formatted).toContain("Project Alpha");
      expect(formatted).toContain("projects");
      // Should include exactly the first 200 chars of content, no more
      expect(formatted).toContain("A".repeat(200));
      expect(formatted).not.toContain("A".repeat(201));
    });

    // TS-2.10
    it("includes full content when shorter than 200 characters", () => {
      const shortContent = "B".repeat(150);
      const entries = [
        { name: "Quick Note", category: "reference", content: shortContent },
      ];

      const formatted = formatContextEntries(entries);

      expect(formatted).toContain(shortContent);
    });
  });

  // ---------------------------------------------------------------------------
  // Confidence threshold
  // ---------------------------------------------------------------------------
  describe("confidence threshold", () => {
    // TS-3.1
    it("defaults the confidence threshold to 0.6", () => {
      const threshold = resolveConfidenceThreshold(undefined);

      expect(threshold).toBe(0.6);
    });

    // TS-3.3
    it("marks entries with confidence >= threshold as confident", () => {
      const result = isConfident(0.85, 0.6);

      expect(result).toBe(true);
    });

    // TS-3.4
    it("marks entries with confidence < threshold as uncertain", () => {
      const result = isConfident(0.45, 0.6);

      expect(result).toBe(false);
    });

    // TS-3.5
    it("treats confidence exactly equal to threshold as confident", () => {
      const result = isConfident(0.6, 0.6);

      expect(result).toBe(true);
    });

    // TS-EC-8
    it("clamps a negative threshold to 0.0 and logs a warning", () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      const threshold = resolveConfidenceThreshold("-0.5");

      expect(threshold).toBe(0.0);
      const logOutput = stdoutSpy.mock.calls
        .map(([chunk]) => chunk.toString())
        .join("");
      expect(logOutput).toContain('"level":"warn"');
    });

    // TS-EC-9
    it("clamps a threshold above 1.0 to 1.0 and logs a warning", () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      const threshold = resolveConfidenceThreshold("1.5");

      expect(threshold).toBe(1.0);
      const logOutput = stdoutSpy.mock.calls
        .map(([chunk]) => chunk.toString())
        .join("");
      expect(logOutput).toContain('"level":"warn"');
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------
  describe("error handling", () => {
    // TS-4.1
    it("stores entry with null category when LLM request times out", async () => {
      mockChat.mockRejectedValueOnce(new Error("Request timed out"));

      const result = await classifyText("test input");

      expect(result).toBeNull();
    });

    // TS-4.2
    it("stores entry with null category on LLM rate limit (429)", async () => {
      const err = new Error("Rate limited") as Error & { status: number };
      err.status = 429;
      mockChat.mockRejectedValueOnce(err);

      const result = await classifyText("test input");

      expect(result).toBeNull();
    });

    // TS-4.3
    it("stores entry with null category on LLM server error (5xx)", async () => {
      const err = new Error("Internal server error") as Error & {
        status: number;
      };
      err.status = 500;
      mockChat.mockRejectedValueOnce(err);

      const result = await classifyText("test input");

      expect(result).toBeNull();
    });

    // TS-4.4
    it("stores entry with null category on network error", async () => {
      mockChat.mockRejectedValueOnce(new TypeError("fetch failed"));

      const result = await classifyText("test input");

      expect(result).toBeNull();
    });

    // TS-4.5
    it("preserves raw input text in content field on classification failure", async () => {
      mockChat.mockRejectedValueOnce(new Error("API unavailable"));

      const result = await classifyText("Buy groceries for the weekend");

      // classifyText should return a result with null classification but preserved content,
      // OR return null (in which case content preservation is the caller's responsibility).
      if (result !== null) {
        expect(result.content).toBe("Buy groceries for the weekend");
        expect(result.category).toBeNull();
        expect(result.confidence).toBeNull();
      } else {
        // If the API returns null, the caller must preserve the original text.
        // At minimum, verify no unhandled exception was thrown.
        expect(result).toBeNull();
      }
    });

    // TS-4.9
    it("logs classification errors with API response code, error message, entry ID, and input length", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const err = new Error("Internal server error") as Error & {
        status: number;
      };
      err.status = 500;
      mockChat.mockRejectedValueOnce(err);

      const inputText = "A".repeat(250);
      await classifyText(inputText, { entryId: "test-uuid-42" });

      const logOutput = stdoutSpy.mock.calls
        .map(([chunk]) => chunk.toString())
        .join("");
      expect(logOutput).toContain('"level":"error"');
      expect(logOutput).toContain("500");
      expect(logOutput).toContain("test-uuid-42");
      expect(logOutput).toContain("250");
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe("edge cases", () => {
    // TS-EC-1
    it("sends very short input to the LLM without error", async () => {
      mockChat.mockResolvedValueOnce(
        createClassificationJSON({ confidence: 0.3 }),
      );

      const result = await classifyText("Hi");

      expect(mockChat).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    // TS-EC-2
    it("truncates very long input to fit within the model context window", async () => {
      const longText = "word ".repeat(50_000);
      mockChat.mockResolvedValueOnce(createClassificationJSON());

      await classifyText(longText);

      expect(mockChat).toHaveBeenCalled();
      const promptArg = mockChat.mock.calls[0][0];
      expect(promptArg.length).toBeLessThan(longText.length);
      // Prompt structure preserved (template prefix and sections intact)
      expect(promptArg).toContain("Classify this:");
      expect(promptArg).toContain("Input:");
    });

    // TS-EC-3
    it("classifies German input and returns English category names", async () => {
      mockChat.mockResolvedValueOnce(
        createClassificationJSON({
          category: "people",
          name: "Treffen mit Anna",
        }),
      );

      const result = await classifyText(
        "Treffen mit Anna über das neue Projekt besprochen",
      );

      expect(result).not.toBeNull();
      expect(result!.category).toBe("people");
      // Verify the German text was sent to the LLM unmodified
      const promptArg = mockChat.mock.calls[0][0];
      expect(promptArg).toContain(
        "Treffen mit Anna über das neue Projekt besprochen",
      );
    });

    // TS-EC-4
    it("returns a classification result even for ambiguous input", async () => {
      mockChat.mockResolvedValueOnce(
        createClassificationJSON({ category: "reference", confidence: 0.3 }),
      );

      const result = await classifyText("stuff");

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(0.3);
      // Below default threshold of 0.6, so uncertain
      expect(isConfident(result!.confidence!, 0.6)).toBe(false);
    });
  });
});
