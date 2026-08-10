import type {
  DisplayData,
  DisplayEvent,
  DisplayTask,
  WeatherData,
} from "../../src/display/types.js";

export function makeEvent(overrides: Partial<DisplayEvent> = {}): DisplayEvent {
  return {
    time: "09:00",
    name: "Meeting",
    calendar: "WORK",
    ...overrides,
  };
}

export function makeTask(overrides: Partial<DisplayTask> = {}): DisplayTask {
  return {
    name: "Test task",
    due: null,
    done: false,
    ...overrides,
  };
}

export function makeWeather(overrides: Partial<WeatherData> = {}): WeatherData {
  return {
    current: 14,
    condition: "Partly Cloudy",
    weatherCode: 2,
    high: 18,
    low: 9,
    tomorrowHigh: 21,
    tomorrowLow: 11,
    hourly: [
      { time: "08:00", temp: 13 },
      { time: "09:00", temp: 14 },
      { time: "10:00", temp: 15 },
      { time: "11:00", temp: 16 },
    ],
    ...overrides,
  };
}

export function makeDisplayData(
  overrides: Partial<DisplayData> = {},
): DisplayData {
  return {
    date: "Monday, March 31",
    time: "07:30",
    weather: makeWeather(),
    todayEvents: [makeEvent()],
    upcomingDays: [],
    tasks: [makeTask()],
    maxTodayEvents: 8,
    ...overrides,
  };
}

/**
 * Open-Meteo fake response. Two days of hourly entries, matching the
 * `forecast_days=2` request, so the 4-slot strip has data even late in the
 * evening — the case that used to run dry.
 */
export function makeOpenMeteoResponse(
  weatherCode: number,
  temp = 14.3,
): object {
  const hour = (day: string, i: number) =>
    `${day}T${String(i).padStart(2, "0")}:00`;
  return {
    current: { temperature_2m: temp, weather_code: weatherCode },
    hourly: {
      time: [
        ...Array.from({ length: 24 }, (_, i) => hour("2026-03-31", i)),
        ...Array.from({ length: 24 }, (_, i) => hour("2026-04-01", i)),
      ],
      temperature_2m: Array.from({ length: 48 }, (_, i) => 8 + (i % 24) * 0.5),
    },
    daily: {
      temperature_2m_max: [18.7, 21.4],
      temperature_2m_min: [5.2, 7.8],
    },
  };
}
