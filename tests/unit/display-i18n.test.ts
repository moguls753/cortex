import { describe, it, expect, beforeAll } from "vitest";
import i18next, { type TFunction } from "i18next";
import { initI18n } from "../../src/web/i18n/index.js";
import { buildLayout } from "../../src/display/layout.js";
import { formatDueDate } from "../../src/display/task-data.js";
import { formatDate } from "../../src/display/index.js";
import { ALL_DAY } from "../../src/display/types.js";
import { makeDisplayData, makeEvent, makeTask } from "../helpers/display-fixtures.js";

// The device sends no cookie, so the PNG's language comes from the
// `ui_language` setting rather than a request context.

let de: TFunction;
let en: TFunction;

beforeAll(async () => {
  await initI18n();
  de = i18next.getFixedT("de") as TFunction;
  en = i18next.getFixedT("en") as TFunction;
});

describe("display i18n", () => {
  const data = () =>
    makeDisplayData({
      todayEvents: [makeEvent({ time: ALL_DAY, name: "Familienbrunch" })],
      upcomingDays: [
        { label: "Morgen", events: [makeEvent({ name: "Retro" })] },
      ],
      tasks: [makeTask({ name: "Brötchen kaufen", due: "überfällig" })],
    });

  it("renders the German catalog when given the German translator", () => {
    const json = JSON.stringify(buildLayout(data(), 1872, 1404, 1, de));

    expect(json).toContain("Heute");
    expect(json).toContain("TODO");
    expect(json).toContain("ganztägig");
    expect(json).toContain("Aktualisiert");
    expect(json).not.toContain("Don't Forget");
    expect(json).not.toContain("all day");
  });

  it("still renders English by default", () => {
    const json = JSON.stringify(buildLayout(data(), 1872, 1404, 1, en));

    expect(json).toContain("Don't Forget");
    expect(json).toContain("all day");
    expect(json).not.toContain("TODO");
  });

  it("translates the empty states", () => {
    const empty = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(empty, 1872, 1404, 1, de));

    expect(json).toContain("Heute keine Termine");
    expect(json).toContain("Alles erledigt");
  });

  it("translates the promoted week-ahead heading", () => {
    const quiet = makeDisplayData({
      todayEvents: [],
      upcomingDays: [{ label: "Morgen", events: [makeEvent({ name: "Retro" })] }],
      tasks: [],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(quiet, 1872, 1404, 1, de));

    expect(json).toContain("Diese Woche");
    expect(json).toContain("Heute keine Termine");
    expect(json).not.toContain("Week Ahead");
  });

  it("translates the weather condition from its WMO code", () => {
    // Code 3 = Overcast / Bedeckt.
    const json = JSON.stringify(buildLayout(data(), 1872, 1404, 1, de));
    expect(json).toContain("Teils bewölkt"); // fixture uses code 2
  });

  it("translates the overflow summaries", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeEvent({ name: `E${i + 1}` }),
    );
    const busy = makeDisplayData({
      todayEvents: many,
      maxTodayEvents: 20,
      upcomingDays: [{ label: "Morgen", events: many }],
      tasks: [],
    });
    const json = JSON.stringify(buildLayout(busy, 1872, 1404, 1, de));

    expect(json).toContain("weitere");
    expect(json).not.toContain("more");
  });

  it("translates task due labels", () => {
    const now = new Date(2026, 2, 29);
    expect(formatDueDate("2026-03-28", now, de, "de")).toBe("überfällig");
    expect(formatDueDate("2026-03-29", now, de, "de")).toBe("heute fällig");
    expect(formatDueDate("2026-03-30", now, de, "de")).toBe("morgen fällig");
    expect(formatDueDate("2026-04-03", now, de, "de")).toBe("fällig 3. Apr.");
  });

  it("shows no German due label on a completed task", () => {
    const completed = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [makeTask({ name: "Brötchen kaufen", due: null, done: true })],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(completed, 1872, 1404, 1, de));

    expect(json).toContain("Brötchen kaufen");
    expect(json).not.toContain("fällig");
  });

  it("leads an all-done column with the German all-clear line", () => {
    const allDone = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [
        makeTask({ name: "Brötchen kaufen", due: null, done: true }),
        makeTask({ name: "Joggen mit Basti", due: null, done: true }),
      ],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(allDone, 1872, 1404, 1, de));

    expect(json).toContain("Alles erledigt");
    expect(json).not.toContain("All clear");
    expect(json.indexOf("Alles erledigt")).toBeLessThan(
      json.indexOf("Brötchen kaufen"),
    );
  });

  it("renders German overdue labels bold", () => {
    // The weight used to be keyed off the English literal "overdue", so a
    // German panel silently lost it.
    const overdue = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [makeTask({ name: "Joggen", due: "überfällig", done: false })],
      weather: null,
    });
    const json = JSON.stringify(buildLayout(overdue, 1872, 1404, 1, de));

    expect(json).toContain('"fontWeight":700');
  });

  it("formats the header date in the display locale", () => {
    const date = new Date(2026, 7, 9); // Sunday, August 9 2026
    expect(formatDate(date, "en")).toBe("Sunday, August 9");
    expect(formatDate(date, "de")).toBe("Sonntag, 9. August");
  });
});

describe("display i18n — layout fit", () => {
  it("widens the time gutter for a longer localized all-day label", () => {
    const data = makeDisplayData({
      todayEvents: [makeEvent({ time: ALL_DAY, name: "Familienbrunch" })],
      upcomingDays: [],
      tasks: [],
    });

    const widthOf = (json: string) =>
      Number(json.match(/"color":"#666","width":(\d+),"flexShrink":0/)![1]);

    const enWidth = widthOf(JSON.stringify(buildLayout(data, 1872, 1404, 1, en)));
    const deWidth = widthOf(JSON.stringify(buildLayout(data, 1872, 1404, 1, de)));

    // "all day" fits the 150px reference gutter; "ganztägig" does not.
    expect(enWidth).toBe(150);
    expect(deWidth).toBeGreaterThan(enWidth);
    expect(deWidth).toBeGreaterThanOrEqual(
      Math.ceil("ganztägig".length * 32 * 0.62),
    );
  });

  it("widens the gutter for a span label longer than the all-day label", () => {
    // Both shipped span labels are shorter than the 150px gutter floor, so
    // asserting on en/de alone cannot tell whether the gutter accounts for
    // spans at all — the floor satisfies it either way. A longer translation
    // can: this is the case the `spanWidth` term exists for.
    const long = "bis SONNABEND";
    const stub = ((key: string, opts?: Record<string, unknown>) =>
      key === "display.event_span_until"
        ? long
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (en as any)(key, opts)) as unknown as TFunction;

    const data = makeDisplayData({
      todayEvents: [makeEvent({ time: ALL_DAY, name: "Celle", span: long })],
      upcomingDays: [],
      tasks: [],
    });
    const widthOf = (json: string) =>
      Number(json.match(/"color":"#666","width":(\d+),"flexShrink":0/)![1]);

    const stubbed = widthOf(
      JSON.stringify(buildLayout(data, 1872, 1404, 1, stub)),
    );
    const shipped = widthOf(JSON.stringify(buildLayout(data, 1872, 1404, 1, en)));

    expect(stubbed).toBeGreaterThanOrEqual(Math.ceil(long.length * 32 * 0.62));
    expect(stubbed).toBeGreaterThan(shipped);
  });

  it("scales the widened gutter with the font scale", () => {
    const data = makeDisplayData({
      todayEvents: [makeEvent({ time: ALL_DAY })],
      upcomingDays: [],
      tasks: [],
    });
    const widthOf = (json: string) =>
      Number(json.match(/"color":"#666","width":(\d+),"flexShrink":0/)![1]);

    const atOne = widthOf(JSON.stringify(buildLayout(data, 1872, 1404, 1, de)));
    const atOneFive = widthOf(
      JSON.stringify(buildLayout(data, 1872, 1404, 1.5, de)),
    );

    expect(atOneFive).toBeGreaterThan(atOne);
  });
});
