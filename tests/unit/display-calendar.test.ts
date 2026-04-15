import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { getDisplayEvents } from "../../src/display/calendar-data.js";

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
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T10:00:00+02:00"));
  });

  it("fetches today and tomorrow events from all calendars", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeMultiConfig());

    // Family today, Family tomorrow, Work today, Work tomorrow
    fetchMock
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Dentist — Mila", start: { dateTime: "2026-03-31T08:30:00+02:00" } },
          { summary: "Grocery run", start: { date: "2026-03-31" } },
        ]),
      )
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Family dinner", start: { dateTime: "2026-04-01T18:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Standup", start: { dateTime: "2026-03-31T09:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Sprint review", start: { dateTime: "2026-04-01T14:00:00+02:00" } },
          { summary: "Planning", start: { dateTime: "2026-04-01T15:00:00+02:00" } },
          { summary: "Retro", start: { dateTime: "2026-04-01T16:00:00+02:00" } },
          { summary: "Should be cut", start: { dateTime: "2026-04-01T17:00:00+02:00" } },
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

    // Tomorrow: limited to 3 events
    expect(result.tomorrow).toHaveLength(3);
    expect(result.tomorrow[0]).toEqual({
      time: "14:00",
      name: "Sprint review",
      calendar: "WORK",
    });
    expect(result.tomorrow[1]).toEqual({
      time: "15:00",
      name: "Planning",
      calendar: "WORK",
    });
    expect(result.tomorrow[2]).toEqual({
      time: "16:00",
      name: "Retro",
      calendar: "WORK",
    });

    // Verify fetch calls: 2 calendars x 2 days = 4 fetches
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Verify auth header
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall[1].headers.Authorization).toBe("Bearer access-token-123");
  });

  it("returns empty arrays when calendar is not configured (empty calendarId)", async () => {
    resolveCalendarConfigMock.mockResolvedValue(
      makeConfig({ calendarId: "", accessToken: "tok" }),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result).toEqual({ today: [], tomorrow: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty arrays when calendar has no tokens", async () => {
    resolveCalendarConfigMock.mockResolvedValue(
      makeConfig({ accessToken: "", refreshToken: "" }),
    );

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result).toEqual({ today: [], tomorrow: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty arrays when fetch fails and token refresh also fails", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());
    fetchMock.mockRejectedValue(new Error("Network error"));
    refreshAccessTokenMock.mockRejectedValue(new Error("Refresh failed"));

    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result).toEqual({ today: [], tomorrow: [] });
  });

  it("retries with refreshed token on fetch failure", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    // First doFetch attempt: both today + tomorrow fetches fail
    fetchMock
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      // Retry after refresh: today events, tomorrow events
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Meeting", start: { dateTime: "2026-03-31T11:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(emptyEventsResponse());

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
    expect(result.tomorrow).toEqual([]);
    // Single calendar: 1 today fetch + 1 tomorrow fetch = 2
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    // Only 1 calendar x 2 days = 2 fetches
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

    // Expected: 2 fetches (Family today + Family tomorrow). Work not fetched.
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

    // Both calendars x 2 days = 4 fetches
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("TS-5.4 — undefined selectedCalendars means all calendars", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeMultiConfig());

    fetchMock.mockResolvedValue(emptyEventsResponse());

    await getDisplayEvents(sql, "Europe/Berlin", undefined);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("TS-E-2 — exactly one OAuth refresh on fetch failure, then retry succeeds", async () => {
    resolveCalendarConfigMock.mockResolvedValue(makeConfig());

    fetchMock
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      .mockRejectedValueOnce(new Error("401 Unauthorized"))
      .mockResolvedValueOnce(
        googleEventsResponse([
          { summary: "Retried", start: { dateTime: "2026-03-31T11:00:00+02:00" } },
        ]),
      )
      .mockResolvedValueOnce(emptyEventsResponse());

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
});
