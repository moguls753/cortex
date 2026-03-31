import { describe, it, expect } from "vitest";
import { buildLayout } from "../../src/display/layout.js";
import type { KitchenData } from "../../src/display/types.js";

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
});
