import { describe, it, expect } from "vitest";
import {
  buildLayout,
  columnBudget,
  dimensionScale,
  eventRowHeights,
  maxPromotedRows,
  maxUpcomingRows,
  MAX_TASK_NAME_LINES,
  taskNameChars,
  taskRowAllocation,
  taskRowHeights,
  typeScale,
} from "../../src/display/layout.js";
import { ALL_DAY, type DisplayData } from "../../src/display/types.js";
import {
  makeDisplayData,
  makeEvent,
  makeTask,
  makeWeather,
} from "../helpers/display-fixtures.js";

const sampleData: DisplayData = {
  date: "Monday, March 31",
  time: "07:30",
  weather: {
    current: 14,
    condition: "Partly Cloudy",
    weatherCode: 2,
    high: 18,
    low: 9,
    tomorrowHigh: 21,
    tomorrowLow: 11,
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
  upcomingDays: [
    {
      label: "Tomorrow",
      events: [
        { time: "09:00", name: "Parent-teacher conference", calendar: "FAMILY" },
      ],
    },
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
      upcomingDays: [],
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
    expect(json).toContain("14.0\u00B0C");
    expect(json).toContain("Partly Cloudy");
    expect(json).toContain("9|18\u00B0");
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
    expect(json).toContain("cortex");
  });

  it("includes the upcoming section when upcomingDays exist", () => {
    const element = buildLayout(sampleData, 1872, 1404);
    const json = JSON.stringify(element);
    expect(json).toContain("Tomorrow");
    expect(json).toContain("Parent-teacher conference");
  });

  it("renders a labelled group per upcoming day", () => {
    const data = {
      ...sampleData,
      upcomingDays: [
        { label: "Tomorrow", events: [makeEvent({ name: "Standup" })] },
        { label: "Friday", events: [makeEvent({ name: "Swimming" })] },
      ],
    };
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("Tomorrow");
    expect(json).toContain("Standup");
    expect(json).toContain("Friday");
    expect(json).toContain("Swimming");
  });

  it("caps upcoming rows across the week and summarises the remainder", () => {
    const many = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => makeEvent({ name: `${prefix}${i + 1}` }));
    const data = {
      ...sampleData,
      upcomingDays: [
        { label: "Tomorrow", events: many(8, "A") },
        { label: "Friday", events: many(5, "B") },
      ],
    };
    const json = JSON.stringify(buildLayout(data, 1872, 1404));

    expect(json).toContain("A8");
    expect(json).not.toContain("B1");
    expect(json).toContain("+5 more this week");
  });

  it("omits the upcoming section when upcomingDays is empty", () => {
    const data = { ...sampleData, upcomingDays: [] };
    const element = buildLayout(data, 1872, 1404);
    const json = JSON.stringify(element);

    // "Tomorrow" also labels the weather strip's high/low row, so count rather
    // than merely checking for absence.
    expect(json.match(/Tomorrow/g)).toHaveLength(1);
    expect(json).not.toContain("Parent-teacher conference");
    expect(json).not.toContain("more this week");
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
    const data = makeDisplayData({
      todayEvents: [makeEvent({ time: "09:30", name: "Standup", calendar: "WORK" })],
      upcomingDays: [],
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
    const data = makeDisplayData({
      todayEvents: events,
      maxTodayEvents: 5,
      upcomingDays: [],
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
    const data = makeDisplayData({
      todayEvents: events,
      maxTodayEvents: 5,
      upcomingDays: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("+3 more");
  });

  it("TS-5.8 — upcoming subsection renders every event of a day group", () => {
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ time: `${String(9 + i).padStart(2, "0")}:00`, name: `T${i + 1}` }),
    );
    // Layer contract: calendar-data groups by day, the layout renders the group.
    const data = makeDisplayData({
      upcomingDays: [{ label: "Tomorrow", events }],
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
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("No events today");
  });

  it("TS-5.10 — upcoming subsection omitted entirely when empty", () => {
    const data = makeDisplayData({
      upcomingDays: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    // "Tomorrow" heading is absent (case-sensitive, the code uses "Tomorrow")
    expect(json).not.toContain("Tomorrow");
  });

  it("renders a multi-day span in place of the time", () => {
    const data = makeDisplayData({
      todayEvents: [
        makeEvent({ time: ALL_DAY, name: "Celle", span: "DO–SA" }),
      ],
      upcomingDays: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("DO–SA");
    // The span *is* the when; the all-day sort key must not also be printed.
    expect(json).not.toContain("all day");
  });

  it("keeps the all-day label when there is no span", () => {
    const data = makeDisplayData({
      todayEvents: [makeEvent({ time: ALL_DAY, name: "Brunch" })],
      upcomingDays: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("all day");
  });

  it("TS-6.5 — task row contains name, due label, and a checkbox element", () => {
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
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
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [makeTask({ name: "Done thing", due: null, done: true })],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("line-through");
  });

  it("TS-6.8 — overdue task renders the due label in bold (fontWeight 700)", () => {
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [makeTask({ name: "Overdue thing", due: "overdue", done: false })],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain('"fontWeight":700');
  });

  it("TS-6.9 — 'All clear' empty state when tasks is empty", () => {
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));
    expect(json).toContain("All clear");
  });

  it("TS-7.8 — weather strip shows rounded temp, condition, high/low, and 4 hourly slots", () => {
    const data = makeDisplayData({
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
    expect(json).toContain("13.0\u00B0C");
    expect(json).toContain("Partly Cloudy");
    expect(json).toContain("7|15\u00B0");
    expect(json).toContain("11:00");
    expect(json).toContain("12:00");
    expect(json).toContain("13:00");
    expect(json).toContain("14:00");
  });

  it("TS-8.1 — header and footer always render even with no data", () => {
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
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
    const data = makeDisplayData({
      todayEvents: [makeEvent({ name: longName })],
      upcomingDays: [],
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

// ─── Font scale (display_font_scale) ──────────────────────────

describe("display font scale", () => {
  // The reference type scale: the sizes tuned for a 1872x1404 panel read from
  // across a room. These are NOT the original pre-1.0 sizes — the whole scale
  // was enlarged roughly 40% (brand 32 -> 48, eventName 26 -> 38) before the
  // setting existed, because the display was unreadable at the old sizes.
  // Scale 1.0 must reproduce the current values byte-for-byte.
  const REFERENCE_TYPE_SCALE = {
    brand: 48,
    headerMeta: 34,
    sectionTitle: 32,
    temp: 88,
    condition: 28,
    highLow: 28,
    hourlyTime: 24,
    hourlyTemp: 30,
    eventTime: 32,
    eventName: 38,
    eventTimeSmall: 26,
    eventNameSmall: 30,
    badge: 20,
    taskName: 32,
    taskDue: 24,
    tomorrowLabel: 28,
    emptyState: 32,
    overflow: 26,
    footer: 22,
  };

  const REFERENCE_DIMENSIONS = {
    eventTimeColumn: 150,
    checkbox: 34,
    checkboxIcon: 20,
    brandIcon: 44,
    sectionIcon: 32,
    emptyStateIcon: 28,
    weatherIcon: 64,
    weatherLabel: 170,
  };

  it("scale 1.0 reproduces the reference type scale exactly", () => {
    expect(typeScale(1)).toEqual(REFERENCE_TYPE_SCALE);
    expect(dimensionScale(1)).toEqual(REFERENCE_DIMENSIONS);
    expect(maxUpcomingRows(1)).toBe(10);
  });

  it("omitting the scale renders identically to an explicit 1.0", () => {
    const withDefault = JSON.stringify(buildLayout(sampleData, 1872, 1404));
    const withExplicit = JSON.stringify(buildLayout(sampleData, 1872, 1404, 1));
    expect(withDefault).toBe(withExplicit);
  });

  it("scales every font size up at 1.5 and rounds to integers", () => {
    expect(typeScale(1.5)).toEqual({
      brand: 72,
      headerMeta: 51,
      sectionTitle: 48,
      temp: 132,
      condition: 42,
      highLow: 42,
      hourlyTime: 36,
      hourlyTemp: 45,
      eventTime: 48,
      eventName: 57,
      eventTimeSmall: 39,
      eventNameSmall: 45,
      badge: 30,
      taskName: 48,
      taskDue: 36,
      tomorrowLabel: 42,
      emptyState: 48,
      overflow: 39,
      footer: 33,
    });
  });

  it("scales every font size down at 0.75 and rounds to integers", () => {
    expect(typeScale(0.75)).toEqual({
      brand: 36,
      headerMeta: 26, // 25.5 → 26
      sectionTitle: 24,
      temp: 66,
      condition: 21,
      highLow: 21,
      hourlyTime: 18,
      hourlyTemp: 23, // 22.5 → 23
      eventTime: 24,
      eventName: 29, // 28.5 → 29
      eventTimeSmall: 20, // 19.5 → 20
      eventNameSmall: 23, // 22.5 → 23
      badge: 15,
      taskName: 24,
      taskDue: 18,
      tomorrowLabel: 21,
      emptyState: 24,
      overflow: 20, // 19.5 → 20
      footer: 17, // 16.5 → 17
    });
  });

  it("emits the scaled font sizes into the element tree at 1.5", () => {
    const json = JSON.stringify(buildLayout(sampleData, 1872, 1404, 1.5));
    expect(json).toContain('"fontSize":72'); // brand
    expect(json).toContain('"fontSize":132'); // temperature
    expect(json).toContain('"fontSize":57'); // today event name
    expect(json).toContain('"fontSize":33'); // footer
    // Reference sizes must be gone for the keys that moved.
    expect(json).not.toContain('"fontSize":48,"fontWeight":500,"letterSpacing":"0.05em"');
  });

  it("emits the scaled font sizes into the element tree at 0.75", () => {
    const json = JSON.stringify(buildLayout(sampleData, 1872, 1404, 0.75));
    expect(json).toContain('"fontSize":36'); // brand
    expect(json).toContain('"fontSize":66'); // temperature
    expect(json).toContain('"fontSize":29'); // today event name
    expect(json).toContain('"fontSize":17'); // footer
  });

  it("scales the pixel dimensions coupled to the type", () => {
    expect(dimensionScale(1.5)).toEqual({
      eventTimeColumn: 225,
      checkbox: 51,
      checkboxIcon: 30,
      brandIcon: 66,
      sectionIcon: 48,
      emptyStateIcon: 42,
      weatherIcon: 96,
      weatherLabel: 255,
    });

    const json = JSON.stringify(buildLayout(sampleData, 1872, 1404, 1.5));
    // Event time gutter widens with the time string.
    expect(json).toContain('"width":225');
    // Checkbox box and its inner tick.
    expect(json).toContain('"width":51,"height":51');
    expect(json).toContain('"width":30,"height":30');
    // Brand, section and weather icons.
    expect(json).toContain('"width":66,"height":66');
    expect(json).toContain('"width":48,"height":48');
    expect(json).toContain('"width":96,"height":96');
  });

  it("leaves the unscaled page padding alone at 2.0", () => {
    const element = buildLayout(sampleData, 1872, 1404, 2);
    const style = element.props.style as Record<string, unknown>;
    expect(style.padding).toBe(48);
    expect(style.width).toBe(1872);
    expect(style.height).toBe(1404);
  });

  it("shrinks the upcoming-row cap as the scale grows", () => {
    expect(maxUpcomingRows(0.75)).toBe(13);
    expect(maxUpcomingRows(1)).toBe(10);
    expect(maxUpcomingRows(1.5)).toBe(7);
    expect(maxUpcomingRows(2)).toBe(5);
    // Never zero, however extreme the scale.
    expect(maxUpcomingRows(100)).toBe(1);
  });

  it("summarises more upcoming events at a large scale", () => {
    const many = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => makeEvent({ name: `${prefix}${i + 1}` }));
    const data = {
      ...sampleData,
      upcomingDays: [
        { label: "Tomorrow", events: many(8, "A") },
        { label: "Friday", events: many(5, "B") },
      ],
    };

    const atOne = JSON.stringify(buildLayout(data, 1872, 1404, 1));
    expect(atOne).toContain("A8");
    expect(atOne).not.toContain("B1");
    expect(atOne).toContain("+5 more this week");

    // Same data at 2.0x: rows no longer fit the column at all, but the events
    // are still accounted for instead of vanishing.
    const atTwo = JSON.stringify(buildLayout(data, 1872, 1404, 2));
    expect(atTwo).not.toContain("A1");
    expect(atTwo).not.toContain("B1");
    expect(atTwo).toContain("+13 more this week");
  });

  it("caps today's events by the canvas when the scale outgrows it", () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      makeEvent({ time: `${String(8 + i).padStart(2, "0")}:00`, name: `E${i + 1}` }),
    );
    const data = makeDisplayData({
      todayEvents: events,
      maxTodayEvents: 8,
      upcomingDays: [],
      tasks: [],
      weather: null,
    });

    // At the reference scale the user's Max Today Events setting is the binding
    // constraint — the layout does not second-guess it.
    const atOne = JSON.stringify(buildLayout(data, 1872, 1404, 1));
    expect(atOne).toContain("E8");
    expect(atOne).not.toContain("E9");
    expect(atOne).toContain("+4 more");

    // At 2.0x the panel runs out of room first, so fewer rows are drawn and the
    // remainder is summarised rather than overflowing (which aborts the render).
    const atTwo = JSON.stringify(buildLayout(data, 1872, 1404, 2));
    expect(atTwo).toContain("E7");
    expect(atTwo).not.toContain("E8");
    expect(atTwo).toContain("+5 more");
  });
});

// ─── Adaptive hierarchy: an empty today promotes the week ahead ──

describe("adaptive calendar hierarchy", () => {
  // The large treatment: today's event-name size, used by the promoted list.
  const LARGE_ROW = '"fontSize":38,"flex":1,"color":"#1a1a1a"';
  const SMALL_ROW = '"fontSize":30,"flex":1,"color":"#1a1a1a"';
  const UPCOMING_RULE = '"borderTop":"1px solid #ccc"';

  const quietDay = (overrides: Partial<DisplayData> = {}) =>
    makeDisplayData({
      todayEvents: [],
      upcomingDays: [
        {
          label: "Tomorrow",
          events: [makeEvent({ time: "09:00", name: "Parent-teacher conference" })],
        },
      ],
      tasks: [],
      weather: null,
      ...overrides,
    });

  it("promotes the week ahead when today is empty", () => {
    const json = JSON.stringify(buildLayout(quietDay(), 1872, 1404));

    expect(json).toContain("Week Ahead");
    expect(json).toContain("No events today");
    // Promoted rows carry today's type, not the secondary size.
    expect(json).toContain(LARGE_ROW);
    expect(json).not.toContain(SMALL_ROW);
  });

  it("keeps today's treatment when today has events", () => {
    const json = JSON.stringify(buildLayout(sampleData, 1872, 1404));

    expect(json).not.toContain("Week Ahead");
    expect(json).toContain("Today");
    expect(json).toContain(SMALL_ROW);
  });

  it("drops the divider above the promoted list", () => {
    const promoted = JSON.stringify(buildLayout(quietDay(), 1872, 1404));
    expect(promoted).not.toContain(UPCOMING_RULE);

    // The secondary list keeps it — and keeps the exact wrapper it always had,
    // because `chromePx` is budgeted against precisely these three properties.
    const secondary = JSON.stringify(buildLayout(sampleData, 1872, 1404));
    expect(secondary).toContain(
      '"marginTop":40,"paddingTop":32,"borderTop":"1px solid #ccc","display":"flex","flexDirection":"column"',
    );
  });

  it("keeps a heading per day in the promoted list", () => {
    const data = quietDay({
      upcomingDays: [
        { label: "Tomorrow", events: [makeEvent({ name: "Standup" })] },
        { label: "Friday", events: [makeEvent({ name: "Swimming" })] },
      ],
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));

    expect(json).toContain("Tomorrow");
    expect(json).toContain("Standup");
    expect(json).toContain("Friday");
    expect(json).toContain("Swimming");
  });

  it("falls back to today's empty state when nothing is scheduled at all", () => {
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));

    expect(json).toContain("No events today");
    expect(json).toContain("Today");
    expect(json).not.toContain("Week Ahead");
    // The big italic empty state, not the quiet one-liner.
    expect(json).toContain('"fontSize":32');
    expect(json).toContain('"fontStyle":"italic"');
  });

  it("does not promote a week of empty day groups", () => {
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [{ label: "Tomorrow", events: [] }],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));

    expect(json).not.toContain("Week Ahead");
    expect(json).not.toContain("Tomorrow");
  });

  it("keeps today's treatment when a multi-day event is running today", () => {
    // Change 2 collapses a running trip onto today, so today stays non-empty.
    const data = makeDisplayData({
      todayEvents: [makeEvent({ time: ALL_DAY, name: "Celle", span: "to SAT" })],
      upcomingDays: [
        { label: "Friday", events: [makeEvent({ name: "Swimming" })] },
      ],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));

    expect(json).not.toContain("Week Ahead");
    expect(json).toContain("Today");
    expect(json).toContain(UPCOMING_RULE);
  });

  it("budgets the promoted list against the canvas", () => {
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: ["Tomorrow", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
        (label) => ({
          label,
          events: Array.from({ length: 4 }, (_, i) =>
            makeEvent({ name: `${label} item ${i + 1}` }),
          ),
        }),
      ),
      tasks: [],
    });
    const rows = (json: string) =>
      (json.match(/"fontSize":\d+,"flex":1,"color":"#1a1a1a"/g) ?? []).length;

    const atOne = JSON.stringify(buildLayout(data, 1872, 1404, 1));
    const atTwo = JSON.stringify(buildLayout(data, 1872, 1404, 2));

    expect(rows(atTwo)).toBeLessThan(rows(atOne));
    expect(atOne).toContain("more this week");
    expect(atTwo).toContain("more this week");
  });

  it("gives the promoted list no chrome at all, not merely no border", () => {
    // `chromePx = 0` is only honest if the wrapper really carries nothing:
    // keeping marginTop 40 and paddingTop 32 while dropping the border alone
    // leaves 72 of the 73 budgeted pixels unaccounted for.
    type Node = { type: string; props: Record<string, unknown> };
    const walk = (node: unknown): Node[] => {
      if (!node || typeof node !== "object") return [];
      const n = node as Node;
      const out: Node[] = n.type ? [n] : [];
      const kids = n.props?.children;
      if (Array.isArray(kids)) for (const k of kids) out.push(...walk(k));
      else if (kids) out.push(...walk(kids));
      return out;
    };

    const column = (data: DisplayData) => {
      const found = walk(buildLayout(data, 1872, 1404)).find(
        (n) => (n.props.style as Record<string, unknown>)?.flex === 2,
      );
      return (found!.props.children as Node[]) ?? [];
    };

    // Promoted: [section header, quiet line, week list].
    const promoted = column(quietDay());
    expect(promoted[promoted.length - 1].props.style).toEqual({
      display: "flex",
      flexDirection: "column",
    });

    // Secondary: exactly the three chrome properties `h.upcomingChrome` = 73
    // is the sum of.
    const secondary = column(sampleData);
    expect(secondary[secondary.length - 1].props.style).toEqual({
      marginTop: 40,
      paddingTop: 32,
      borderTop: "1px solid #ccc",
      display: "flex",
      flexDirection: "column",
    });
  });

  it("keeps the promoted list inside the pixels it was budgeted", () => {
    // The arithmetic the promoted path rests on, asserted directly rather than
    // inferred from a row count: every drawn day heading and every drawn row,
    // measured at *today's* row height, has to fit the column left after the
    // quiet "no events today" line. Sizing the fits maths with the secondary
    // row height, or forgetting to subtract that line, overshoots this.
    const data = (weather: DisplayData["weather"]) =>
      makeDisplayData({
        todayEvents: [],
        maxTodayEvents: 20,
        upcomingDays: [
          "Tomorrow",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ].map((label) => ({
          label,
          events: Array.from({ length: 4 }, (_, i) =>
            makeEvent({ name: `${label} item ${i + 1}` }),
          ),
        })),
        tasks: [],
        weather,
      });

    // Both shipped panels: render.ts always lays out at 1872 wide, so the
    // 800x480 panel is really a 1872x1123 canvas.
    for (const height of [1404, 1123]) {
      for (const hasWeather of [true, false]) {
        for (const scale of [0.5, 1, 1.5, 2]) {
          const json = JSON.stringify(
            buildLayout(
              data(hasWeather ? makeWeather() : null),
              1872,
              height,
              scale,
            ),
          );
          const h = eventRowHeights(scale);
          const rows = (
            json.match(
              new RegExp(
                `"fontSize":${typeScale(scale).eventName},"flex":1,"color":"#1a1a1a"`,
                "g",
              ),
            ) ?? []
          ).length;
          const groups = (
            json.match(
              /"letterSpacing":"0\.15em","textTransform":"uppercase","color":"#666"/g,
            ) ?? []
          ).length;
          const budget =
            columnBudget(scale, height, hasWeather) - h.quietToday - h.overflow;

          expect({
            height,
            hasWeather,
            scale,
            fits: groups * h.upcomingGroup + rows * h.today <= budget,
          }).toEqual({ height, hasWeather, scale, fits: true });
        }
      }
    }
  });

  it("shrinks the promoted-row cap as the scale grows", () => {
    expect(maxPromotedRows(1)).toBe(8);
    expect(maxPromotedRows(1.5)).toBe(5);
    expect(maxPromotedRows(2)).toBe(4);
    expect(maxPromotedRows(0.5)).toBe(16);
    // Never zero, however extreme the scale.
    expect(maxPromotedRows(100)).toBe(1);
  });
});

// ─── Task column: open work above, completions below ────────────

describe("task column allocation", () => {
  // No element in the tree paints a #ccc background any more: the separation
  // between open work and the completed log is whitespace. A 1px hairline
  // measured ~14% Weber contrast on a 4-bit panel and did not scale.
  const RULE = '"backgroundColor":"#ccc"';
  // The completed block is one child, so its separation is paid exactly once.
  const DONE_BLOCK = (scale = 1) =>
    `"flexDirection":"column","gap":20,"marginTop":${taskRowHeights(scale).gap}`;

  const withTasks = (tasks: DisplayData["tasks"], scale = 1) =>
    JSON.stringify(
      buildLayout(
        // Weather present: that is the 8-task-row column the numbers below
        // assume (columnPx 851.7 / h.task 99.6).
        makeDisplayData({
          todayEvents: [makeEvent()],
          upcomingDays: [],
          tasks,
        }),
        1872,
        1404,
        scale,
      ),
    );

  // Open rows carry a due state, so each is exactly `h.task` tall — the unit
  // the pixel arithmetic in these cases is written against.
  const open = (n: number, prefix = "O") =>
    Array.from({ length: n }, (_, i) =>
      makeTask({ name: `${prefix}${i + 1}`, due: "overdue" }),
    );
  const done = (n: number, prefix = "D") =>
    Array.from({ length: n }, (_, i) =>
      makeTask({ name: `${prefix}${i + 1}`, done: true }),
    );

  it("separates the completed log with whitespace, not a rule", () => {
    const json = withTasks([...open(2), ...done(1)]);
    expect(json).not.toContain(RULE);
    expect(json.match(new RegExp(DONE_BLOCK(), "g"))).toHaveLength(1);
  });

  it("draws no separation when there are no completions", () => {
    const json = withTasks(open(3));
    expect(json).not.toContain(RULE);
    expect(json).not.toContain(DONE_BLOCK());
  });

  it("scales the separation with the font scale", () => {
    // The old 1px rule and its 20px gap were both unscaled, so the separation
    // got proportionally weaker exactly where the panel is read from further
    // away.
    expect(taskRowHeights(2).gap).toBeGreaterThan(taskRowHeights(1).gap);
    expect(withTasks([...open(1), ...done(1)], 2)).toContain(DONE_BLOCK(2));
  });

  it("leads with All clear when nothing is open", () => {
    const json = withTasks(done(3));
    expect(json).not.toContain(RULE);
    expect(json).toContain("All clear");
    // In ink and upright — the headline, not the muted italic aside used when
    // there are no tasks at all.
    expect(json).toContain('"marginTop":20,"color":"#1a1a1a"');
    expect(json).toContain('"fontStyle":"normal"');
    // The verdict comes first, the log of ticks after it.
    expect(json.indexOf("All clear")).toBeLessThan(json.indexOf("D1"));
    expect(json).toContain(DONE_BLOCK());
    expect(json).toContain("D3");
  });

  it("keeps the muted italic empty state when there are no tasks at all", () => {
    const json = withTasks([]);
    expect(json).toContain("All clear");
    expect(json).toContain('"marginTop":20,"color":"#666"');
    expect(json).toContain('"fontStyle":"italic"');
  });

  it("renders completions below open work even from interleaved input", () => {
    const json = withTasks([
      makeTask({ name: "AAA", done: true }),
      makeTask({ name: "BBB" }),
    ]);
    expect(json.indexOf("BBB")).toBeLessThan(json.indexOf("AAA"));
    // Open work is present, so no "All clear" claim.
    expect(json).not.toContain("All clear");
  });

  it("drops completions before open work when the column runs short", () => {
    // 1872x1404 at scale 1 fits 8 rows that carry a due state.
    const json = withTasks([...open(9), ...done(3)]);
    expect(json).toContain("+1 more");
    expect(json).not.toContain(DONE_BLOCK());
    expect(json).not.toContain("D1");
  });

  it("counts only open tasks in the +N more summary", () => {
    const json = withTasks([...open(10), ...done(2)]);
    expect(json).toContain("+2 more");
    expect(json).not.toContain("+4 more");
  });

  it("never costs an open row for the separation", () => {
    const json = withTasks(open(8));
    expect(json).toContain("O8");
    expect(json).not.toContain("more");
  });

  it("draws a completed checkbox as an outline, never as the darkest mark", () => {
    const json = withTasks([...open(1), ...done(1)]);
    // Open: ink outline. Done: muted outline plus a muted tick — no fill, so
    // the finished row is never the heaviest thing on the panel.
    expect(json).toContain('"border":"2px solid #1a1a1a"');
    expect(json).toContain('"border":"2px solid #666","borderRadius":2,"color":"#666"');
    expect(json).not.toContain(`"backgroundColor":"#1a1a1a","color":"#f5f5f5"`);
  });
});

describe("taskRowAllocation", () => {
  const h = taskRowHeights(1);

  it("gives every row to open work when there are no completions", () => {
    expect(taskRowAllocation(8, 0, 8 * h.task + h.overflow)).toEqual({
      open: 8,
      done: 0,
      gap: false,
    });
  });

  it("gives every row to completions when there is no open work", () => {
    // With nothing open the column leads with the "All clear" line, so that
    // line and the separation below it are both charged before any row.
    expect(
      taskRowAllocation(0, 5, 5 * h.task + h.overflow + h.allClear + h.gap),
    ).toEqual({ open: 0, done: 5, gap: true });
  });

  it("charges the All clear line against the completed block", () => {
    // One pixel short of the line's own height, so exactly one row is lost.
    expect(
      taskRowAllocation(0, 5, 5 * h.task + h.overflow + h.gap),
    ).toEqual({ open: 0, done: 4, gap: true });
  });

  it("surrenders a completed row when the separation does not fit", () => {
    expect(taskRowAllocation(3, 3, 6 * h.task + h.overflow)).toEqual({
      open: 3,
      done: 2,
      gap: true,
    });
  });

  it("keeps every completed row when the separation does fit", () => {
    expect(taskRowAllocation(3, 3, 6 * h.task + h.overflow + h.gap)).toEqual({
      open: 3,
      done: 3,
      gap: true,
    });
  });

  it("drops the only completion when the separation does not fit", () => {
    // The `done: 1 -> 0` case: the separation alone is what pushes it out, so
    // the column ends with no completed block and no separation to draw.
    expect(taskRowAllocation(3, 1, 4 * h.task + h.overflow)).toEqual({
      open: 3,
      done: 0,
      gap: false,
    });
  });

  it("keeps one open row and no separation in the degenerate case", () => {
    expect(taskRowAllocation(4, 4, 0)).toEqual({
      open: 1,
      done: 0,
      gap: false,
    });
  });
});

// ─── Task names wrap, but only so far ───────────────────────────

describe("task name wrapping", () => {
  const withTasks = (tasks: DisplayData["tasks"], scale = 1) =>
    JSON.stringify(
      buildLayout(
        makeDisplayData({
          todayEvents: [makeEvent()],
          upcomingDays: [],
          tasks,
        }),
        1872,
        1404,
        scale,
      ),
    );

  it("clamps a task name to a bounded number of lines", () => {
    const json = withTasks([makeTask({ name: "A".repeat(200), due: "overdue" })]);
    // Without a ceiling the name grew past the row height it was budgeted for,
    // ran the column off the canvas, and aborted the Resvg render.
    expect(json).toContain(`"display":"block","lineClamp":${MAX_TASK_NAME_LINES}`);
  });

  it("budgets a wrapped name as the extra line it actually draws", () => {
    const chars = taskNameChars(1872, 1);
    const fits = (name: string) =>
      withTasks(
        Array.from({ length: 8 }, () => makeTask({ name, due: "overdue" })),
      );

    // Eight one-line rows are exactly what the column holds.
    const short = fits("x".repeat(chars));
    expect(short).not.toContain("more");

    // One character more and every row wraps, so fewer of them fit and the
    // remainder is summarised rather than overflowing the canvas.
    const long = fits("x".repeat(chars + 1));
    expect(long).toContain("+3 more");
  });

  it("keeps the one-line capacity below what Satori actually fits", () => {
    // Measured against real Satori shaping in display-rasterize.test.ts. These
    // are the numbers the row budget turns on; under-counting is the safe
    // direction, over-counting overflows the canvas.
    expect(taskNameChars(1872, 1)).toBe(24);
    expect(taskNameChars(1872, 1.5)).toBe(15);
    expect(taskNameChars(1872, 2)).toBe(11);
    // Narrower panels are rendered at 1872 and scaled down by Resvg, so the
    // capacity does not depend on the panel's own width.
    expect(taskNameChars(1872, 0.5)).toBe(49);
  });
});

describe("display contrast", () => {
  // Ratios against the #f5f5f5 panel background. Text below 4.5:1 fails WCAG
  // AA, which on unlit e-ink read across a room is the first thing to go.
  const CONTRAST_FLOOR = 4.5;

  function relativeLuminance(hex: string): number {
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const full = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16));
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrast(hex: string, background = "#f5f5f5"): number {
    const [a, b] = [relativeLuminance(hex), relativeLuminance(background)].sort(
      (x, y) => y - x,
    );
    return (a + 0.05) / (b + 0.05);
  }

  it("renders no text below the AA contrast floor", () => {
    const data = makeDisplayData({
      todayEvents: Array.from({ length: 12 }, (_, i) =>
        makeEvent({ name: `E${i + 1}` }),
      ),
      maxTodayEvents: 4,
      upcomingDays: [
        { label: "Tomorrow", events: [makeEvent({ name: "Standup" })] },
      ],
      tasks: [
        makeTask({ name: "Open", due: "overdue" }),
        // A completed task carries no due state — see getDisplayTasks.
        makeTask({ name: "Done", due: null, done: true }),
      ],
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));

    // Every colour attached to a span (i.e. text), as opposed to a border.
    const textColors = new Set(
      [...json.matchAll(/"fontSize":\d+,"color":"(#[0-9a-f]{3,6})"/g)].map(
        (m) => m[1],
      ),
    );
    const alsoTextColors = new Set(
      [...json.matchAll(/"color":"(#[0-9a-f]{3,6})","width"/g)].map((m) => m[1]),
    );

    expect(textColors.size).toBeGreaterThan(0);
    for (const color of [...textColors, ...alsoTextColors]) {
      expect(
        { color, ratio: Number(contrast(color).toFixed(2)) },
      ).toEqual({ color, ratio: expect.any(Number) });
      expect(contrast(color)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    }
  });

  it("renders no text below the AA contrast floor in promoted mode", () => {
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [
        { label: "Tomorrow", events: [makeEvent({ name: "Standup" })] },
        { label: "Friday", events: [makeEvent({ name: "Swimming" })] },
      ],
      tasks: [makeTask({ name: "Open", due: "overdue" })],
    });
    const json = JSON.stringify(buildLayout(data, 1872, 1404));

    const colors = new Set([
      ...[...json.matchAll(/"fontSize":\d+,"color":"(#[0-9a-f]{3,6})"/g)].map(
        (m) => m[1],
      ),
      ...[...json.matchAll(/"color":"(#[0-9a-f]{3,6})","width"/g)].map(
        (m) => m[1],
      ),
    ]);

    expect(colors.size).toBeGreaterThan(0);
    for (const color of colors) {
      expect(contrast(color)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    }
  });

  it("keeps the sanity check honest — #888 would fail it", () => {
    expect(contrast("#888")).toBeLessThan(CONTRAST_FLOOR);
    expect(contrast("#666")).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    expect(contrast("#666")).toBeGreaterThan(5);
    expect(contrast("#1a1a1a")).toBeGreaterThan(15);
  });
});
