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
}

export async function resolveCalendarConfig(sql?: postgres.Sql): Promise<CalendarConfig> {
  const settings: Record<string, string> = sql ? await getAllSettings(sql) : {};

  const calendarId = settings.google_calendar_id || process.env.GOOGLE_CALENDAR_ID || "";
  const accessToken = settings.google_access_token || "";
  const refreshToken = settings.google_refresh_token || process.env.GOOGLE_REFRESH_TOKEN || "";
  const clientId = settings.google_client_id || process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = settings.google_client_secret || process.env.GOOGLE_CLIENT_SECRET || "";

  let defaultDuration = 60;
  const durationStr = settings.google_calendar_default_duration;
  if (durationStr) {
    const parsed = parseInt(durationStr, 10);
    if (!isNaN(parsed) && parsed >= 15 && parsed <= 480) {
      defaultDuration = parsed;
    }
  }

  return { calendarId, accessToken, refreshToken, clientId, clientSecret, defaultDuration };
}

export async function isCalendarConfigured(sql?: postgres.Sql): Promise<boolean> {
  const config = await resolveCalendarConfig(sql);
  return !!(config.refreshToken || config.accessToken) && !!config.calendarId;
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
  },
): Promise<CalendarResult> {
  try {
    // --- No calendar requested ---
    if (!classificationResult.create_calendar_event) {
      // Check if entry has an existing event to delete (reclassification case)
      const rows = await sql`
        SELECT google_calendar_event_id FROM entries WHERE id = ${entryId}
      `;
      const existingEventId = rows[0]?.google_calendar_event_id as string | null;

      if (existingEventId) {
        // Delete the event from Google Calendar
        try {
          const config = await resolveCalendarConfig(sql);
          await deleteCalendarEvent(config, existingEventId);
        } catch (e) {
          log.error("Failed to delete calendar event", { entryId, error: (e as Error).message });
        }
        await sql`
          UPDATE entries SET google_calendar_event_id = NULL WHERE id = ${entryId}
        `;
      }

      return { created: false };
    }

    // --- Calendar requested but no date ---
    if (!classificationResult.calendar_date) {
      return { created: false };
    }

    // --- Check if configured ---
    if (!(await isCalendarConfigured(sql))) {
      return { created: false };
    }

    const config = await resolveCalendarConfig(sql);

    // Get entry data
    const entryRows = await sql`
      SELECT id, name, content, google_calendar_event_id FROM entries WHERE id = ${entryId}
    `;
    const entry = entryRows[0] as { id: string; name: string; content: string; google_calendar_event_id: string | null } | undefined;
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

    // --- Create or update ---
    const doCalendarOp = async (cfg: CalendarConfig) => {
      if (existingEventId) {
        // Update existing
        const result = await updateCalendarEvent(cfg, existingEventId, eventParams);
        return result.id;
      } else {
        // Create new
        const result = await createCalendarEvent(cfg, eventParams);
        return result.id;
      }
    };

    try {
      const eventId = await doCalendarOp(config);
      if (!existingEventId) {
        await sql`
          UPDATE entries SET google_calendar_event_id = ${eventId} WHERE id = ${entryId}
        `;
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
          const updatedConfig = { ...config, accessToken: tokens.accessToken };
          const eventId = await doCalendarOp(updatedConfig);
          if (!existingEventId) {
            await sql`
              UPDATE entries SET google_calendar_event_id = ${eventId} WHERE id = ${entryId}
            `;
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
        const eventId = await doCalendarOp(config);
        if (!existingEventId) {
          await sql`
            UPDATE entries SET google_calendar_event_id = ${eventId} WHERE id = ${entryId}
          `;
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
      SELECT google_calendar_event_id FROM entries WHERE id = ${entryId}
    `;
    const eventId = rows[0]?.google_calendar_event_id as string | null;
    if (!eventId) return;

    const config = await resolveCalendarConfig(sql);
    if (!config.calendarId || (!config.refreshToken && !config.accessToken)) return;

    await deleteCalendarEvent(config, eventId);
    await sql`
      UPDATE entries SET google_calendar_event_id = NULL WHERE id = ${entryId}
    `;
  } catch (e) {
    log.error("Calendar cleanup failed", { entryId, error: (e as Error).message });
    // Don't clear event ID on failure — it becomes orphaned (per spec AC-6.2)
  }
}
