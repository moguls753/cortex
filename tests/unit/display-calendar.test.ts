import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import i18next, { type TFunction } from "i18next";

// ─── Mocks (vi.hoisted so they're available in vi.mock factories) ──

const {
  resolveCalendarConfigMock,
  refreshAccessTokenMock,
  saveAllSettingsMock,
  getAllSettingsMock,
  fetchMock,
} = vi.hoisted(() => ({
  resolveCalendarConfigMock: vi.fn(),
  refreshAccessTokenMock: vi.fn(),
  saveAllSettingsMock: vi.fn(),
  getAllSettingsMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("../../src/google-calendar.js", () => ({
  resolveCalendarConfig: resolveCalendarConfigMock,
  refreshAccessToken: refreshAccessTokenMock,
}));

vi.mock("../../src/web/settings-queries.js", () => ({
  saveAllSettings: saveAllSettingsMock,
  getAllSettings: getAllSettingsMock,
}));

vi.stubGlobal("fetch", fetchMock);

import {
  formatEventSpan,
  getDisplayEvents,
} from "../../src/display/calendar-data.js";
import { initI18n } from "../../src/web/i18n/index.js";

// ─── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    calendarId: "primary@gmail.com",
    accessToken: "access-token-123",
    refreshToken: "refresh-token-456",
    clientId: "client-id",
    clientSecret: "client-secret",
    defaultDuration: 60,
    ...overrides,
  };
}

function makeMultiConfig() {
  return makeConfig({
    calendars: {
      Family: "family@group.calendar.google.com",
      Work: "work@group.calendar.google.com",
    },
    defaultCalendar: "Family",
    calendarId: "family@group.calendar.google.com",
  });
}

function googleEventsResponse(events: Array<Record<string, unknown>>) {
  return {
    ok: true,
    json: async () => ({ items: events }),
  };
}

function emptyEventsResponse() {
  return googleEventsResponse([]);
}

const sql = vi.fn() as unknown as import("postgres").Sql;

// ─── Tests ────────────────────────────────────────────────────

describe("getDisplayEvents", () => {
  // The catalogs have to be registered before any test asks for a German
  // translator; beforeAll runs before the fake-timer setup below.
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T10:00:00+02:00"));
  });

  it("fetches a week of events from all calendars, grouped by day", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeMultiConfig());

    // One request per calendar covering the whole week.
    fetchMock
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Dentist — Mila", start: { dateTime: "2026-03-31T08:30:00+02:00" } },
          { summary: "Grocery run", start: { date: "2026-03-31" } },
          { summary: "Family dinner", start: { dateTime: "2026-04-01T18:00:00+02:00" } },
          { summary: "Swimming", start: { dateTime: "2026-04-03T16:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Standup", start: { dateTime: "2026-03-31T09:00:00+02:00" } },
          { summary: "Sprint review", start: { dateTime: "2026-04-01T14:00:00+02:00" } },
        ]),
      );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    // Today: 3 events sorted by time (all day first, then 08:30, then 09:00)
    expect(result.today).toHaveLength(3);
    expect(result.today[0]).toEqual({
      time: "all day",
      name: "Grocery run",
      calendar: "FAMILY",
    });
    expect(result.today[1]).toEqual({
      time: "08:30",
      name: "Dentist — Mila",
      calendar: "FAMILY",
    });
    expect(result.today[2]).toEqual({
      time: "09:00",
      name: "Standup",
      calendar: "WORK",
    });

    // Upcoming: only days that actually have events, in chronological order,
    // merged across calendars and sorted within the day.
    expect(result.upcoming).toHaveLength(2);
    expect(result.upcoming[0].label).toBe("Tomorrow");
    expect(result.upcoming[0].events).toEqual([
      { time: "14:00", name: "Sprint review", calendar: "WORK" },
      { time: "18:00", name: "Family dinner", calendar: "FAMILY" },
    ]);
    // 2026-04-03 is the Friday of that week.
    expect(result.upcoming[1].label).toBe("Friday");
    expect(result.upcoming[1].events).toEqual([
      { time: "16:00", name: "Swimming", calendar: "FAMILY" },
    ]);

    // One fetch per calendar, not one per calendar per day.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify auth header
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall[1].headers.Authorization).toBe("Bearer access-token-123");
  });

  it("collapses a running multi-day event onto today with an open-start span", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    // Started two days before the window opened; all-day end dates are
    // exclusive, so this covers Mar 29 through Apr 1.
    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "Ski trip",
          start: { date: "2026-03-29" },
          end: { date: "2026-04-02" },
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    // One row, on the first day of the window it touches. The start is before
    // the window, so only the end is stated.
    expect(result.today).toEqual([
      { time: "all day", name: "Ski trip", calendar: "CALENDAR", span: "to WED" },
    ]);
    // No copy under Tomorrow — the trip is already accounted for on today.
    expect(result.upcoming).toEqual([]);
  });

  it("labels a future multi-day event with its end day", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    // Thu Apr 2 through Sat Apr 4 (end date is exclusive).
    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "Celle",
          start: { date: "2026-04-02" },
          end: { date: "2026-04-05" },
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toEqual([]);
    expect(result.upcoming.map((d) => d.label)).toEqual(["Thursday"]);
    expect(result.upcoming[0].events).toEqual([
      // The span renders under the "Thursday" heading, so restating THU in the
      // gutter would make the reader reconcile two labels for the same day.
      { time: "all day", name: "Celle", calendar: "CALENDAR", span: "to SAT" },
    ]);
  });

  it("clamps a span that runs past the window", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "Sabbatical",
          start: { date: "2026-04-01" },
          end: { date: "2026-04-21" },
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.upcoming.map((d) => d.label)).toEqual(["Tomorrow"]);
    // The window's last visible day is Mon Apr 6, not the real end.
    expect(result.upcoming[0].events[0].span).toBe("to MON");
  });

  it("labels a multi-day event that starts today with its end day", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    // Tue Mar 31 through Thu Apr 2 (end date is exclusive).
    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "Conference",
          start: { date: "2026-03-31" },
          end: { date: "2026-04-03" },
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today[0].span).toBe("to THU");
    expect(result.upcoming).toEqual([]);
  });

  it("leaves single-day events unlabelled", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        { summary: "Standup", start: { dateTime: "2026-03-31T09:00:00+02:00" } },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect("span" in result.today[0]).toBe(false);
  });

  it("sorts a multi-day banner above single-day all-day events", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        // Deliberately not first in the API response.
        { summary: "Grocery run", start: { date: "2026-03-31" } },
        { summary: "Dentist", start: { dateTime: "2026-03-31T08:30:00+02:00" } },
        {
          summary: "Ski trip",
          start: { date: "2026-03-30" },
          end: { date: "2026-04-02" },
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today.map((e) => e.name)).toEqual([
      "Ski trip",
      "Grocery run",
      "Dentist",
    ]);
  });

  it("drops an event that ended before the window", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "Last week",
          start: { date: "2026-03-25" },
          end: { date: "2026-03-30" }, // exclusive → ends Mar 29
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toEqual([]);
    expect(result.upcoming).toEqual([]);
  });

  it("builds the span label in German", async () => {
    const de = i18next.getFixedT("de") as TFunction;
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock
      .mockResolvedValueOnce(
        googleEventsResponse([
          {
            summary: "Celle",
            start: { date: "2026-04-02" },
            end: { date: "2026-04-05" },
          },
        ]),
      )
      .mockResolvedValueOnce(
        googleEventsResponse([
          {
            summary: "Ski",
            start: { date: "2026-03-29" },
            end: { date: "2026-04-02" },
          },
        ]),
      );

    const future = await getDisplayEvents(sql, "Europe/Berlin", undefined, de, "de");
    expect(future.upcoming[0].events[0].span).toBe("bis SA");

    const running = await getDisplayEvents(sql, "Europe/Berlin", undefined, de, "de");
    expect(running.today[0].span).toBe("bis MI");
  });

  it("carries an overnight event into the next day as all day", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "Night shift",
          start: { dateTime: "2026-03-30T22:00:00+02:00" },
          end: { dateTime: "2026-03-31T06:00:00+02:00" },
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    // The start time belongs to yesterday; showing "22:00" under Today would
    // misrepresent it.
    expect(result.today).toEqual([
      { time: "all day", name: "Night shift", calendar: "CALENDAR" },
    ]);
    // It covers exactly one *visible* day, so it is not a span — regression
    // guard on the `lastIdx > firstIdx` predicate.
    expect("span" in result.today[0]).toBe(false);
  });

  it("keeps an evening event that ends at midnight on its start day", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    // Google encodes an evening that runs to midnight as an end of 00:00 the
    // next day, so this event's endKey lands on Wednesday. Collapsed into a
    // span it rendered as "TUE–WED Dinner", filed above the day's real all-day
    // items with the 20:00 thrown away.
    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "Dinner",
          start: { dateTime: "2026-03-31T20:00:00+02:00" },
          end: { dateTime: "2026-04-01T00:00:00+02:00" },
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toEqual([
      { time: "20:00", name: "Dinner", calendar: "CALENDAR" },
    ]);
    expect("span" in result.today[0]).toBe(false);
    // Not repeated under Wednesday either — it is one evening.
    expect(result.upcoming).toEqual([]);
  });

  it("keeps a timed event that runs past midnight on its start day", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    // Tomorrow 20:00 until 02:00 the day after: two visible days, but still an
    // event with an hour.
    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "Party",
          start: { dateTime: "2026-04-01T20:00:00+02:00" },
          end: { dateTime: "2026-04-02T02:00:00+02:00" },
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toEqual([]);
    expect(result.upcoming.map((d) => d.label)).toEqual(["Tomorrow"]);
    expect(result.upcoming[0].events).toEqual([
      { time: "20:00", name: "Party", calendar: "CALENDAR" },
    ]);
  });

  it("keeps the start time of a timed event covering several days", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    // A three-day timed range is still not an all-day event: Google would have
    // sent start.date if the user had meant one.
    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "On call",
          start: { dateTime: "2026-03-31T18:00:00+02:00" },
          end: { dateTime: "2026-04-03T06:00:00+02:00" },
        },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toEqual([
      { time: "18:00", name: "On call", calendar: "CALENDAR" },
    ]);
    expect(result.upcoming).toEqual([]);
  });

  it("sorts a midnight-crossing evening event by its start time", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock.mockResolvedValueOnce(
      googleEventsResponse([
        {
          summary: "Dinner",
          start: { dateTime: "2026-03-31T20:00:00+02:00" },
          end: { dateTime: "2026-04-01T00:00:00+02:00" },
        },
        { summary: "Grocery run", start: { date: "2026-03-31" } },
        { summary: "Standup", start: { dateTime: "2026-03-31T09:00:00+02:00" } },
      ]),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    // Not first: it is an evening, not a banner over the whole day.
    expect(result.today.map((e) => e.name)).toEqual([
      "Grocery run",
      "Standup",
      "Dinner",
    ]);
  });

  it("keeps other calendars when one of them fails", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeMultiConfig());

    fetchMock
      .mockRejectedValueOnce(new Error("Calendar API error: 404"))
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Standup", start: { dateTime: "2026-03-31T09:00:00+02:00" } },
        ]),
      );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toEqual([
      { time: "09:00", name: "Standup", calendar: "WORK" },
    ]);
    // A single broken calendar id must not trigger the token-refresh path.
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("returns empty arrays when calendar is not configured (empty calendarId)", async () => {
    resolveCalendarConfigMock.mockResolvedValue(
      makeConfig({ calendarId: "", accessToken: "tok" }),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result).toEqual({ today: [], upcoming: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty arrays when calendar has no tokens", async () => {
    resolveCalendarConfigMock.mockResolvedValue(
      makeConfig({ accessToken: "", refreshToken: "" }),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result).toEqual({ today: [], upcoming: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty arrays when fetch fails and token refresh also fails", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());
    fetchMock.mockRejectedValue(new Error("Network error"));
    refreshAccessTokenMock.mockRejectedValue(new Error("Refresh failed"));

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result).toEqual({ today: [], upcoming: [] });
  });

  it("retries with refreshed token on fetch failure", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    // First doFetch attempt: the only calendar's week fetch fails
    fetchMock
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      // Retry after refresh
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Meeting", start: { dateTime: "2026-03-31T11:00:00+02:00" } },
        ]),
      );

    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: null,
    });
    saveAllSettingsMock.mockResolvedValue(undefined);

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toHaveLength(1);
    expect(result.today[0].name).toBe("Meeting");

    // Verify token was saved
    expect(saveAllSettingsMock).toHaveBeenCalledWith(sql, {
      google_access_token: "new-access-token",
    });
  });

  it("works with single calendar config", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Lunch", start: { dateTime: "2026-03-31T12:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(emptyEventsResponse());

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toHaveLength(1);
    expect(result.today[0]).toEqual({
      time: "12:00",
      name: "Lunch",
      calendar: "CALENDAR",
    });
    expect(result.upcoming).toEqual([]);
    // Single calendar, single week window = 1 fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("filters calendars when selectedCalendars is provided", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeMultiConfig());

    fetchMock
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Family event", start: { dateTime: "2026-03-31T10:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(emptyEventsResponse());

    const result = await getDisplayEvents(sql, "Europe/Berlin", ["Family"]);

    expect(result.today).toHaveLength(1);
    expect(result.today[0].calendar).toBe("FAMILY");
    // Only the selected calendar is fetched
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles events with no summary gracefully", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock
      .mockResolvedValueOnce(
        googleEventsResponse([
          { start: { dateTime: "2026-03-31T14:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(emptyEventsResponse());

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today[0].name).toBe("(no title)");
  });

  // ─── Explicit TS-labeled scenarios ───────────────────────────

  it("TS-5.2 — display_calendars filter restricts to selected calendar only", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeMultiConfig());

    // Expected: 1 fetch (Family's week). Work not fetched.
    fetchMock
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Family event", start: { dateTime: "2026-03-31T10:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(emptyEventsResponse());

    const result = await getDisplayEvents(sql, "Europe/Berlin", ["Family"]);

    expect(result.today).toHaveLength(1);
    expect(result.today[0].calendar).toBe("FAMILY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No URL should reference the WORK calendar id
    for (const call of fetchMock.mock.calls) {
      expect((call[0] as string)).not.toContain("work%40");
    }
  });

  it("TS-5.3 — empty selectedCalendars array means all calendars", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeMultiConfig());

    fetchMock
      .mockResolvedValue(emptyEventsResponse());

    await getDisplayEvents(sql, "Europe/Berlin", []);

    // Both calendars, one week window each = 2 fetches
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("TS-5.4 — undefined selectedCalendars means all calendars", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeMultiConfig());

    fetchMock.mockResolvedValue(emptyEventsResponse());

    await getDisplayEvents(sql, "Europe/Berlin", undefined);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("TS-E-2 — exactly one OAuth refresh on fetch failure, then retry succeeds", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Retried", start: { dateTime: "2026-03-31T11:00:00+02:00" } },
        ]),
      );

    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "fresh",
      refreshToken: null,
    });
    saveAllSettingsMock.mockResolvedValue(undefined);

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(result.today).toHaveLength(1);
    expect(result.today[0].name).toBe("Retried");
  });

  it("TS-E-8 — event with missing summary still present with fallback title, no throw", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock
      .mockResolvedValueOnce(
        googleEventsResponse([
          { start: { dateTime: "2026-03-31T14:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(emptyEventsResponse());

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toHaveLength(1);
    expect(result.today[0].name).toBe("(no title)");
  });

  // ─── Entry Visibility — NG-5 guard ───────────────────────────
  // TS-2.3 — calendar events are NOT filtered by Cortex entry visibility.
  // `getDisplayEvents` must read only from Google; it must never touch the
  // entries table. This test guards against a future coupling where display
  // calendar fetches get wired through the entries table with a visibility
  // filter that would drop events for private entries.
  it("TS-2.3 — does not read the entries table when fetching display events", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock
      .mockResolvedValueOnce(
        googleEventsResponse([
          {
            summary: "Household dinner",
            start: { dateTime: "2026-03-31T19:00:00+02:00" },
          },
        ]),
      )
      .mockResolvedValueOnce(emptyEventsResponse());

    const sqlCalls: Array<{ query: string }> = [];
    const entriesSql = Object.assign(
      vi.fn((strings: TemplateStringsArray) => {
        sqlCalls.push({ query: strings.join("?") });
        return Promise.resolve([]);
      }),
      { unsafe: vi.fn().mockResolvedValue([]) },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getDisplayEvents(entriesSql as any, "Europe/Berlin");

    expect(result.today).toHaveLength(1);
    expect(result.today[0].name).toBe("Household dinner");
    // No sql call touched the entries table.
    for (const call of sqlCalls) {
      expect(call.query.toLowerCase()).not.toContain("from entries");
      expect(call.query.toLowerCase()).not.toContain("visibility");
    }
  });
});

// ─── formatEventSpan (pure, no fetch mocking needed) ──────────

describe("formatEventSpan", () => {
  beforeAll(async () => {
    await initI18n();
  });

  const thu = new Date("2026-04-02T12:00:00+02:00");
  const sat = new Date("2026-04-04T12:00:00+02:00");

  it("states the end day only", () => {
    // The start day is never stated: a span always renders on its own first
    // visible day, whose heading already names it.
    expect(formatEventSpan(sat, "Europe/Berlin")).toBe("to SAT");
    expect(formatEventSpan(thu, "Europe/Berlin")).toBe("to THU");
  });

  it("localizes the label", () => {
    const de = i18next.getFixedT("de") as TFunction;
    expect(formatEventSpan(sat, "Europe/Berlin", de, "de")).toBe("bis SA");
  });

  it("strips the trailing dot some ICU builds emit for German", () => {
    const de = i18next.getFixedT("de") as TFunction;
    expect(formatEventSpan(thu, "Europe/Berlin", de, "de")).toBe("bis DO");
  });
});
