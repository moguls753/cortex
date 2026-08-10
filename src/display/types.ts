/**
 * Sentinel for all-day events. Kept language-neutral because it doubles as a
 * sort key; the layout translates it at render time.
 */
export const ALL_DAY = "all day";

export interface DisplayEvent {
  time: string; // "08:30"
  name: string; // "Dentist — Mila"
  calendar: string; // "FAMILY"
  /**
   * Localized day span for an event covering more than one visible day —
   * "THU–SAT", "bis SA". Present only on multi-day events, where it replaces
   * the time in the gutter: the span *is* the when. Pre-localized like
   * DisplayDay.label and DisplayTask.due, because the layout has no calendar
   * dates to format.
   */
  span?: string;
}

export interface DisplayTask {
  name: string; // "Renew passport"
  /**
   * "due Apr 3", "overdue", or null. Always null when `done` — a completed
   * task has no due state; see getDisplayTasks.
   */
  due: string | null;
  done: boolean;
}

export interface WeatherData {
  // Temperatures are kept at the source's precision (one decimal) — the panel
  // formats them, so nothing is lost to premature rounding.
  current: number; // 29.9 (°C)
  condition: string; // "Partly Cloudy"
  weatherCode: number; // WMO code for icon selection
  high: number; // today's maximum
  low: number; // today's minimum
  tomorrowHigh: number;
  tomorrowLow: number;
  hourly: Array<{ time: string; temp: number }>; // next 4 hours, rolling past midnight
}

/** One upcoming day's events, grouped for the week-ahead list. */
export interface DisplayDay {
  label: string; // "Tomorrow", "Wednesday"
  events: DisplayEvent[];
}

export interface DisplayData {
  date: string; // "Monday, March 31"
  time: string; // "07:30"
  weather: WeatherData | null;
  todayEvents: DisplayEvent[];
  upcomingDays: DisplayDay[]; // the next 6 days that have events
  tasks: DisplayTask[];
  maxTodayEvents: number; // 8
}
