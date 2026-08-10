import type postgres from "postgres";
// Side-effect import: registers the translation catalogs with i18next.
// A type-only import would be erased and leave t() resolving to nothing.
import "../web/i18n/index.js";
import i18next, { type TFunction } from "i18next";
import { ALL_DAY, type DisplayDay, type DisplayEvent } from "./types.js";
import type { Locale } from "../web/i18n/index.js";
import { resolveCalendarConfig, refreshAccessToken } from "../google-calendar.js";
import { saveAllSettings } from "../web/settings-queries.js";
import { createLogger } from "../logger.js";

const log = createLogger("display-calendar");

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

// Today plus the six days after it.
const WEEK_DAYS = 7;

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

/**
 * A display event tagged with the span of local days it covers. Google returns
 * every event *overlapping* the requested window, so an event may well have
 * started before the window opened — keying only on the start day would drop
 * multi-day trips and overnight events entirely.
 *
 * `allDay` records how Google encoded the event, not how it happens to be
 * bucketed: only a genuine all-day event (`start.date`) may collapse into a
 * day span. A timed event that runs past midnight — 20:00–00:00 is Google's
 * usual encoding for an evening — is still an event with an hour, and saying
 * "TUE–WED" for a dinner throws that hour away and files it above the day's
 * real all-day items.
 */
type SpannedEvent = DisplayEvent & {
  startKey: string;
  endKey: string;
  allDay: boolean;
};

/** Shift a YYYY-MM-DD key by whole days, calendar-arithmetic only. */
function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

function mapEvent(event: GoogleEvent, calendarName: string): SpannedEvent {
  let time = ALL_DAY;
  if (event.start?.dateTime) {
    // Extract HH:MM from ISO datetime string
    const match = event.start.dateTime.match(/T(\d{2}:\d{2})/);
    if (match) {
      time = match[1];
    }
  }

  const startKey = (event.start?.dateTime || event.start?.date || "").slice(0, 10);

  let endKey = startKey;
  if (event.end?.dateTime) {
    endKey = event.end.dateTime.slice(0, 10);
  } else if (event.end?.date) {
    // All-day end dates are exclusive: a single-day event on the 3rd ends on
    // the 4th. Step back so the span stays inclusive like the timed case.
    endKey = shiftDayKey(event.end.date.slice(0, 10), -1);
  }
  // Malformed or inverted ranges collapse to the start day rather than
  // producing an empty span that renders nowhere.
  if (endKey < startKey) endKey = startKey;

  return {
    time,
    name: event.summary || "(no title)",
    calendar: calendarName.toUpperCase(),
    startKey,
    endKey,
    // `start.date` is Google's all-day encoding; `start.dateTime` always
    // carries a real clock time, however far past midnight the event runs.
    allDay: !event.start?.dateTime,
  };
}

/** Local YYYY-MM-DD for a date, in the display timezone. */
function dayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function weekdayName(date: Date, timezone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
  }).format(date);
}

/** "THU" / "DO" — uppercase to match the panel's label idiom. */
function weekdayAbbr(date: Date, timezone: string, locale: Locale): string {
  return (
    new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short" })
      .format(date)
      // Some ICU builds emit "Do." for German; the trailing dot costs a glyph
      // in a fixed-width gutter and buys nothing.
      .replace(/\.$/, "")
      .toUpperCase()
  );
}

/**
 * The span label for a multi-day event, clamped to the visible week.
 *
 * Only the end is stated. A span always renders on the first day it is
 * visible, so the group heading directly above it already names the start day:
 * "MORGEN / DO–SA" makes the reader reconcile two labels for the same day, and
 * under "HEUTE" it read "MI–SA". "bis SA" adds what the heading does not
 * already say, and nothing else. An end running past the window is clamped
 * silently to the last visible day — the panel only claims a 7-day horizon.
 */
export function formatEventSpan(
  endDay: Date,
  timezone: string,
  t: TFunction = i18next.getFixedT("en") as TFunction,
  locale: Locale = "en",
): string {
  return t("display.event_span_until", {
    to: weekdayAbbr(endDay, timezone, locale),
  });
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sortEvents<T extends DisplayEvent>(events: T[]): T[] {
  return events.sort((a, b) => {
    // "all day" events come first
    if (a.time === ALL_DAY && b.time !== ALL_DAY) return -1;
    if (a.time !== ALL_DAY && b.time === ALL_DAY) return 1;
    if (a.time === ALL_DAY && b.time === ALL_DAY) {
      // A multi-day event is context for everything under it ("we're away") —
      // it heads the day rather than sitting somewhere in the all-day block.
      // Array.prototype.sort is stable in V8, so single-day all-day events
      // keep their relative order.
      return (a.span ? 0 : 1) - (b.span ? 0 : 1);
    }
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
    // A week across several calendars, not a single day.
    maxResults: "100",
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
  // The device sends no cookie, so the display's language comes from settings
  // rather than a request context; English is the fallback.
  t: TFunction = i18next.getFixedT("en") as TFunction,
  locale: Locale = "en",
): Promise<{ today: DisplayEvent[]; upcoming: DisplayDay[] }> {
  const empty = { today: [], upcoming: [] };

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

    // One window covering today plus the rest of the week, fetched once per
    // calendar rather than once per calendar per day.
    const now = new Date();
    const lastDay = addDays(now, WEEK_DAYS - 1);
    const weekMin = toISOWithTz(startOfDay(now, timezone), timezone);
    const weekMax = toISOWithTz(endOfDay(lastDay, timezone), timezone);

    // Day buckets in display order: index 0 is today.
    const dayKeys = Array.from({ length: WEEK_DAYS }, (_, i) =>
      dayKey(addDays(now, i), timezone),
    );

    let accessToken = config.accessToken;

    const doFetch = async (): Promise<{ today: DisplayEvent[]; upcoming: DisplayDay[] }> => {
      const calendars = Object.entries(calendarsToFetch);
      const byDay = new Map<string, DisplayEvent[]>(
        dayKeys.map((key) => [key, []]),
      );
      const windowStart = dayKeys[0];
      const windowEnd = dayKeys[WEEK_DAYS - 1];
      let failures = 0;

      for (const [name, calendarId] of calendars) {
        let raw: GoogleEvent[];
        try {
          raw = await fetchCalendarEvents(calendarId, accessToken, weekMin, weekMax);
        } catch (err) {
          // One unreachable calendar must not blank out the others.
          failures++;
          log.warn("Calendar fetch failed, skipping", {
            calendar: name,
            error: (err as Error).message,
          });
          continue;
        }

        for (const ev of raw) {
          const { startKey, endKey, allDay, ...event } = mapEvent(ev, name);

          // Google returns overlapping events only, but a malformed range must
          // not land nowhere or throw.
          if (endKey < windowStart || startKey > windowEnd) continue;

          // Clamp the span to the visible week. Keys are consecutive days, so
          // a key inside the range is always one of dayKeys.
          const firstIdx = startKey <= windowStart ? 0 : dayKeys.indexOf(startKey);
          const lastIdx = endKey >= windowEnd ? WEEK_DAYS - 1 : dayKeys.indexOf(endKey);
          if (firstIdx < 0 || lastIdx < 0) continue;

          const startsInWindow = startKey >= windowStart;

          // Only a genuine all-day event becomes a span. A timed event that
          // crosses midnight (a 20:00–00:00 dinner, a 22:00–06:00 night shift)
          // still has an hour worth showing, and collapsing it would both lose
          // that hour and sort it above the day's real all-day items.
          if (allDay && lastIdx > firstIdx) {
            // Rendered once, on the first day it is visible — a running trip
            // belongs on today's screen, a future one on the day it starts.
            // Repeating it under every weekday heading said nothing new three
            // times.
            byDay.get(dayKeys[firstIdx])!.push({
              ...event,
              // ALL_DAY is the sort key, not the label: the gutter shows the
              // span.
              time: ALL_DAY,
              span: formatEventSpan(addDays(now, lastIdx), timezone, t, locale),
            });
          } else {
            byDay.get(dayKeys[firstIdx])!.push(
              // Filed on its start day, with its start time — including a
              // timed event that runs past midnight, whose "when" is still the
              // hour it begins. Only when the start fell outside the window is
              // the time dropped: "22:00" on the morning after an overnight
              // event would misrepresent it.
              startsInWindow ? event : { ...event, time: ALL_DAY },
            );
          }
        }
      }

      // Every calendar failing usually means the token died — surface it so the
      // caller can refresh and retry rather than rendering a silently empty week.
      if (failures > 0 && failures === calendars.length) {
        throw new Error(`All ${failures} calendar fetches failed`);
      }

      const upcoming: DisplayDay[] = [];
      for (let i = 1; i < WEEK_DAYS; i++) {
        const events = byDay.get(dayKeys[i]) ?? [];
        if (events.length === 0) continue;
        upcoming.push({
          label:
            i === 1
              ? t("display.tomorrow")
              : weekdayName(addDays(now, i), timezone, locale),
          events: sortEvents(events),
        });
      }

      return { today: sortEvents(byDay.get(dayKeys[0]) ?? []), upcoming };
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
