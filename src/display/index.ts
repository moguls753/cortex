import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import type postgres from "postgres";
import { createLogger } from "../logger.js";
import { getAllSettings } from "../web/settings-queries.js";
import { renderDisplay } from "./render.js";
import { getWeather } from "./weather-data.js";
import { getDisplayTasks } from "./task-data.js";
import { getDisplayEvents } from "./calendar-data.js";
import type { DisplayData } from "./types.js";
import i18next, { type TFunction } from "i18next";
import { SUPPORTED_LOCALES, type Locale } from "../web/i18n/index.js";

type Sql = postgres.Sql;

const log = createLogger("display");

/**
 * "Sunday, August 9" / "Sonntag, 9. August" — the panel has no request context,
 * so the locale comes from the `ui_language` setting.
 */
export function formatDate(now: Date, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

export function formatTime(now: Date): string {
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function createDisplayRoutes(sql: Sql): Hono {
  const app = new Hono();

  app.get("/api/display.png", async (c) => {
    try {
      const settings = await getAllSettings(sql);

      if (settings.display_enabled !== "true") {
        return c.text("Not Found", 404);
      }

      const token = settings.display_token;
      if (token) {
        const provided = c.req.query("token") || "";
        const a = Buffer.from(provided);
        const b = Buffer.from(token);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return c.text("Forbidden", 403);
        }
      }

      const timezone = settings.timezone || "Europe/Berlin";
      // The display follows the interface language; the device cannot carry a
      // locale of its own.
      const uiLanguage = settings.ui_language;
      const locale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(
        uiLanguage,
      )
        ? (uiLanguage as Locale)
        : "en";
      const t = i18next.getFixedT(locale) as TFunction;
      // parseFloat returns NaN for unparseable strings; Number.isFinite filters
      // both NaN and infinities so getWeather is never called with bad coords.
      const parsedLat = settings.display_weather_lat
        ? parseFloat(settings.display_weather_lat)
        : undefined;
      const parsedLng = settings.display_weather_lng
        ? parseFloat(settings.display_weather_lng)
        : undefined;
      const lat = Number.isFinite(parsedLat) ? parsedLat : undefined;
      const lng = Number.isFinite(parsedLng) ? parsedLng : undefined;
      const maxTasks = parseInt(settings.display_max_tasks || "7", 10);
      const maxTodayEvents = parseInt(settings.display_max_today_events || "8", 10);
      // Non-positive or NaN width/height fall back to the defaults per spec E-12.
      const parsedWidth = parseInt(settings.display_width || "1872", 10);
      const parsedHeight = parseInt(settings.display_height || "1404", 10);
      const width = Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : 1872;
      const height = Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : 1404;
      // Font scale is validated in the settings form, but the DB is also
      // hand-editable — anything unparseable or outside the accepted 0.5..2.0
      // band falls back to the reference scale rather than rendering garbage.
      const parsedFontScale = parseFloat(settings.display_font_scale || "1");
      const fontScale =
        Number.isFinite(parsedFontScale) &&
        parsedFontScale >= 0.5 &&
        parsedFontScale <= 2
          ? parsedFontScale
          : 1;

      let selectedCalendars: string[] | undefined;
      if (settings.display_calendars) {
        try {
          selectedCalendars = JSON.parse(settings.display_calendars);
        } catch {
          // ignore invalid JSON
        }
      }

      // Fetch data in parallel
      const [weather, calendarData, tasks] = await Promise.all([
        lat !== undefined && lng !== undefined
          ? getWeather(lat, lng, timezone)
          : Promise.resolve(null),
        getDisplayEvents(sql, timezone, selectedCalendars, t, locale),
        getDisplayTasks(sql, maxTasks, t, locale),
      ]);

      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: timezone }),
      );

      const data: DisplayData = {
        date: formatDate(now, locale),
        time: formatTime(now),
        weather,
        todayEvents: calendarData.today,
        upcomingDays: calendarData.upcoming,
        tasks,
        maxTodayEvents,
      };

      const png = await renderDisplay(data, width, height, fontScale, t);

      return new Response(new Uint8Array(png), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
        },
      });
    } catch (err) {
      log.error("Failed to render display", {
        error: err instanceof Error ? err.message : String(err),
      });
      return c.text("Internal Server Error", 500);
    }
  });

  app.get("/api/display", async (c) => {
    try {
      const settings = await getAllSettings(sql);

      if (settings.display_enabled !== "true") {
        return c.text("Not Found", 404);
      }

      // `/api/display` returns the PNG URL with the token embedded as a query
      // param (that's how e-ink clients authenticate against /api/display.png).
      // Since this endpoint is excluded from session auth, a caller that hits
      // it without the token would otherwise exfiltrate the secret. Require
      // the same timing-safe token check that /api/display.png uses.
      const token = settings.display_token;
      if (token) {
        const provided = c.req.query("token") || "";
        const a = Buffer.from(provided);
        const b = Buffer.from(token);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return c.text("Forbidden", 403);
        }
      }

      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";

      let imageUrl: string;
      if (settings.display_base_url) {
        const base = settings.display_base_url.replace(/\/+$/, "");
        imageUrl = `${base}/api/display.png${tokenParam}`;
      } else {
        const host = c.req.header("host") || "localhost";
        const protocol = c.req.header("x-forwarded-proto") || "http";
        imageUrl = `${protocol}://${host}/api/display.png${tokenParam}`;
      }

      return c.json({
        image_url: imageUrl,
        filename: "cortex-display",
      });
    } catch (err) {
      log.error("Failed to serve display endpoint", {
        error: err instanceof Error ? err.message : String(err),
      });
      return c.text("Internal Server Error", 500);
    }
  });

  return app;
}
