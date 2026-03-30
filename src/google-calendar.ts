import type postgres from "postgres";
import { getAllSettings, saveAllSettings } from "./web/settings-queries.js";
import { createLogger } from "./logger.js";

const log = createLogger("google-calendar");

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TIME_RE = /^\d{2}:\d{2}$/;

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

interface CalendarConfig {
  calendarId: string;
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  defaultDuration: number;
  calendars?: Record<string, string>;
  defaultCalendar?: string;
}

export async function resolveCalendarConfig(sql?: postgres.Sql): Promise<CalendarConfig> {
  const settings: Record<string, string> = sql ? await getAllSettings(sql) : {};

  const calendarId = settings.google_calendar_id || "";
  const accessToken = settings.google_access_token || "";
  const refreshToken = settings.google_refresh_token || "";
  const clientId = settings.google_client_id || "";
  const clientSecret = settings.google_client_secret || "";

  let defaultDuration = 60;
  const durationStr = settings.google_calendar_default_duration;
  if (durationStr) {
    const parsed = parseInt(durationStr, 10);
    if (!isNaN(parsed) && parsed >= 15 && parsed <= 480) {
      defaultDuration = parsed;
    }
  }

  // Multi-calendar support
  let calendars: Record<string, string> | undefined;
  let defaultCalendar: string | undefined;
  const calendarsJson = settings.google_calendars;
  if (calendarsJson) {
    try {
      const parsed = JSON.parse(calendarsJson) as Record<string, string>;
      const entries = Object.entries(parsed).filter(([k, v]) => k && v);
      if (entries.length >= 2) {
        calendars = Object.fromEntries(entries);
        // Resolve default calendar
        const defaultName = settings.google_calendar_default;
        if (defaultName && calendars[defaultName]) {
          defaultCalendar = defaultName;
        } else {
          // Fall back to first calendar
          defaultCalendar = entries[0][0];
        }
      } else if (entries.length === 1) {
        // Single entry in google_calendars = single-calendar mode
        return { calendarId: entries[0][1], accessToken, refreshToken, clientId, clientSecret, defaultDuration };
      }
    } catch {
      // Invalid JSON — fall through to single-calendar
    }
  }

  if (calendars) {
    return { calendarId: calendars[defaultCalendar!], accessToken, refreshToken, clientId, clientSecret, defaultDuration, calendars, defaultCalendar };
  }

  return { calendarId, accessToken, refreshToken, clientId, clientSecret, defaultDuration };
}

export async function isCalendarConfigured(sql?: postgres.Sql): Promise<boolean> {
  const config = await resolveCalendarConfig(sql);
  return !!(config.refreshToken || config.accessToken) && !!config.calendarId;
}

// ---------------------------------------------------------------------------
// Calendar names (for classification prompt)
// ---------------------------------------------------------------------------

export async function getCalendarNames(sql?: postgres.Sql): Promise<string[] | undefined> {
  const config = await resolveCalendarConfig(sql);
  if (config.calendars && Object.keys(config.calendars).length >= 2) {
    return Object.keys(config.calendars);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Calendar ID resolution
// ---------------------------------------------------------------------------

function resolveTargetCalendarId(config: CalendarConfig, calendarName?: string | null): string {
  if (!config.calendars) {
    // Single-calendar mode
    return config.calendarId;
  }
  if (calendarName && config.calendars[calendarName]) {
    return config.calendars[calendarName];
  }
  // Fallback to default
  if (calendarName) {
    log.warn("Unrecognized calendar_name, using default", { calendarName, default: config.defaultCalendar });
  }
  return config.calendars[config.defaultCalendar!] || config.calendarId;
}

// ---------------------------------------------------------------------------
// Google Calendar API
// ---------------------------------------------------------------------------

function addMinutes(date: string, time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date}T${pad(endH)}:${pad(endM)}:00`;
}

function buildEventBody(params: {
  name: string;
  content: string;
  calendarDate: string;
  calendarTime: string | null;
  defaultDuration: number;
}) {
  const { name, content, calendarDate, calendarTime, defaultDuration } = params;
  const validTime = calendarTime && TIME_RE.test(calendarTime) ? calendarTime : null;

  const body: Record<string, unknown> = {
    summary: name,
    description: content,
  };

  const tz = process.env.TZ || "Europe/Berlin";

  if (validTime) {
    body.start = { dateTime: `${calendarDate}T${validTime}:00`, timeZone: tz };
    body.end = { dateTime: addMinutes(calendarDate, validTime, defaultDuration), timeZone: tz };
  } else {
    // All-day event: end date is next day
    const endDate = new Date(calendarDate + "T00:00:00Z");
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endStr = endDate.toISOString().split("T")[0];
    body.start = { date: calendarDate };
    body.end = { date: endStr };
  }

  return body;
}

export async function createCalendarEvent(
  config: CalendarConfig,
  params: { name: string; content: string; calendarDate: string; calendarTime: string | null },
): Promise<{ id: string }> {
  const body = buildEventBody({ ...params, defaultDuration: config.defaultDuration });
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(config.calendarId)}/events`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Calendar API error: ${res.status} ${errBody}`);
  }

  const data = (await res.json()) as { id: string };
  return { id: data.id };
}

export async function updateCalendarEvent(
  config: CalendarConfig,
  eventId: string,
  params: { name: string; content: string; calendarDate: string; calendarTime: string | null },
): Promise<{ id: string }> {
  const body = buildEventBody({ ...params, defaultDuration: config.defaultDuration });
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Calendar update error: ${res.status} ${errBody}`);
  }

  const data = (await res.json()) as { id: string };
  return { id: data.id };
}

export async function deleteCalendarEvent(
  config: CalendarConfig,
  eventId: string,
): Promise<void> {
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Calendar delete error: ${res.status} ${errBody}`);
  }
}

// ---------------------------------------------------------------------------
// OAuth2
// ---------------------------------------------------------------------------

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Token refresh failed: ${errorData.error || res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
  };
}

export async function exchangeAuthCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Auth code exchange failed: ${errorData.error || res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}

// ---------------------------------------------------------------------------
// Orchestrators
// ---------------------------------------------------------------------------

interface CalendarResult {
  created: boolean;
  eventId?: string;
  date?: string;
  error?: string;
}

export async function processCalendarEvent(
  sql: postgres.Sql,
  entryId: string,
  classificationResult: {
    create_calendar_event?: boolean;
    calendar_date?: string | null;
    calendar_time?: string | null;
    calendar_name?: string | null;
  },
): Promise<CalendarResult> {
  try {
    // --- No calendar requested ---
    if (!classificationResult.create_calendar_event) {
      // Check if entry has an existing event to delete (reclassification case)
      const rows = await sql`
        SELECT google_calendar_event_id, google_calendar_target FROM entries WHERE id = ${entryId}
      `;
      const existingEventId = rows[0]?.google_calendar_event_id as string | null;
      const existingTarget = rows[0]?.google_calendar_target as string | null;

      if (existingEventId) {
        // Delete the event from Google Calendar
        try {
          const config = await resolveCalendarConfig(sql);
          const deleteConfig = existingTarget
            ? { ...config, calendarId: existingTarget }
            : config;
          await deleteCalendarEvent(deleteConfig, existingEventId);
        } catch (e) {
          log.error("Failed to delete calendar event", { entryId, error: (e as Error).message });
        }
        await sql`
          UPDATE entries SET google_calendar_event_id = NULL, google_calendar_target = NULL WHERE id = ${entryId}
        `;
      }

      return { created: false };
    }

    // --- Calendar requested but no date ---
    if (!classificationResult.calendar_date) {
      return { created: false };
    }

    // --- Check if configured ---
    const config = await resolveCalendarConfig(sql);
    if ((!config.refreshToken && !config.accessToken) || !config.calendarId) {
      return { created: false };
    }

    // Get entry data
    const entryRows = await sql`
      SELECT id, name, content, google_calendar_event_id, google_calendar_target FROM entries WHERE id = ${entryId}
    `;
    const entry = entryRows[0] as {
      id: string; name: string; content: string;
      google_calendar_event_id: string | null;
      google_calendar_target: string | null;
    } | undefined;
    if (!entry) {
      return { created: false, error: "Entry not found" };
    }

    const eventParams = {
      name: entry.name,
      content: entry.content || "",
      calendarDate: classificationResult.calendar_date,
      calendarTime: classificationResult.calendar_time || null,
    };

    const existingEventId = entry.google_calendar_event_id;
    const existingTarget = entry.google_calendar_target;

    // Resolve which calendar to target
    const isMultiCalendar = !!config.calendars;
    const targetCalendarId = resolveTargetCalendarId(config, classificationResult.calendar_name);

    // Check if calendar changed (multi-calendar reclassification)
    const calendarChanged = isMultiCalendar && existingEventId && existingTarget && existingTarget !== targetCalendarId;

    // --- Calendar change: delete old + create new ---
    if (calendarChanged) {
      const doCalendarChange = async (cfg: CalendarConfig) => {
        // Delete from old calendar
        const oldConfig = { ...cfg, calendarId: existingTarget! };
        await deleteCalendarEvent(oldConfig, existingEventId!);
        // Create on new calendar
        const newConfig = { ...cfg, calendarId: targetCalendarId };
        const result = await createCalendarEvent(newConfig, eventParams);
        return result.id;
      };

      try {
        const newEventId = await doCalendarChange(config);
        await sql`
          UPDATE entries SET google_calendar_event_id = ${newEventId}, google_calendar_target = ${targetCalendarId} WHERE id = ${entryId}
        `;
        return { created: true, eventId: newEventId, date: classificationResult.calendar_date };
      } catch (firstError) {
        const err = firstError as Error;
        if (err.message.includes("401")) {
          try {
            const tokens = await refreshAccessToken(config.refreshToken, config.clientId, config.clientSecret);
            const tokensToSave: Record<string, string> = { google_access_token: tokens.accessToken };
            if (tokens.refreshToken) tokensToSave.google_refresh_token = tokens.refreshToken;
            await saveAllSettings(sql, tokensToSave);
            const updatedConfig = { ...config, accessToken: tokens.accessToken };
            const newEventId = await doCalendarChange(updatedConfig);
            await sql`
              UPDATE entries SET google_calendar_event_id = ${newEventId}, google_calendar_target = ${targetCalendarId} WHERE id = ${entryId}
            `;
            return { created: true, eventId: newEventId, date: classificationResult.calendar_date };
          } catch (retryError) {
            log.error("Calendar change retry failed", { entryId, error: (retryError as Error).message });
            return { created: false, error: (retryError as Error).message };
          }
        }
        try {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const newEventId = await doCalendarChange(config);
          await sql`
            UPDATE entries SET google_calendar_event_id = ${newEventId}, google_calendar_target = ${targetCalendarId} WHERE id = ${entryId}
          `;
          return { created: true, eventId: newEventId, date: classificationResult.calendar_date };
        } catch (retryError) {
          log.error("Calendar change retry failed", { entryId, error: (retryError as Error).message });
          return { created: false, error: (retryError as Error).message };
        }
      }
    }

    // --- Standard create or update ---
    const opCalendarId = existingTarget || targetCalendarId;
    const opConfig = { ...config, calendarId: opCalendarId };

    const doCalendarOp = async (cfg: CalendarConfig) => {
      if (existingEventId) {
        const result = await updateCalendarEvent(cfg, existingEventId, eventParams);
        return result.id;
      } else {
        const result = await createCalendarEvent(cfg, eventParams);
        return result.id;
      }
    };

    try {
      const eventId = await doCalendarOp(opConfig);
      if (!existingEventId) {
        if (isMultiCalendar) {
          await sql`
            UPDATE entries SET google_calendar_event_id = ${eventId}, google_calendar_target = ${targetCalendarId} WHERE id = ${entryId}
          `;
        } else {
          await sql`
            UPDATE entries SET google_calendar_event_id = ${eventId} WHERE id = ${entryId}
          `;
        }
      }
      return { created: true, eventId, date: classificationResult.calendar_date };
    } catch (firstError) {
      // --- Retry logic ---
      const err = firstError as Error & { message: string };

      // Check if it's a 401 (token expired)
      if (err.message.includes("401")) {
        try {
          const tokens = await refreshAccessToken(config.refreshToken, config.clientId, config.clientSecret);
          // Store new tokens
          const tokensToSave: Record<string, string> = {
            google_access_token: tokens.accessToken,
          };
          if (tokens.refreshToken) {
            tokensToSave.google_refresh_token = tokens.refreshToken;
          }
          await saveAllSettings(sql, tokensToSave);

          // Retry with new token
          const updatedConfig = { ...opConfig, accessToken: tokens.accessToken };
          const eventId = await doCalendarOp(updatedConfig);
          if (!existingEventId) {
            if (isMultiCalendar) {
              await sql`
                UPDATE entries SET google_calendar_event_id = ${eventId}, google_calendar_target = ${targetCalendarId} WHERE id = ${entryId}
              `;
            } else {
              await sql`
                UPDATE entries SET google_calendar_event_id = ${eventId} WHERE id = ${entryId}
              `;
            }
          }
          return { created: true, eventId, date: classificationResult.calendar_date };
        } catch (retryError) {
          log.error("Calendar retry after token refresh failed", {
            entryId,
            error: (retryError as Error).message,
          });
          return { created: false, error: (retryError as Error).message };
        }
      }

      // Non-401 error: retry once after delay
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const eventId = await doCalendarOp(opConfig);
        if (!existingEventId) {
          if (isMultiCalendar) {
            await sql`
              UPDATE entries SET google_calendar_event_id = ${eventId}, google_calendar_target = ${targetCalendarId} WHERE id = ${entryId}
            `;
          } else {
            await sql`
              UPDATE entries SET google_calendar_event_id = ${eventId} WHERE id = ${entryId}
            `;
          }
        }
        return { created: true, eventId, date: classificationResult.calendar_date };
      } catch (retryError) {
        log.error("Calendar retry failed", {
          entryId,
          error: (retryError as Error).message,
        });
        return { created: false, error: (retryError as Error).message };
      }
    }
  } catch (e) {
    log.error("Calendar event processing failed", {
      entryId,
      error: (e as Error).message,
    });
    return { created: false, error: (e as Error).message };
  }
}

export async function handleEntryCalendarCleanup(
  sql: postgres.Sql,
  entryId: string,
): Promise<void> {
  try {
    const rows = await sql`
      SELECT google_calendar_event_id, google_calendar_target FROM entries WHERE id = ${entryId}
    `;
    const eventId = rows[0]?.google_calendar_event_id as string | null;
    const calendarTarget = rows[0]?.google_calendar_target as string | null;
    if (!eventId) return;

    const config = await resolveCalendarConfig(sql);
    if (!config.calendarId || (!config.refreshToken && !config.accessToken)) return;

    // Use stored calendar target if available, otherwise fall back to config
    const deleteConfig = calendarTarget
      ? { ...config, calendarId: calendarTarget }
      : config;

    await deleteCalendarEvent(deleteConfig, eventId);
    await sql`
      UPDATE entries SET google_calendar_event_id = NULL, google_calendar_target = NULL WHERE id = ${entryId}
    `;
  } catch (e) {
    log.error("Calendar cleanup failed", { entryId, error: (e as Error).message });
    // Don't clear event ID on failure — it becomes orphaned (per spec AC-6.2)
  }
}
