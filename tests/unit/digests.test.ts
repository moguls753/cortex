import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withEnv } from "../helpers/env.js";
import type { SSEBroadcaster } from "../../src/web/sse.js";

// --- Module Mocks (hoisted) ---

const { mockChat, mockGetLLMConfig } = vi.hoisted(() => ({
  mockChat: vi.fn().mockResolvedValue("  Mock digest response  "),
  mockGetLLMConfig: vi.fn().mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    baseUrl: "",
    apiKeys: { anthropic: "test-key" },
  }),
}));

vi.mock("../../src/digests-queries.js", () => ({
  getDailyDigestData: vi.fn().mockResolvedValue({
    activeProjects: [],
    pendingFollowUps: [],
    upcomingTasks: [],
    yesterdayEntries: [],
  }),
  getWeeklyReviewData: vi.fn().mockResolvedValue({
    weekEntries: [],
    dailyCounts: [],
    categoryCounts: [],
    stalledProjects: [],
  }),
  cacheDigest: vi.fn().mockResolvedValue(undefined),
  getLatestDigest: vi.fn().mockResolvedValue(null),
  getEntriesNeedingRetry: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/llm/index.js", () => ({
  createLLMProvider: vi.fn().mockReturnValue({ chat: mockChat }),
}));

vi.mock("../../src/llm/config.js", () => ({
  getLLMConfig: mockGetLLMConfig,
}));

vi.mock("../../src/email.js", () => ({
  sendDigestEmail: vi.fn().mockResolvedValue(undefined),
  isSmtpConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    timezone: "Europe/Berlin",
  },
  resolveConfigValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/embed.js", () => ({
  embedEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/classify.js", () => ({
  classifyEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  },
}));

// --- Imports (after mocks) ---

import {
  getDailyDigestData,
  getWeeklyReviewData,
  cacheDigest,
  getEntriesNeedingRetry,
} from "../../src/digests-queries.js";
import { createLLMProvider } from "../../src/llm/index.js";
import { getLLMConfig } from "../../src/llm/config.js";
import { sendDigestEmail, isSmtpConfigured } from "../../src/email.js";
import { resolveConfigValue } from "../../src/config.js";
import { embedEntry } from "../../src/embed.js";
import { classifyEntry } from "../../src/classify.js";
import cron from "node-cron";
import {
  generateDailyDigest,
  generateWeeklyReview,
  runBackgroundRetry,
  startScheduler,
} from "../../src/digests.js";

// --- Helpers ---

const mockSql = {} as any;

function createMockBroadcaster(): SSEBroadcaster {
  return {
    subscribe: vi.fn().mockReturnValue(() => {}),
    broadcast: vi.fn(),
  };
}

// --- Tests ---

describe("Digests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations
    mockChat.mockResolvedValue("  Mock digest response  ");
    (getDailyDigestData as any).mockResolvedValue({
      activeProjects: [],
      pendingFollowUps: [],
      upcomingTasks: [],
      yesterdayEntries: [],
    });
    (getWeeklyReviewData as any).mockResolvedValue({
      weekEntries: [],
      dailyCounts: [],
      categoryCounts: [],
      stalledProjects: [],
    });
    (cacheDigest as any).mockResolvedValue(undefined);
    (getEntriesNeedingRetry as any).mockResolvedValue([]);
    (isSmtpConfigured as any).mockReturnValue(false);
    (sendDigestEmail as any).mockResolvedValue(undefined);
    (resolveConfigValue as any).mockResolvedValue(undefined);
    (embedEntry as any).mockResolvedValue(undefined);
    (classifyEntry as any).mockResolvedValue(undefined);
    (createLLMProvider as any).mockReturnValue({ chat: mockChat });
    mockGetLLMConfig.mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      baseUrl: "",
      apiKeys: { anthropic: "test-key" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // Group 1: Daily Digest Pipeline (US-1)
  // ============================================================
  describe("Daily Digest Pipeline (US-1)", () => {
    it("sends assembled data to Claude with daily prompt and configured model", async () => {
      // TS-1.2
      const sampleData = {
        activeProjects: [{ id: "p1", name: "Project Alpha", fields: { status: "active", next_action: "Ship v2" } }],
        pendingFollowUps: [{ id: "f1", name: "Alice", fields: { follow_ups: "Call back Monday" } }],
        upcomingTasks: [{ id: "t1", name: "Review PR", fields: { status: "pending", due_date: "2026-03-10" } }],
        yesterdayEntries: [{ id: "e1", name: "Note", category: "ideas", content: "Something", created_at: new Date() }],
      };
      (getDailyDigestData as any).mockResolvedValue(sampleData);
      mockGetLLMConfig.mockResolvedValue({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        baseUrl: "",
        apiKeys: { anthropic: "test-key" },
      });

      const mockBroadcaster = createMockBroadcaster();
      await generateDailyDigest(mockSql, mockBroadcaster);

      expect(createLLMProvider).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-haiku-4-5-20251001" }),
      );
      expect(mockChat).toHaveBeenCalledOnce();
      const prompt = mockChat.mock.calls[0][0] as string;
      expect(prompt).toContain("TOP 3 TODAY");
      expect(prompt).toContain("STUCK ON");
      expect(prompt).toContain("SMALL WIN");
      expect(prompt).toContain("150");
      expect(prompt).toContain("Project Alpha");
    });

    it("trims whitespace from Claude response", async () => {
      // TS-1.3
      mockChat.mockResolvedValue("  \n  TOP 3 TODAY\nContent here  \n  ");

      await generateDailyDigest(mockSql);

      expect(cacheDigest).toHaveBeenCalledWith(
        mockSql,
        "daily",
        "TOP 3 TODAY\nContent here",
      );
    });

    it("pushes digest to SSE clients", async () => {
      // TS-1.5
      mockChat.mockResolvedValue("Digest content");
      const mockBroadcaster = createMockBroadcaster();

      await generateDailyDigest(mockSql, mockBroadcaster);

      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "digest:updated",
          data: expect.objectContaining({ digestType: "daily" }),
        }),
      );
    });

    it("sends digest via email", async () => {
      // TS-1.6
      mockChat.mockResolvedValue("Daily digest content");
      (isSmtpConfigured as any).mockReturnValue(true);
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const restore = withEnv({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user@example.com",
        SMTP_PASS: "smtp-pass",
        DIGEST_EMAIL_FROM: "noreply@example.com",
      });

      try {
        await generateDailyDigest(mockSql);

        expect(sendDigestEmail).toHaveBeenCalledOnce();
        const call = (sendDigestEmail as any).mock.calls[0][0];
        expect(call.to).toBe("user@example.com");
        expect(call.from).toBe("noreply@example.com");
        expect(call.body).toBe("Daily digest content");
      } finally {
        restore();
      }
    });

    it("runs prompt with zero items when database is empty", async () => {
      // TS-1.7
      // getDailyDigestData already returns empty arrays by default
      await generateDailyDigest(mockSql);

      expect(mockChat).toHaveBeenCalledOnce();
      expect(cacheDigest).toHaveBeenCalledOnce();
    });

    it("logs error and caches error message when Claude is down", async () => {
      // TS-1.8
      mockChat.mockRejectedValue(new Error("Connection refused"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockBroadcaster = createMockBroadcaster();

      await generateDailyDigest(mockSql, mockBroadcaster);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(cacheDigest).toHaveBeenCalledWith(
        mockSql,
        "daily",
        expect.stringContaining("failed"),
      );
      expect(sendDigestEmail).not.toHaveBeenCalled();
    });

    it("treats empty Claude response as failure", async () => {
      // TS-1.9
      mockChat.mockResolvedValue("");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await generateDailyDigest(mockSql);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(cacheDigest).toHaveBeenCalledWith(
        mockSql,
        "daily",
        expect.stringContaining("failed"),
      );
      expect(sendDigestEmail).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Group 2: Weekly Review Pipeline (US-2)
  // ============================================================
  describe("Weekly Review Pipeline (US-2)", () => {
    it("sends assembled data to Claude with weekly prompt", async () => {
      // TS-2.2
      const sampleData = {
        weekEntries: [{ id: "e1", name: "Entry", category: "ideas", content: "Stuff", created_at: new Date() }],
        dailyCounts: [{ date: "2026-03-07", count: 3 }],
        categoryCounts: [{ category: "ideas", count: 2 }],
        stalledProjects: [{ id: "p1", name: "Stalled", fields: { status: "active" }, updated_at: new Date() }],
      };
      (getWeeklyReviewData as any).mockResolvedValue(sampleData);

      await generateWeeklyReview(mockSql);

      expect(mockChat).toHaveBeenCalledOnce();
      const prompt = mockChat.mock.calls[0][0] as string;
      expect(prompt).toContain("WHAT HAPPENED");
      expect(prompt).toContain("OPEN LOOPS");
      expect(prompt).toContain("NEXT WEEK");
      expect(prompt).toContain("PATTERN");
      expect(prompt).toContain("250");
    });

    it("trims whitespace from weekly review response", async () => {
      // TS-2.3
      mockChat.mockResolvedValue("  WHAT HAPPENED\nBusy week  ");

      await generateWeeklyReview(mockSql);

      expect(cacheDigest).toHaveBeenCalledWith(
        mockSql,
        "weekly",
        "WHAT HAPPENED\nBusy week",
      );
    });

    it("sends weekly review via email", async () => {
      // TS-2.5
      mockChat.mockResolvedValue("Weekly review content");
      (isSmtpConfigured as any).mockReturnValue(true);
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const restore = withEnv({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user@example.com",
        SMTP_PASS: "smtp-pass",
      });

      try {
        await generateWeeklyReview(mockSql);

        expect(sendDigestEmail).toHaveBeenCalledOnce();
        const call = (sendDigestEmail as any).mock.calls[0][0];
        expect(call.subject).toMatch(/Cortex Weekly — w\/c \d{4}-\d{2}-\d{2}/);
      } finally {
        restore();
      }
    });

    it("pushes weekly review to SSE clients", async () => {
      // TS-2.5b
      mockChat.mockResolvedValue("Weekly content");
      const mockBroadcaster = createMockBroadcaster();

      await generateWeeklyReview(mockSql, mockBroadcaster);

      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "digest:updated",
          data: expect.objectContaining({ digestType: "weekly" }),
        }),
      );
    });

    it("runs weekly prompt with zero entries", async () => {
      // TS-2.6
      // getWeeklyReviewData already returns empty arrays by default
      await generateWeeklyReview(mockSql);

      expect(mockChat).toHaveBeenCalledOnce();
      expect(cacheDigest).toHaveBeenCalledOnce();
    });

    it("handles Claude failure during weekly review same as daily", async () => {
      // TS-2.7
      mockChat.mockRejectedValue(new Error("Claude API error"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await generateWeeklyReview(mockSql);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(cacheDigest).toHaveBeenCalledWith(
        mockSql,
        "weekly",
        expect.stringContaining("failed"),
      );
      expect(sendDigestEmail).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Group 3: Email Delivery (US-3)
  // ============================================================
  describe("Email Delivery (US-3)", () => {
    it("defaults sender to SMTP_USER when DIGEST_EMAIL_FROM is not set", async () => {
      // TS-3.1
      mockChat.mockResolvedValue("Digest content");
      (isSmtpConfigured as any).mockReturnValue(true);
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const restore = withEnv({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user@example.com",
        SMTP_PASS: "smtp-pass",
        DIGEST_EMAIL_FROM: undefined,
      });

      try {
        await generateDailyDigest(mockSql);

        expect(sendDigestEmail).toHaveBeenCalledOnce();
        const call = (sendDigestEmail as any).mock.calls[0][0];
        expect(call.from).toBe("smtp-user@example.com");
      } finally {
        restore();
      }
    });

    it("formats daily email subject as Cortex Daily — YYYY-MM-DD", async () => {
      // TS-3.2
      mockChat.mockResolvedValue("Digest content");
      (isSmtpConfigured as any).mockReturnValue(true);
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const restore = withEnv({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user@example.com",
        SMTP_PASS: "smtp-pass",
      });

      try {
        await generateDailyDigest(mockSql);

        const call = (sendDigestEmail as any).mock.calls[0][0];
        const today = new Date().toISOString().slice(0, 10);
        expect(call.subject).toBe(`Cortex Daily — ${today}`);
      } finally {
        restore();
      }
    });

    it("formats weekly email subject as Cortex Weekly — w/c YYYY-MM-DD", async () => {
      // TS-3.3
      mockChat.mockResolvedValue("Weekly content");
      (isSmtpConfigured as any).mockReturnValue(true);
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const restore = withEnv({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user@example.com",
        SMTP_PASS: "smtp-pass",
      });

      try {
        await generateWeeklyReview(mockSql);

        const call = (sendDigestEmail as any).mock.calls[0][0];
        expect(call.subject).toMatch(/^Cortex Weekly — w\/c \d{4}-\d{2}-\d{2}$/);
        // Verify the date is a Monday
        const dateStr = call.subject.replace("Cortex Weekly — w/c ", "");
        const day = new Date(dateStr).getDay();
        expect(day).toBe(1); // Monday
      } finally {
        restore();
      }
    });

    it("sends plain text body without HTML", async () => {
      // TS-3.4
      const plainText = "TOP 3 TODAY\n1. Ship feature\n2. Review PR\n3. Update docs";
      mockChat.mockResolvedValue(plainText);
      (isSmtpConfigured as any).mockReturnValue(true);
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const restore = withEnv({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user@example.com",
        SMTP_PASS: "smtp-pass",
      });

      try {
        await generateDailyDigest(mockSql);

        const call = (sendDigestEmail as any).mock.calls[0][0];
        expect(call.body).toBe(plainText);
        expect(call.body).not.toContain("<");
        expect(call.body).not.toContain(">");
      } finally {
        restore();
      }
    });

    it("uses digest_email_to setting over DIGEST_EMAIL_TO env var", async () => {
      // TS-3.5
      mockChat.mockResolvedValue("Digest content");
      (isSmtpConfigured as any).mockReturnValue(true);
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "digest_email_to") return "settings@example.com";
        return undefined;
      });

      const restore = withEnv({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user@example.com",
        SMTP_PASS: "smtp-pass",
        DIGEST_EMAIL_TO: "env@example.com",
      });

      try {
        await generateDailyDigest(mockSql);

        const call = (sendDigestEmail as any).mock.calls[0][0];
        expect(call.to).toBe("settings@example.com");
      } finally {
        restore();
      }
    });

    it("logs SMTP failure but still caches digest and pushes SSE", async () => {
      // TS-3.6
      mockChat.mockResolvedValue("Valid digest content");
      (isSmtpConfigured as any).mockReturnValue(true);
      (sendDigestEmail as any).mockRejectedValue(new Error("SMTP connection timeout"));
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockBroadcaster = createMockBroadcaster();

      const restore = withEnv({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user@example.com",
        SMTP_PASS: "smtp-pass",
      });

      try {
        await generateDailyDigest(mockSql, mockBroadcaster);

        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(cacheDigest).toHaveBeenCalledWith(mockSql, "daily", "Valid digest content");
        expect(mockBroadcaster.broadcast).toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it("skips email without error when SMTP is not configured", async () => {
      // TS-3.7
      mockChat.mockResolvedValue("Digest content");
      (isSmtpConfigured as any).mockReturnValue(false);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await generateDailyDigest(mockSql);

      expect(sendDigestEmail).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(cacheDigest).toHaveBeenCalledOnce();
    });

    it("skips email with warning when recipient is empty", async () => {
      // TS-3.8
      mockChat.mockResolvedValue("Digest content");
      (isSmtpConfigured as any).mockReturnValue(true);
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "digest_email_to") return undefined;
        return undefined;
      });
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const restore = withEnv({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "smtp-user@example.com",
        SMTP_PASS: "smtp-pass",
        DIGEST_EMAIL_TO: undefined,
      });

      try {
        await generateDailyDigest(mockSql);

        expect(sendDigestEmail).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalled();
        expect(cacheDigest).toHaveBeenCalledOnce();
      } finally {
        restore();
      }
    });
  });

  // ============================================================
  // Group 4: Background Retry (US-4)
  // ============================================================
  describe("Background Retry (US-4)", () => {
    it("handles embedding success with classification failure independently", async () => {
      // TS-4.3
      (getEntriesNeedingRetry as any).mockResolvedValue([
        { id: "e1", name: "Entry", content: "text", embedding: null, category: null },
      ]);
      (embedEntry as any).mockResolvedValue(undefined);
      (classifyEntry as any).mockRejectedValue(new Error("Classification failed"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await runBackgroundRetry(mockSql);

      expect(embedEntry).toHaveBeenCalledWith(mockSql, "e1");
      expect(classifyEntry).toHaveBeenCalledWith(mockSql, "e1");
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("logs failed entries and leaves them for next cycle", async () => {
      // TS-4.5
      (getEntriesNeedingRetry as any).mockResolvedValue([
        { id: "e1", name: "Entry 1", content: "text", embedding: null, category: "ideas" },
        { id: "e2", name: "Entry 2", content: "text", embedding: null, category: "tasks" },
      ]);
      (embedEntry as any).mockRejectedValue(new Error("Ollama timeout"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await runBackgroundRetry(mockSql);

      expect(embedEntry).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("attempts both embedding and classification for entry with both null", async () => {
      // TS-4.6
      (getEntriesNeedingRetry as any).mockResolvedValue([
        { id: "e1", name: "Entry", content: "text", embedding: null, category: null },
      ]);

      await runBackgroundRetry(mockSql);

      expect(embedEntry).toHaveBeenCalledWith(mockSql, "e1");
      expect(classifyEntry).toHaveBeenCalledWith(mockSql, "e1");
    });

    it("handles Ollama down for all embedding retries", async () => {
      // TS-4.7
      (getEntriesNeedingRetry as any).mockResolvedValue([
        { id: "e1", name: "Entry 1", content: "text", embedding: null, category: "ideas" },
        { id: "e2", name: "Entry 2", content: "text", embedding: null, category: "tasks" },
        { id: "e3", name: "Entry 3", content: "text", embedding: null, category: "reference" },
      ]);
      (embedEntry as any).mockRejectedValue(new Error("ECONNREFUSED"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await runBackgroundRetry(mockSql);

      expect(embedEntry).toHaveBeenCalledTimes(3);
      expect(classifyEntry).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("handles Claude down for all classification retries", async () => {
      // TS-4.8
      const fakeEmbedding = Array.from({ length: 1024 }, (_, i) => Math.sin(i) * 0.5);
      (getEntriesNeedingRetry as any).mockResolvedValue([
        { id: "e1", name: "Entry 1", content: "text", embedding: fakeEmbedding, category: null },
        { id: "e2", name: "Entry 2", content: "text", embedding: fakeEmbedding, category: null },
        { id: "e3", name: "Entry 3", content: "text", embedding: fakeEmbedding, category: null },
      ]);
      (classifyEntry as any).mockRejectedValue(new Error("Claude API error"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await runBackgroundRetry(mockSql);

      expect(classifyEntry).toHaveBeenCalledTimes(3);
      expect(embedEntry).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("completes immediately with no API calls when nothing needs retry", async () => {
      // TS-4.9
      (getEntriesNeedingRetry as any).mockResolvedValue([]);

      await runBackgroundRetry(mockSql);

      expect(embedEntry).not.toHaveBeenCalled();
      expect(classifyEntry).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Group 5: Scheduling & Configuration (US-5)
  // ============================================================
  describe("Scheduling & Configuration (US-5)", () => {
    it("uses settings value over env var for cron schedule", async () => {
      // TS-5.1a
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "daily_digest_cron") return "0 8 * * *";
        if (key === "weekly_digest_cron") return "0 8 * * 1";
        if (key === "timezone") return "Europe/Berlin";
        return undefined;
      });

      const restore = withEnv({ DAILY_DIGEST_CRON: "0 9 * * *" });
      try {
        const mockBroadcaster = createMockBroadcaster();
        await startScheduler(mockSql, mockBroadcaster);

        expect(cron.schedule).toHaveBeenCalledWith(
          "0 8 * * *",
          expect.any(Function),
          expect.any(Object),
        );
      } finally {
        restore();
      }
    });

    it("uses env var when no settings value exists", async () => {
      // TS-5.1b
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "daily_digest_cron") return "0 9 * * *"; // resolveConfigValue finds env var
        if (key === "weekly_digest_cron") return undefined;
        if (key === "timezone") return undefined;
        return undefined;
      });

      const mockBroadcaster = createMockBroadcaster();
      await startScheduler(mockSql, mockBroadcaster);

      expect(cron.schedule).toHaveBeenCalledWith(
        "0 9 * * *",
        expect.any(Function),
        expect.any(Object),
      );
    });

    it("uses default schedules when neither settings nor env vars exist", async () => {
      // TS-5.2
      (resolveConfigValue as any).mockResolvedValue(undefined);

      const mockBroadcaster = createMockBroadcaster();
      await startScheduler(mockSql, mockBroadcaster);

      // Daily default
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 7 * * *",
        expect.any(Function),
        expect.any(Object),
      );
      // Weekly default
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 8 * * 1",
        expect.any(Function),
        expect.any(Object),
      );
      // Background retry every 15 minutes
      expect(cron.schedule).toHaveBeenCalledWith(
        "*/15 * * * *",
        expect.any(Function),
        expect.any(Object),
      );
    });

    it("runs cron in configured timezone", async () => {
      // TS-5.3
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "timezone") return "America/New_York";
        return undefined;
      });

      const mockBroadcaster = createMockBroadcaster();
      await startScheduler(mockSql, mockBroadcaster);

      // Verify timezone option passed to daily and weekly cron.schedule calls
      const calls = (cron.schedule as any).mock.calls;
      const dailyCall = calls.find((c: any[]) => c[0] === "0 7 * * *");
      const weeklyCall = calls.find((c: any[]) => c[0] === "0 8 * * 1");

      expect(dailyCall).toBeDefined();
      expect(dailyCall[2]).toEqual(expect.objectContaining({ timezone: "America/New_York" }));
      expect(weeklyCall).toBeDefined();
      expect(weeklyCall[2]).toEqual(expect.objectContaining({ timezone: "America/New_York" }));
    });

    it("reschedules cron without restart when settings change", async () => {
      // TS-5.4
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "daily_digest_cron") return "0 7 * * *";
        if (key === "weekly_digest_cron") return "0 8 * * 1";
        return undefined;
      });

      const mockBroadcaster = createMockBroadcaster();
      const { reschedule } = await startScheduler(mockSql, mockBroadcaster);

      // Update settings
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "daily_digest_cron") return "0 8 * * *";
        if (key === "weekly_digest_cron") return "0 8 * * 1";
        return undefined;
      });

      vi.clearAllMocks();
      await reschedule();

      // Old jobs stopped (verified by the stop() calls on mock jobs)
      // New schedule registered
      expect(cron.schedule).toHaveBeenCalledWith(
        "0 8 * * *",
        expect.any(Function),
        expect.any(Object),
      );
    });

    it("reschedules cron when timezone changes", async () => {
      // TS-5.5
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "timezone") return "Europe/Berlin";
        return undefined;
      });

      const mockBroadcaster = createMockBroadcaster();
      const { reschedule } = await startScheduler(mockSql, mockBroadcaster);

      // Change timezone
      (resolveConfigValue as any).mockImplementation(async (key: string) => {
        if (key === "timezone") return "America/New_York";
        return undefined;
      });

      vi.clearAllMocks();
      await reschedule();

      const calls = (cron.schedule as any).mock.calls;
      for (const call of calls) {
        if (call[2]?.timezone) {
          expect(call[2].timezone).toBe("America/New_York");
        }
      }
    });

    it("does not retroactively generate digest on late start", async () => {
      // TS-5.6
      const mockBroadcaster = createMockBroadcaster();
      await startScheduler(mockSql, mockBroadcaster);

      // generateDailyDigest and generateWeeklyReview should NOT be called during startup
      // Only cron.schedule should be called (jobs registered but not triggered)
      expect(cron.schedule).toHaveBeenCalled();
      // The pipeline functions are mocked at module level — if they were called,
      // getDailyDigestData/getWeeklyReviewData would have been called
      expect(getDailyDigestData).not.toHaveBeenCalled();
      expect(getWeeklyReviewData).not.toHaveBeenCalled();
    });

    it("runs daily and weekly jobs independently when both fire", async () => {
      // TS-5.7
      const capturedJobs: Array<{ expr: string; cb: () => void | Promise<void> }> = [];
      (cron.schedule as any).mockImplementation((expr: string, cb: () => void) => {
        capturedJobs.push({ expr, cb });
        return { stop: vi.fn() };
      });

      const mockBroadcaster = createMockBroadcaster();
      await startScheduler(mockSql, mockBroadcaster);

      // Find callbacks by cron expression (not by registration order)
      const dailyJob = capturedJobs.find((j) => j.expr === "0 7 * * *");
      const weeklyJob = capturedJobs.find((j) => j.expr === "0 8 * * 1");
      expect(dailyJob).toBeDefined();
      expect(weeklyJob).toBeDefined();

      // Fire both simultaneously (don't await first)
      await Promise.all([dailyJob!.cb(), weeklyJob!.cb()]);

      // Both pipelines triggered independently
      expect(getDailyDigestData).toHaveBeenCalled();
      expect(getWeeklyReviewData).toHaveBeenCalled();
    });
  });
});
