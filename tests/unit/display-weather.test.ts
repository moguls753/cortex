import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapWeatherCode, getWeather, clearWeatherCache } from "../../src/display/weather-data.js";

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
});
