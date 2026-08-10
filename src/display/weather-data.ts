import type { WeatherData } from "./types.js";

// ─── Weather Code Mapping ───────────────────────────────────────

// WMO weather code → display condition label + icon.
// Source: docs/specs/kitchen-display-specification.md AC-7.6 (historical spec name — the feature is now called "display").
const weatherCodeMap: Record<number, { condition: string; icon: string }> = {
  0: { condition: "Clear", icon: "sun" },
  1: { condition: "Mainly Clear", icon: "cloud" },
  2: { condition: "Partly Cloudy", icon: "cloud" },
  3: { condition: "Overcast", icon: "cloud" },
  45: { condition: "Fog", icon: "cloud" },
  48: { condition: "Fog", icon: "cloud" },
  51: { condition: "Drizzle", icon: "cloud-rain" },
  53: { condition: "Drizzle", icon: "cloud-rain" },
  55: { condition: "Drizzle", icon: "cloud-rain" },
  56: { condition: "Freezing Drizzle", icon: "cloud-rain" },
  57: { condition: "Freezing Drizzle", icon: "cloud-rain" },
  61: { condition: "Rain", icon: "cloud-rain" },
  63: { condition: "Rain", icon: "cloud-rain" },
  65: { condition: "Rain", icon: "cloud-rain" },
  66: { condition: "Freezing Rain", icon: "cloud-rain" },
  67: { condition: "Freezing Rain", icon: "cloud-rain" },
  71: { condition: "Snow", icon: "cloud-snow" },
  73: { condition: "Snow", icon: "cloud-snow" },
  75: { condition: "Snow", icon: "cloud-snow" },
  77: { condition: "Snow Grains", icon: "cloud-snow" },
  80: { condition: "Rain Showers", icon: "cloud-rain" },
  81: { condition: "Rain Showers", icon: "cloud-rain" },
  82: { condition: "Rain Showers", icon: "cloud-rain" },
  85: { condition: "Snow Showers", icon: "cloud-snow" },
  86: { condition: "Snow Showers", icon: "cloud-snow" },
  95: { condition: "Thunderstorm", icon: "cloud-lightning" },
  96: { condition: "Thunderstorm with Hail", icon: "cloud-lightning" },
  99: { condition: "Thunderstorm with Hail", icon: "cloud-lightning" },
};

const defaultWeather = { condition: "Cloudy", icon: "cloud" };

export function mapWeatherCode(code: number): { condition: string; icon: string } {
  return weatherCodeMap[code] ?? defaultWeather;
}

/**
 * Translation key for a WMO code, e.g. 96 → "thunderstorm_with_hail".
 * Derived from the English label so the code table above stays the single
 * place a new WMO code has to be registered; the catalogs mirror these slugs
 * under `display.weather.*`.
 */
export function weatherConditionKey(code: number): string {
  return mapWeatherCode(code).condition.toLowerCase().replace(/\s+/g, "_");
}

// ─── Cache ──────────────────────────────────────────────────────

// Open-Meteo publishes on a 15-minute grid and the panel refreshes about that
// often, so a longer TTL just guarantees a stale reading on alternate renders.
const CACHE_TTL_MS = 15 * 60 * 1000;

let cachedData: WeatherData | null = null;
let cachedAt = 0;

export function clearWeatherCache(): void {
  cachedData = null;
  cachedAt = 0;
}

// ─── Fetch Weather ──────────────────────────────────────────────

/** How many entries the forecast strip shows. */
const HOURLY_SLOTS = 5;

/**
 * Hours between entries. Two rather than one: the panel refreshes every
 * quarter hour anyway, so the next four hours told you little the current
 * reading did not. Five two-hour steps reach ten hours ahead — far enough to
 * cover an afternoon or a night — in the same strip.
 */
const HOURLY_STEP_HOURS = 2;

/**
 * "YYYY-MM-DDTHH:00" for the given instant in the given timezone — the same
 * shape Open-Meteo uses for hourly timestamps, so the two can be compared
 * lexicographically.
 */
export function localHourStamp(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  // Intl renders midnight as "24" in some locales/engines; normalise it.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:00`;
}

export async function getWeather(
  lat: number,
  lng: number,
  timezone: string,
): Promise<WeatherData | null> {
  const now = Date.now();

  // Return cached data if fresh
  if (cachedData && now - cachedAt < CACHE_TTL_MS) {
    return cachedData;
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m",
    daily: "temperature_2m_max,temperature_2m_min",
    timezone,
    // Two days, so the hourly strip still has hours to show late in the evening
    // and tomorrow's high/low are available.
    forecast_days: "2",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) {
      return cachedData ?? null;
    }

    const json = (await res.json()) as {
      current: { temperature_2m: number; weather_code: number };
      hourly: { time: string[]; temperature_2m: number[] };
      daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };

    const weatherCode = json.current.weather_code;
    const { condition } = mapWeatherCode(weatherCode);

    // Open-Meteo returns hourly timestamps as local wall-clock ISO strings for
    // the requested timezone. Selecting by timestamp rather than by array index
    // means the strip keeps working across midnight — indexing by hour-of-day
    // ran out of entries during the evening and showed nothing after 23:00.
    const nowLocal = localHourStamp(new Date(), timezone);
    const startIndex = json.hourly.time.findIndex((t) => t > nowLocal);
    const hourly: Array<{ time: string; temp: number }> = [];
    if (startIndex !== -1) {
      for (
        let i = startIndex;
        i < startIndex + HOURLY_SLOTS * HOURLY_STEP_HOURS &&
        i < json.hourly.time.length;
        i += HOURLY_STEP_HOURS
      ) {
        hourly.push({
          time: json.hourly.time[i].slice(11, 16), // "HH:MM"
          temp: json.hourly.temperature_2m[i],
        });
      }
    }

    const [todayMax, tomorrowMax] = json.daily.temperature_2m_max;
    const [todayMin, tomorrowMin] = json.daily.temperature_2m_min;

    const result: WeatherData = {
      current: json.current.temperature_2m,
      condition,
      weatherCode,
      high: todayMax,
      low: todayMin,
      // A one-day response leaves these undefined; fall back to today so the
      // strip renders something sane rather than "undefined°".
      tomorrowHigh: tomorrowMax ?? todayMax,
      tomorrowLow: tomorrowMin ?? todayMin,
      hourly,
    };

    cachedData = result;
    cachedAt = Date.now();

    return result;
  } catch {
    return cachedData ?? null;
  }
}
