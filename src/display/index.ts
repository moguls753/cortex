import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import type postgres from "postgres";
import { createLogger } from "../logger.js";
import { getAllSettings } from "../web/settings-queries.js";
import { renderKitchenDisplay } from "./render.js";
import { getWeather } from "./weather-data.js";
import { getDisplayTasks } from "./task-data.js";
import { getDisplayEvents } from "./calendar-data.js";
import type { KitchenData } from "./types.js";

type Sql = postgres.Sql;

const log = createLogger("display");

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatDate(now: Date): string {
  return `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

export function formatTime(now: Date): string {
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function createDisplayRoutes(sql: Sql): Hono {
  const app = new Hono();

  app.get("/api/kitchen.png", async (c) => {
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
        getDisplayEvents(sql, timezone, selectedCalendars),
        getDisplayTasks(sql, maxTasks),
      ]);

      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: timezone }),
      );

      const data: KitchenData = {
        date: formatDate(now),
        time: formatTime(now),
        weather,
        todayEvents: calendarData.today,
        tomorrowEvents: calendarData.tomorrow,
        tasks,
        maxTodayEvents,
      };

      const png = await renderKitchenDisplay(data, width, height);

      return new Response(new Uint8Array(png), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
        },
      });
    } catch (err) {
      log.error("Failed to render kitchen display", {
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

      const token = settings.display_token;
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";

      let imageUrl: string;
      if (settings.display_base_url) {
        const base = settings.display_base_url.replace(/\/+$/, "");
        imageUrl = `${base}/api/kitchen.png${tokenParam}`;
      } else {
        const host = c.req.header("host") || "localhost";
        const protocol = c.req.header("x-forwarded-proto") || "http";
        imageUrl = `${protocol}://${host}/api/kitchen.png${tokenParam}`;
      }

      return c.json({
        image_url: imageUrl,
        filename: "cortex-kitchen",
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
