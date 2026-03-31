export interface DisplayEvent {
  time: string; // "08:30"
  name: string; // "Dentist — Mila"
  calendar: string; // "FAMILY"
}

export interface DisplayTask {
  name: string; // "Renew passport"
  due: string | null; // "due Apr 3", "overdue", or null
  done: boolean;
}

export interface WeatherData {
  current: number; // 14  (rounded integer °C)
  condition: string; // "Partly Cloudy"
  weatherCode: number; // WMO code for icon selection
  high: number;
  low: number;
  hourly: Array<{ time: string; temp: number }>; // next 4 hours
}

export interface KitchenData {
  date: string; // "Monday, March 31"
  time: string; // "07:30"
  weather: WeatherData | null;
  todayEvents: DisplayEvent[];
  tomorrowEvents: DisplayEvent[];
  tasks: DisplayTask[];
  maxTodayEvents: number; // 8
}
