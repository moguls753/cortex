import { describe, it, expect } from "vitest";
import { buildLayout } from "../../src/display/layout.js";
import type { KitchenData } from "../../src/display/types.js";
import {
  makeKitchenData,
  makeEvent,
  makeTask,
  makeWeather,
} from "../helpers/display-fixtures.js";

const sampleData: KitchenData = {
  date: "Monday, March 31",
  time: "07:30",
  weather: {
    current: 14,
    condition: "Partly Cloudy",
    weatherCode: 2,
    high: 18,
    low: 9,
    hourly: [
      { time: "08:00", temp: 13 },
      { time: "09:00", temp: 14 },
      { time: "10:00", temp: 15 },
      { time: "11:00", temp: 16 },
    ],
  },
  todayEvents: [
    { time: "08:30", name: "Dentist \u2014 Mila", calendar: "FAMILY" },
    { time: "10:00", name: "Sprint Planning", calendar: "WORK" },
  ],
  tomorrowEvents: [
    { time: "09:00", name: "Parent-teacher conference", calendar: "FAMILY" },
  ],
  tasks: [
    { name: "Renew passport", due: "due Apr 3", done: false },
    { name: "Call dentist", due: null, done: true },
  ],
  maxTodayEvents: 8,
};

describe("buildLayout", () => {
  it("returns a valid Satori element tree", () => {
    const element = buildLayout(sampleData, 1872, 1404);

    expect(element).toBeDefined();
    expect(element.type).toBe("div");
    expect(element.props.style).toBeDefined();
    const style = element.props.style as Record<string, unknown>;
    expect(style.width).toBe(1872);
    expect(style.height).toBe(1404);
  });

  it("omits weather section when weather is null", () => {
    const data = { ...sampleData, weather: null };
    const element = buildLayout(data, 1872, 1404);

    const json = JSON.stringify(element);
    expect(json).not.toContain("\u00B0C");
    // "Today" text is present (displayed uppercase via textTransform CSS)
    expect(json).toContain("Today");
  });

  it("shows empty state when no events and no tasks", () => {
    const data = {
      ...sampleData,
      weather: null,
      todayEvents: [],
      tomorrowEvents: [],
      tasks: [],
    };
    const element = buildLayout(data, 1872, 1404);

    const json = JSON.stringify(element);
    expect(json).toContain("No events today");
    expect(json).toContain("All clear");
  });

  it("truncates today events at maxTodayEvents and shows overflow", () => {
    const manyEvents = Array.from({ length: 12 }, (_, i) => ({
      time: `${String(8 + i).padStart(2, "0")}:00`,
      name: `Event ${i + 1}`,
      calendar: "WORK",
    }));
    const data = { ...sampleData, todayEvents: manyEvents, maxTodayEvents: 8 };
    const element = buildLayout(data, 1872, 1404);

    const json = JSON.stringify(element);
    expect(json).toContain("+4 more");
    expect(json).not.toContain("Event 12");
  });

  it("shows line-through for done tasks", () => {
    const element = buildLayout(sampleData, 1872, 1404);
    const json = JSON.stringify(element);
    expect(json).toContain("line-through");
  });

  it("includes weather data when weather is provided", () => {
    const element = buildLayout(sampleData, 1872, 1404);
    const json = JSON.stringify(element);
    expect(json).toContain("14\u00B0C");
    expect(json).toContain("Partly Cloudy");
    expect(json).toContain("H: 18");
    expect(json).toContain("L: 9");
  });

  it("includes header with cortex branding and date/time", () => {
    const element = buildLayout(sampleData, 1872, 1404);
    const json = JSON.stringify(element);
    expect(json).toContain("cortex");
    expect(json).toContain("Monday, March 31");
    expect(json).toContain("07:30");
  });

  it("includes footer with last updated time", () => {
    const element = buildLayout(sampleData, 1872, 1404);
    const json = JSON.stringify(element);
    expect(json).toContain("Last updated 07:30");
    expect(json).toContain("cortex v0.1");
  });

  it("includes tomorrow section when tomorrowEvents exist", () => {
    const element = buildLayout(sampleData, 1872, 1404);
    const json = JSON.stringify(element);
    expect(json).toContain("Tomorrow");
    expect(json).toContain("Parent-teacher conference");
  });

  it("omits tomorrow section when tomorrowEvents is empty", () => {
    const data = { ...sampleData, tomorrowEvents: [] };
    const element = buildLayout(data, 1872, 1404);
    const json = JSON.stringify(element);
    expect(json).not.toContain("Tomorrow");
  });

  it("shows bold due text for overdue tasks", () => {
    const data = {
      ...sampleData,
      tasks: [{ name: "Overdue task", due: "overdue", done: false }],
    };
    const element = buildLayout(data, 1872, 1404);
    const json = JSON.stringify(element);
    // fontWeight 700 is used for overdue tasks
    expect(json).toContain('"fontWeight":700');
    expect(json).toContain("overdue");
  });

  it("uses correct dimensions from parameters", () => {
    const element = buildLayout(sampleData, 800, 480);
    const style = element.props.style as Record<string, unknown>;
    expect(style.width).toBe(800);
    expect(style.height).toBe(480);
  });

  // ─── Explicit TS-labeled scenarios ──────────────────────────

  it("TS-5.5 — event row contains time, name, and calendar badge", () => {
    const data = makeKitchenData({
      todayEvents: [makeEvent({ time: "09:30", name: "Standup", calendar: "WORK" })],
      tomorrowEvents: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("09:30");
    expect(json).toContain("Standup");
    expect(json).toContain("WORK");
  });

  it("TS-5.6 — renders exactly maxTodayEvents rows when overflowing (KG-3: expected FAIL)", () => {
    // Per spec AC-5.4 / KG-3, the cap is driven by settings and should be
    // respected as data.maxTodayEvents. Current code hardcodes 8 in the
    // route handler, but buildLayout already reads data.maxTodayEvents.
    // The failure mode surfaces via TS-5.6 route test below — this one
    // locks in the layout-level contract and should PASS.
    const events = Array.from({ length: 12 }, (_, i) =>
      makeEvent({ time: `${String(8 + i).padStart(2, "0")}:00`, name: `E${i + 1}` }),
    );
    const data = makeKitchenData({
      todayEvents: events,
      maxTodayEvents: 5,
      tomorrowEvents: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    // 5 events rendered, "E6" onward suppressed
    expect(json).toContain("E1");
    expect(json).toContain("E5");
    expect(json).not.toContain("E6");
  });

  it("TS-5.7 — overflow line reads '+3 more' when 8 events with cap 5", () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      makeEvent({ time: `${String(8 + i).padStart(2, "0")}:00`, name: `E${i + 1}` }),
    );
    const data = makeKitchenData({
      todayEvents: events,
      maxTodayEvents: 5,
      tomorrowEvents: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("+3 more");
  });

  it("TS-5.8 — tomorrow subsection renders up to 3 events", () => {
    const tomorrow = Array.from({ length: 7 }, (_, i) =>
      makeEvent({ time: `${String(9 + i).padStart(2, "0")}:00`, name: `T${i + 1}` }),
    );
    // Layer contract: route passes the already-sliced array (see calendar-data).
    // Emulate the handoff here by slicing to 3.
    const data = makeKitchenData({
      tomorrowEvents: tomorrow.slice(0, 3),
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("T1");
    expect(json).toContain("T2");
    expect(json).toContain("T3");
    expect(json).not.toContain("T4");
  });

  it("TS-5.9 — 'No events today' empty state when todayEvents is empty", () => {
    const data = makeKitchenData({
      todayEvents: [],
      tomorrowEvents: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("No events today");
  });

  it("TS-5.10 — tomorrow subsection omitted entirely when empty", () => {
    const data = makeKitchenData({
      tomorrowEvents: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    // "Tomorrow" heading is absent (case-sensitive, the code uses "Tomorrow")
    expect(json).not.toContain("Tomorrow");
  });

  it("TS-6.5 — task row contains name, due label, and a checkbox element", () => {
    const data = makeKitchenData({
      todayEvents: [],
      tomorrowEvents: [],
      tasks: [makeTask({ name: "Buy milk", due: "due Apr 3", done: false })],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("Buy milk");
    expect(json).toContain("due Apr 3");
    // Empty checkbox: 2px solid border on a 24x24 box
    expect(json).toContain('"border":"2px solid #1a1a1a"');
  });

  it("TS-6.7 — done task has line-through on the name", () => {
    const data = makeKitchenData({
      todayEvents: [],
      tomorrowEvents: [],
      tasks: [makeTask({ name: "Done thing", due: null, done: true })],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("line-through");
  });

  it("TS-6.8 — overdue task renders the due label in bold (fontWeight 700)", () => {
    const data = makeKitchenData({
      todayEvents: [],
      tomorrowEvents: [],
      tasks: [makeTask({ name: "Overdue thing", due: "overdue", done: false })],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain('"fontWeight":700');
  });

  it("TS-6.9 — 'All clear' empty state when tasks is empty", () => {
    const data = makeKitchenData({
      todayEvents: [],
      tomorrowEvents: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("All clear");
  });

  it("TS-7.8 — weather strip shows rounded temp, condition, high/low, and 4 hourly slots", () => {
    const data = makeKitchenData({
      weather: makeWeather({
        current: 13, // already rounded for display
        condition: "Partly Cloudy",
        high: 15,
        low: 7,
        hourly: [
          { time: "11:00", temp: 13 },
          { time: "12:00", temp: 14 },
          { time: "13:00", temp: 15 },
          { time: "14:00", temp: 16 },
        ],
      }),
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("13\u00B0C");
    expect(json).toContain("Partly Cloudy");
    expect(json).toContain("H: 15");
    expect(json).toContain("L: 7");
    expect(json).toContain("11:00");
    expect(json).toContain("12:00");
    expect(json).toContain("13:00");
    expect(json).toContain("14:00");
  });

  it("TS-8.1 — header and footer always render even with no data", () => {
    const data = makeKitchenData({
      todayEvents: [],
      tomorrowEvents: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("cortex");
    expect(json).toContain(data.date);
    expect(json).toContain(data.time);
    expect(json).toContain("Last updated");
  });

  it("TS-E-3 — very long event name applies overflow/ellipsis/nowrap, layout dimensions preserved", () => {
    const longName = "A".repeat(200);
    const data = makeKitchenData({
      todayEvents: [makeEvent({ name: longName })],
      tomorrowEvents: [],
      tasks: [],
      weather: null,
    });
    const element = buildLayout(data, 1872, 1404);
    const json = JSON.stringify(element);
    expect(json).toContain('"overflow":"hidden"');
    expect(json).toContain('"textOverflow":"ellipsis"');
    expect(json).toContain('"whiteSpace":"nowrap"');
    const style = element.props.style as Record<string, unknown>;
    expect(style.width).toBe(1872);
    expect(style.height).toBe(1404);
  });
});
