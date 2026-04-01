/**
 * Unit tests for task completion reply message formatting.
 * Tests Telegram reply text and inline keyboard generation
 * for auto-completed and needs-confirmation task matches.
 *
 * Scenarios: TS-5.1–5.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Types — will fail to import until src/task-completion.ts exists
// ---------------------------------------------------------------------------

type FormatCompletionReply = (options: {
  classificationText: string;
  autoCompleted: Array<{ entry_id: string; name: string; confidence: number }>;
  needsConfirmation: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
}) => {
  text: string;
  inlineKeyboard?: Array<
    Array<{ text: string; callback_data: string }>
  >;
};

let formatCompletionReply: FormatCompletionReply;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.clearAllMocks();

  const mod = await import("../../src/task-completion.js");
  formatCompletionReply = mod.formatCompletionReply;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// US-5: Capture Confirmation Messages
// ============================================================

describe("Task Completion Messages", () => {
  describe("US-5: Capture confirmation messages", () => {
    it("TS-5.1: auto-completion shown in reply message", () => {
      const result = formatCompletionReply({
        classificationText:
          "✅ Filed as people → Landlord Chat (92%)",
        autoCompleted: [
          { entry_id: "task-1", name: "Call landlord", confidence: 0.9 },
        ],
        needsConfirmation: [],
      });

      expect(result.text).toContain("Filed as people");
      expect(result.text).toContain("Landlord Chat");
      expect(result.text).toMatch(/[Mm]arked.*Call landlord.*done/);
    });

    it("TS-5.2: multiple auto-completions listed in reply", () => {
      const result = formatCompletionReply({
        classificationText: "✅ Filed as reference → Meeting Notes (88%)",
        autoCompleted: [
          { entry_id: "task-1", name: "Call landlord", confidence: 0.9 },
          { entry_id: "task-2", name: "Email accountant", confidence: 0.85 },
        ],
        needsConfirmation: [],
      });

      expect(result.text).toMatch(/[Mm]arked.*Call landlord.*done/);
      expect(result.text).toMatch(/[Mm]arked.*Email accountant.*done/);
    });

    it("TS-5.3: low-confidence completion shows inline button prompt", () => {
      const result = formatCompletionReply({
        classificationText: "✅ Filed as people → Landlord Chat (92%)",
        autoCompleted: [],
        needsConfirmation: [
          { entry_id: "task-1", name: "Call landlord", confidence: 0.45 },
        ],
      });

      expect(result.text).toContain("Filed as people");
      // Should include inline keyboard for confirmation
      expect(result.inlineKeyboard).toBeDefined();
      expect(result.inlineKeyboard!.length).toBeGreaterThan(0);

      // Flatten buttons and check for Yes/No
      const buttons = result.inlineKeyboard!.flat();
      const yesButton = buttons.find((b) =>
        b.text.toLowerCase().includes("yes"),
      );
      const noButton = buttons.find((b) =>
        b.text.toLowerCase().includes("no"),
      );
      expect(yesButton).toBeDefined();
      expect(noButton).toBeDefined();
    });

    it("TS-5.4: mixed confidence shows both auto and confirm", () => {
      const result = formatCompletionReply({
        classificationText: "✅ Filed as reference → Notes (90%)",
        autoCompleted: [
          { entry_id: "task-1", name: "Call landlord", confidence: 0.9 },
        ],
        needsConfirmation: [
          { entry_id: "task-2", name: "Email accountant", confidence: 0.45 },
        ],
      });

      // Auto-completed task shown as done
      expect(result.text).toMatch(/[Mm]arked.*Call landlord.*done/);

      // Low-confidence task has inline keyboard
      expect(result.inlineKeyboard).toBeDefined();
      expect(result.inlineKeyboard!.length).toBeGreaterThan(0);
    });
  });
});
