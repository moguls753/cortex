/**
 * i18next bootstrap.
 *
 * SUPPORTED_LOCALES is the single source of truth for the resolver, the
 * settings dropdown, and the i18next init call. `initI18n()` is idempotent
 * — safe to call at app startup and again in test setup.
 */

import i18next, { type i18n, type TFunction } from "i18next";
import type { Context } from "hono";
import { en } from "./en.js";
import { de } from "./de.js";

export const SUPPORTED_LOCALES = ["en", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// Augment Hono's context variables so `c.get("locale")` and `c.get("t")`
// are type-checked across the codebase without per-call casts.
declare module "hono" {
  interface ContextVariableMap {
    locale: Locale;
    t: TFunction;
  }
}

// Module-level init — resolves on first import so templates can call
// i18next.getFixedT() safely even before explicit initI18n() completes.
const initPromise: Promise<unknown> = i18next.init({
  lng: "en",
  fallbackLng: "en",
  supportedLngs: SUPPORTED_LOCALES as unknown as string[],
  defaultNS: "translation",
  resources: {
    en: { translation: en as unknown as Record<string, unknown> },
    de: { translation: de as unknown as Record<string, unknown> },
  },
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
});

export async function initI18n(): Promise<i18n> {
  await initPromise;
  return i18next;
}

/**
 * Resolve the i18next `t` function for the request. Prefers the middleware-
 * attached `t` (set via `c.set("t", …)`); falls back to English if the
 * middleware hasn't run (e.g. in unit tests that build a minimal app).
 */
export function getT(c: Context): TFunction {
  const t = c.get("t") as TFunction | undefined;
  return t ?? (i18next.getFixedT("en") as TFunction);
}

export { i18next };
