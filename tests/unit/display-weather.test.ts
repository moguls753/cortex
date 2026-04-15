import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapWeatherCode, getWeather, clearWeatherCache } from "../../src/display/weather-data.js";
import { makeOpenMeteoResponse } from "../helpers/display-fixtures.js";

// ─── Mock fetch ─────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ─── Helpers ────────────────────────────────────────────────────

function createApiResponse(overrides: Record<string, unknown> = {}) {
  return {
    current: { temperature_2m: 14.3, weather_code: 2 },
    hourly: {
      time: Array.from({ length: 24 }, (_, i) => `2026-03-31T${String(i).padStart(2, "0")}:00`),
      temperature_2m: Array.from({ length: 24 }, (_, i) => 8 + i * 0.5),
    },
    daily: {
      temperature_2m_max: [18.7],
      temperature_2m_min: [5.2],
    },
    ...overrides,
  };
}

function mockFetchOk(data: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe("mapWeatherCode", () => {
  it("maps code 0 to Clear / sun", () => {
    expect(mapWeatherCode(0)).toEqual({ condition: "Clear", icon: "sun" });
  });

  it("maps code 2 to Partly Cloudy / cloud", () => {
    expect(mapWeatherCode(2)).toEqual({ condition: "Partly Cloudy", icon: "cloud" });
  });

  it("maps code 61 to Rain / cloud-rain", () => {
    expect(mapWeatherCode(61)).toEqual({ condition: "Rain", icon: "cloud-rain" });
  });

  it("maps code 71 to Snow / cloud-snow", () => {
    expect(mapWeatherCode(71)).toEqual({ condition: "Snow", icon: "cloud-snow" });
  });

  it("maps code 95 to Thunderstorm / cloud-lightning", () => {
    expect(mapWeatherCode(95)).toEqual({ condition: "Thunderstorm", icon: "cloud-lightning" });
  });

  it("maps unknown code 999 to Cloudy / cloud", () => {
    expect(mapWeatherCode(999)).toEqual({ condition: "Cloudy", icon: "cloud" });
  });
});

describe("getWeather", () => {
  beforeEach(() => {
    clearWeatherCache();
    fetchMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T10:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns formatted data from API response", async () => {
    const apiData = createApiResponse();
    mockFetchOk(apiData);

    const result = await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(result).not.toBeNull();
    expect(result!.current).toBe(14); // 14.3 rounded
    expect(result!.condition).toBe("Partly Cloudy"); // code 2
    expect(result!.weatherCode).toBe(2);
    expect(result!.high).toBe(19); // 18.7 rounded
    expect(result!.low).toBe(5); // 5.2 rounded
    expect(result!.hourly).toHaveLength(4);
    // Each hourly entry has time and rounded temp
    for (const h of result!.hourly) {
      expect(h).toHaveProperty("time");
      expect(h).toHaveProperty("temp");
      expect(Number.isInteger(h.temp)).toBe(true);
    }

    // Verify fetch was called with correct URL params
    expect(fetchMock).toHaveBeenCalledOnce();
    const callUrl = fetchMock.mock.calls[0][0] as string;
    expect(callUrl).toContain("latitude=52.52");
    expect(callUrl).toContain("longitude=13.41");
    expect(callUrl).toContain("timezone=Europe%2FBerlin");
    expect(callUrl).toContain("forecast_days=1");
  });

  it("returns cached data on second call (fetch called once)", async () => {
    const apiData = createApiResponse();
    mockFetchOk(apiData);

    const first = await getWeather(52.52, 13.41, "Europe/Berlin");
    const second = await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null when fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const result = await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(result).toBeNull();
  });

  it("returns null when API returns non-ok status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const result = await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(result).toBeNull();
  });

  it("TS-7.1 — issues a single fetch to open-meteo with the expected query string", async () => {
    mockFetchOk(createApiResponse());

    await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(fetchMock).toHaveBeenCalledOnce();
    const callUrl = fetchMock.mock.calls[0][0] as string;
    expect(callUrl.startsWith("https://api.open-meteo.com/v1/forecast")).toBe(true);
    expect(callUrl).toContain("latitude=52.52");
    expect(callUrl).toContain("longitude=13.41");
    expect(callUrl).toContain("forecast_days=1");
  });

  it("TS-7.3 — network error returns null without throwing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const result = await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(result).toBeNull();
  });

  it("TS-7.4 — non-2xx response returns null", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(result).toBeNull();
  });
});

// ─── TS-7.2 / TS-7.2b: cache TTL tests (fake timers scoped) ─────

describe("getWeather cache TTL", () => {
  beforeEach(() => {
    clearWeatherCache();
    fetchMock.mockReset();
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date("2026-03-31T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TS-7.2 — second call within 30 minutes is served from cache", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeOpenMeteoResponse(2),
    });

    await getWeather(52.52, 13.41, "Europe/Berlin");
    vi.setSystemTime(new Date("2026-03-31T10:10:00Z"));
    await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("TS-7.2b — second call past 30-minute TTL re-fetches", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => makeOpenMeteoResponse(2),
    });

    await getWeather(52.52, 13.41, "Europe/Berlin");
    vi.setSystemTime(new Date("2026-03-31T10:31:00Z"));
    await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("TS-E-5 — empty cache + fetch timeout returns null, no stale fallback", async () => {
    // AbortError simulates a timeout abort
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    fetchMock.mockRejectedValueOnce(abortErr);

    const result = await getWeather(52.52, 13.41, "Europe/Berlin");
    expect(result).toBeNull();
  });
});

// ─── TS-7.9: WMO decision table ─────────────────────────────────

describe("mapWeatherCode — TS-7.9 WMO decision table", () => {
  const rows: Array<[number, string, string]> = [
    [0, "Clear", "sun"],
    [1, "Mainly Clear", "cloud"],
    [2, "Partly Cloudy", "cloud"],
    [3, "Overcast", "cloud"],
    [45, "Fog", "cloud"],
    [48, "Fog", "cloud"],
    [51, "Drizzle", "cloud-rain"],
    [53, "Drizzle", "cloud-rain"],
    [55, "Drizzle", "cloud-rain"],
    [56, "Freezing Drizzle", "cloud-rain"],
    [57, "Freezing Drizzle", "cloud-rain"],
    [61, "Rain", "cloud-rain"],
    [63, "Rain", "cloud-rain"],
    [65, "Rain", "cloud-rain"],
    [66, "Freezing Rain", "cloud-rain"],
    [67, "Freezing Rain", "cloud-rain"],
    [71, "Snow", "cloud-snow"],
    [73, "Snow", "cloud-snow"],
    [75, "Snow", "cloud-snow"],
    [77, "Snow Grains", "cloud-snow"],
    [80, "Rain Showers", "cloud-rain"],
    [81, "Rain Showers", "cloud-rain"],
    [82, "Rain Showers", "cloud-rain"],
    [85, "Snow Showers", "cloud-snow"],
    [86, "Snow Showers", "cloud-snow"],
    [95, "Thunderstorm", "cloud-lightning"],
    [96, "Thunderstorm with Hail", "cloud-lightning"],
    [99, "Thunderstorm with Hail", "cloud-lightning"],
  ];

  it.each(rows)(
    "TS-7.9 — WMO code %s maps to %s / %s",
    (code, condition, icon) => {
      expect(mapWeatherCode(code)).toEqual({ condition, icon });
    },
  );

  it("TS-7.10 — unknown code 999 falls back to Cloudy / cloud without throwing", () => {
    expect(() => mapWeatherCode(999)).not.toThrow();
    expect(mapWeatherCode(999)).toEqual({ condition: "Cloudy", icon: "cloud" });
  });
});
