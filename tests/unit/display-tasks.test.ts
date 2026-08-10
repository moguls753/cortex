import { describe, it, expect, vi } from "vitest";
import {
  formatDueDate,
  getDisplayTasks,
  MAX_COMPLETED_TASKS,
} from "../../src/display/task-data.js";

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

// ─── TS-6.6: due-date label decision table ─────────────────────

describe("formatDueDate — TS-6.6 decision table", () => {
  const now = new Date(2026, 2, 29); // March 29, 2026 — so Apr 3 is 5 days out

  const rows: Array<[string, string | null, string | null]> = [
    ["null input", null, null],
    ["yesterday (past)", "2026-03-28", "overdue"],
    ["today", "2026-03-29", "due today"],
    ["tomorrow", "2026-03-30", "due tomorrow"],
    ["5 days out (Apr 3)", "2026-04-03", "due Apr 3"],
  ];

  it.each(rows)(
    "TS-6.6 — %s → %s",
    (_label, dueDate, expected) => {
      expect(formatDueDate(dueDate, now)).toBe(expected);
    },
  );
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
        // Change 2: a completed task carries no due state, even though its
        // due_date is in the past.
        { name: "File taxes", due: null, done: true },
      ]);
    } finally {
      globalThis.Date = origDate;
      Date.now = realDateNow;
    }
  });
});

// ─── Completed-task handling (Changes 1 and 2) ────────────────

describe("getDisplayTasks — completed tasks", () => {
  const mockSql = (rows: unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(vi.fn().mockResolvedValue(rows), { unsafe: vi.fn() }) as any;

  const row = (name: string, status: string, due_date: string | null = null) => ({
    name,
    fields: { status, due_date },
    updated_at: new Date(),
  });

  const past = () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  };

  const future = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  };

  it("suppresses the due label on a completed task with a past date", async () => {
    // Direct regression for "✓ Tanz am 20.04. löschen — überfällig".
    const tasks = await getDisplayTasks(mockSql([row("Tanz löschen", "done", past())]), 7);
    expect(tasks).toEqual([{ name: "Tanz löschen", due: null, done: true }]);
  });

  it("keeps the due label on a pending overdue task", async () => {
    const tasks = await getDisplayTasks(mockSql([row("Still open", "pending", past())]), 7);
    expect(tasks[0].due).toBe("overdue");
  });

  it("suppresses the due label on a completed task with a future date", async () => {
    const tasks = await getDisplayTasks(mockSql([row("Done early", "done", future())]), 7);
    expect(tasks[0].due).toBeNull();
  });

  it("caps completions at MAX_COMPLETED_TASKS when open work exists", async () => {
    const done = Array.from({ length: MAX_COMPLETED_TASKS + 3 }, (_, i) =>
      row(`Done ${i + 1}`, "done"),
    );
    const tasks = await getDisplayTasks(
      mockSql([row("Open one", "pending"), ...done]),
      20,
    );

    expect(tasks).toHaveLength(1 + MAX_COMPLETED_TASKS);
    // The SQL returns completions freshest-first, so the cap keeps the head.
    expect(tasks.map((t) => t.name)).toEqual([
      "Open one",
      ...done.slice(0, MAX_COMPLETED_TASKS).map((r) => r.name),
    ]);
  });

  it("caps completions even when there is no open work", async () => {
    // The cap used to be lifted here, which made the best state of the column
    // its busiest: four struck-through rows and four ticked boxes. The layout
    // now leads that case with "All clear" and keeps a short log beneath it.
    const tasks = await getDisplayTasks(
      mockSql(Array.from({ length: 5 }, (_, i) => row(`Done ${i + 1}`, "done"))),
      20,
    );
    expect(tasks).toHaveLength(MAX_COMPLETED_TASKS);
    expect(tasks.every((t) => t.done)).toBe(true);
    // Freshest first, per the SQL ordering.
    expect(tasks.map((t) => t.name)).toEqual(["Done 1", "Done 2"]);
  });

  it("partitions rather than merely trimming", async () => {
    const tasks = await getDisplayTasks(
      mockSql([row("A", "done"), row("B", "pending"), row("C", "done")]),
      20,
    );
    expect(tasks.map((t) => t.name)).toEqual(["B", "A", "C"]);
  });

  it("leaves a single open task with no completions untouched", async () => {
    const tasks = await getDisplayTasks(mockSql([row("Only one", "pending")]), 7);
    expect(tasks).toEqual([{ name: "Only one", due: null, done: false }]);
  });
});
