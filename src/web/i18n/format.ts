/**
 * Locale-aware date/time/relative-time helpers.
 *
 * Two-letter locale codes are mapped to full BCP-47 tags for Intl APIs.
 */

import type { Locale } from "./index.js";

const BCP47: Record<Locale, string> = {
  en: "en-US",
  de: "de-DE",
};

function tag(locale: Locale): string {
  return BCP47[locale] ?? "en-US";
}

export function formatDate(
  date: Date,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(tag(locale), opts).format(date);
}

export function formatTime(
  date: Date,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  return new Intl.DateTimeFormat(tag(locale), opts).format(date);
}

/**
 * Return a human-readable "just now / N minutes ago / N hours ago / N days
 * ago" label keyed off the catalog's `relative.*` entries. Callers pass
 * their own `t` because we don't have request context here.
 */
export function relativeTime(
  date: Date,
  locale: Locale,
  t: (key: string, opts?: Record<string, unknown>) => string,
  now: Date = new Date(),
): string {
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t("relative.just_now");
  if (minutes < 60) {
    return t("relative.minutes_ago", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("relative.hours_ago", { count: hours });
  }
  const days = Math.floor(hours / 24);
  return t("relative.days_ago", { count: days });
}

// Locale-tag helper exported for direct Intl usage in callers that
// need a non-standard set of options.
export function bcp47(locale: Locale): string {
  return tag(locale);
}
