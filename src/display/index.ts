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
      const lat = settings.display_weather_lat
        ? parseFloat(settings.display_weather_lat)
        : undefined;
      const lng = settings.display_weather_lng
        ? parseFloat(settings.display_weather_lng)
        : undefined;
      const maxTasks = parseInt(settings.display_max_tasks || "7", 10);
      const width = parseInt(settings.display_width || "1872", 10);
      const height = parseInt(settings.display_height || "1404", 10);

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
        maxTodayEvents: 8,
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

      const host = c.req.header("host") || "localhost";
      const protocol = c.req.header("x-forwarded-proto") || "http";
      const token = settings.display_token;
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
      const imageUrl = `${protocol}://${host}/api/kitchen.png${tokenParam}`;

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
