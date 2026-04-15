import type {
  KitchenData,
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
    hourly: [
      { time: "08:00", temp: 13 },
      { time: "09:00", temp: 14 },
      { time: "10:00", temp: 15 },
      { time: "11:00", temp: 16 },
    ],
    ...overrides,
  };
}

export function makeKitchenData(
  overrides: Partial<KitchenData> = {},
): KitchenData {
  return {
    date: "Monday, March 31",
    time: "07:30",
    weather: makeWeather(),
    todayEvents: [makeEvent()],
    tomorrowEvents: [],
    tasks: [makeTask()],
    maxTodayEvents: 8,
    ...overrides,
  };
}

/**
 * Open-Meteo fake response. 24 hourly entries so the slice starting at the
 * current hour always has enough data for the 4-slot strip regardless of
 * fake-clock hour.
 */
export function makeOpenMeteoResponse(
  weatherCode: number,
  temp = 14.3,
): object {
  return {
    current: { temperature_2m: temp, weather_code: weatherCode },
    hourly: {
      time: Array.from(
        { length: 24 },
        (_, i) => `2026-03-31T${String(i).padStart(2, "0")}:00`,
      ),
      temperature_2m: Array.from({ length: 24 }, (_, i) => 8 + i * 0.5),
    },
    daily: {
      temperature_2m_max: [18.7],
      temperature_2m_min: [5.2],
    },
  };
}
