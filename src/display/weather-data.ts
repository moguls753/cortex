import type { WeatherData } from "./types.js";

// ─── Weather Code Mapping ───────────────────────────────────────

const weatherCodeMap: Record<number, { condition: string; icon: string }> = {
  0: { condition: "Clear", icon: "sun" },
  1: { condition: "Partly Cloudy", icon: "cloud" },
  2: { condition: "Partly Cloudy", icon: "cloud" },
  3: { condition: "Partly Cloudy", icon: "cloud" },
  45: { condition: "Fog", icon: "cloud" },
  48: { condition: "Fog", icon: "cloud" },
  51: { condition: "Drizzle", icon: "cloud-rain" },
  53: { condition: "Drizzle", icon: "cloud-rain" },
  55: { condition: "Drizzle", icon: "cloud-rain" },
  56: { condition: "Drizzle", icon: "cloud-rain" },
  57: { condition: "Drizzle", icon: "cloud-rain" },
  61: { condition: "Rain", icon: "cloud-rain" },
  63: { condition: "Rain", icon: "cloud-rain" },
  65: { condition: "Rain", icon: "cloud-rain" },
  66: { condition: "Rain", icon: "cloud-rain" },
  67: { condition: "Rain", icon: "cloud-rain" },
  71: { condition: "Snow", icon: "cloud-snow" },
  73: { condition: "Snow", icon: "cloud-snow" },
  75: { condition: "Snow", icon: "cloud-snow" },
  77: { condition: "Snow", icon: "cloud-snow" },
  80: { condition: "Rain Showers", icon: "cloud-rain" },
  81: { condition: "Rain Showers", icon: "cloud-rain" },
  82: { condition: "Rain Showers", icon: "cloud-rain" },
  95: { condition: "Thunderstorm", icon: "cloud-lightning" },
  96: { condition: "Thunderstorm", icon: "cloud-lightning" },
  99: { condition: "Thunderstorm", icon: "cloud-lightning" },
};

const defaultWeather = { condition: "Cloudy", icon: "cloud" };

export function mapWeatherCode(code: number): { condition: string; icon: string } {
  return weatherCodeMap[code] ?? defaultWeather;
}

// ─── Cache ──────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let cachedData: WeatherData | null = null;
let cachedAt = 0;

export function clearWeatherCache(): void {
  cachedData = null;
  cachedAt = 0;
}

// ─── Fetch Weather ──────────────────────────────────────────────

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
    forecast_days: "1",
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

    // Get current hour in the configured timezone
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(new Date());
    const currentHourIndex = parseInt(hourStr, 10);
    const hourly: Array<{ time: string; temp: number }> = [];
    for (let i = currentHourIndex + 1; i < currentHourIndex + 5 && i < json.hourly.time.length; i++) {
      hourly.push({
        time: json.hourly.time[i].slice(11, 16), // "HH:MM"
        temp: Math.round(json.hourly.temperature_2m[i]),
      });
    }

    const result: WeatherData = {
      current: Math.round(json.current.temperature_2m),
      condition,
      weatherCode,
      high: Math.round(json.daily.temperature_2m_max[0]),
      low: Math.round(json.daily.temperature_2m_min[0]),
      hourly,
    };

    cachedData = result;
    cachedAt = Date.now();

    return result;
  } catch {
    return cachedData ?? null;
  }
}
