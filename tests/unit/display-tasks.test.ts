import { describe, it, expect, vi } from "vitest";
import { formatDueDate, getDisplayTasks } from "../../src/display/task-data.js";

// ─── formatDueDate ─────────────────────────────────────────────

describe("formatDueDate", () => {
  const now = new Date(2026, 2, 31); // March 31, 2026

  it("returns null for null input", () => {
    expect(formatDueDate(null, now)).toBeNull();
  });

  it("returns 'overdue' for a past date", () => {
    expect(formatDueDate("2026-03-29", now)).toBe("overdue");
  });

  it("returns 'due today' for the same day", () => {
    expect(formatDueDate("2026-03-31", now)).toBe("due today");
  });

  it("returns 'due tomorrow' for the next day", () => {
    expect(formatDueDate("2026-04-01", now)).toBe("due tomorrow");
  });

  it("returns 'due Apr 3' for a future date", () => {
    expect(formatDueDate("2026-04-03", now)).toBe("due Apr 3");
  });
});

// ─── getDisplayTasks ───────────────────────────────────────────

describe("getDisplayTasks", () => {
  it("queries and maps rows correctly", async () => {
    const mockRows = [
      {
        name: "Renew passport",
        fields: { status: "pending", due_date: "2026-04-03" },
        updated_at: new Date("2026-03-31T08:00:00Z"),
      },
      {
        name: "Buy groceries",
        fields: { status: "pending", due_date: null },
        updated_at: new Date("2026-03-31T07:00:00Z"),
      },
      {
        name: "File taxes",
        fields: { status: "done", due_date: "2026-03-30" },
        updated_at: new Date("2026-03-31T06:00:00Z"),
      },
    ];

    const sql = Object.assign(vi.fn().mockResolvedValue(mockRows), {
      unsafe: vi.fn().mockResolvedValue(mockRows),
    });

    // Use a fixed "now" for deterministic formatting
    const realDateNow = Date.now;
    Date.now = () => new Date(2026, 2, 31, 10, 0, 0).getTime();
    const origDate = globalThis.Date;
    const FixedDate = class extends origDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(2026, 2, 31, 10, 0, 0);
        } else {
          // @ts-expect-error -- spread into Date constructor
          super(...args);
        }
      }
    } as DateConstructor;
    globalThis.Date = FixedDate;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tasks = await getDisplayTasks(sql as any, 10);

      // sql tagged template was called once
      expect(sql).toHaveBeenCalledOnce();

      expect(tasks).toEqual([
        { name: "Renew passport", due: "due Apr 3", done: false },
        { name: "Buy groceries", due: null, done: false },
        { name: "File taxes", due: "overdue", done: true },
      ]);
    } finally {
      globalThis.Date = origDate;
      Date.now = realDateNow;
    }
  });
});
