import type postgres from "postgres";
import type { DisplayEvent } from "./types.js";
import { resolveCalendarConfig, refreshAccessToken } from "../google-calendar.js";
import { saveAllSettings } from "../web/settings-queries.js";
import { createLogger } from "../logger.js";

const log = createLogger("display-calendar");

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

// ─── Time Range Helpers ───────────────────────────────────────

function startOfDay(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = formatter.format(date); // YYYY-MM-DD
  return `${dateStr}T00:00:00`;
}

function endOfDay(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = formatter.format(date);
  return `${dateStr}T23:59:59`;
}

function toISOWithTz(localDateTime: string, timezone: string): string {
  // Create a Date from the local time string interpreted in the given timezone
  // We need to produce an ISO string with offset for the Google Calendar API
  const d = new Date(localDateTime);
  // Use a trick: format with the timezone to get the offset
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(d);
  const offsetPart = parts.find((p) => p.type === "timeZoneName");
  // offsetPart.value is like "GMT+02:00" or "GMT-05:00" or "GMT"
  let offset = "+00:00";
  if (offsetPart) {
    const val = offsetPart.value;
    if (val === "GMT") {
      offset = "+00:00";
    } else {
      offset = val.replace("GMT", "");
    }
  }
  return `${localDateTime}${offset}`;
}

// ─── Event Mapping ────────────────────────────────────────────

interface GoogleEvent {
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

function mapEvent(event: GoogleEvent, calendarName: string): DisplayEvent {
  let time = "all day";
  if (event.start?.dateTime) {
    // Extract HH:MM from ISO datetime string
    const match = event.start.dateTime.match(/T(\d{2}:\d{2})/);
    if (match) {
      time = match[1];
    }
  }
  return {
    time,
    name: event.summary || "(no title)",
    calendar: calendarName.toUpperCase(),
  };
}

function sortEvents(events: DisplayEvent[]): DisplayEvent[] {
  return events.sort((a, b) => {
    // "all day" events come first
    if (a.time === "all day" && b.time !== "all day") return -1;
    if (a.time !== "all day" && b.time === "all day") return 1;
    if (a.time === "all day" && b.time === "all day") return 0;
    return a.time.localeCompare(b.time);
  });
}

// ─── Fetch Events ─────────────────────────────────────────────

async function fetchCalendarEvents(
  calendarId: string,
  accessToken: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Calendar API error: ${res.status}`);
  }

  const data = (await res.json()) as { items?: GoogleEvent[] };
  return data.items ?? [];
}

// ─── Main Export ──────────────────────────────────────────────

export async function getDisplayEvents(
  sql: postgres.Sql,
  timezone: string,
  selectedCalendars?: string[],
): Promise<{ today: DisplayEvent[]; tomorrow: DisplayEvent[] }> {
  const empty = { today: [], tomorrow: [] };

  try {
    const config = await resolveCalendarConfig(sql);

    // Check if calendar is configured
    if (!config.calendarId || (!config.accessToken && !config.refreshToken)) {
      return empty;
    }

    // Build calendar list: { name -> calendarId }
    let calendarsToFetch: Record<string, string>;
    if (config.calendars && Object.keys(config.calendars).length >= 2) {
      calendarsToFetch = { ...config.calendars };
    } else {
      // Single calendar mode — use a generic name
      calendarsToFetch = { calendar: config.calendarId };
    }

    // Filter by selectedCalendars if provided
    if (selectedCalendars && selectedCalendars.length > 0) {
      const selected = new Set(selectedCalendars.map((s) => s.toUpperCase()));
      const filtered: Record<string, string> = {};
      for (const [name, id] of Object.entries(calendarsToFetch)) {
        if (selected.has(name.toUpperCase())) {
          filtered[name] = id;
        }
      }
      calendarsToFetch = filtered;
    }

    if (Object.keys(calendarsToFetch).length === 0) {
      return empty;
    }

    // Build time ranges
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayMin = toISOWithTz(startOfDay(now, timezone), timezone);
    const todayMax = toISOWithTz(endOfDay(now, timezone), timezone);
    const tomorrowMin = toISOWithTz(startOfDay(tomorrow, timezone), timezone);
    const tomorrowMax = toISOWithTz(endOfDay(tomorrow, timezone), timezone);

    let accessToken = config.accessToken;

    const doFetch = async (): Promise<{ today: DisplayEvent[]; tomorrow: DisplayEvent[] }> => {
      const todayEvents: DisplayEvent[] = [];
      const tomorrowEvents: DisplayEvent[] = [];

      for (const [name, calendarId] of Object.entries(calendarsToFetch)) {
        const [todayRaw, tomorrowRaw] = await Promise.all([
          fetchCalendarEvents(calendarId, accessToken, todayMin, todayMax),
          fetchCalendarEvents(calendarId, accessToken, tomorrowMin, tomorrowMax),
        ]);

        for (const ev of todayRaw) {
          todayEvents.push(mapEvent(ev, name));
        }
        for (const ev of tomorrowRaw) {
          tomorrowEvents.push(mapEvent(ev, name));
        }
      }

      return {
        today: sortEvents(todayEvents),
        tomorrow: sortEvents(tomorrowEvents).slice(0, 3),
      };
    };

    try {
      return await doFetch();
    } catch (err) {
      // Try token refresh
      try {
        const tokens = await refreshAccessToken(
          config.refreshToken,
          config.clientId,
          config.clientSecret,
        );
        const tokensToSave: Record<string, string> = {
          google_access_token: tokens.accessToken,
        };
        if (tokens.refreshToken) {
          tokensToSave.google_refresh_token = tokens.refreshToken;
        }
        await saveAllSettings(sql, tokensToSave);
        accessToken = tokens.accessToken;
        return await doFetch();
      } catch (retryErr) {
        log.error("Calendar fetch failed after token refresh", {
          error: (retryErr as Error).message,
        });
        return empty;
      }
    }
  } catch (err) {
    log.error("Calendar data fetch failed", {
      error: (err as Error).message,
    });
    return empty;
  }
}
