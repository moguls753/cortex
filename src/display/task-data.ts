import type postgres from "postgres";
// Side-effect import: registers the translation catalogs with i18next.
// A type-only import would be erased and leave t() resolving to nothing.
import "../web/i18n/index.js";
import i18next, { type TFunction } from "i18next";
import type { DisplayTask } from "./types.js";
import type { Locale } from "../web/i18n/index.js";

// ─── Date Formatting ───────────────────────────────────────────

// The display has no request context, so English is the fallback when no
// translator is supplied (unit tests, direct calls).
const defaultT = () => i18next.getFixedT("en") as TFunction;

export function formatDueDate(
  dueDate: string | null,
  now: Date,
  t: TFunction = defaultT(),
  locale: Locale = "en",
): string | null {
  if (dueDate === null) return null;

  // Parse the YYYY-MM-DD date as local midnight
  const [y, m, d] = dueDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((due.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays < 0) return t("display.due.overdue");
  if (diffDays === 0) return t("display.due.today");
  if (diffDays === 1) return t("display.due.tomorrow");

  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(due);
  return t("display.due.on_date", { date });
}

// ─── Query Tasks ───────────────────────────────────────────────

/**
 * How many recently-completed tasks the panel will show.
 * A tick is worth showing — it is the confirmation that the capture landed —
 * but it is a footnote, not the headline: on a six-row panel four completions
 * outranked two things the user still had to do. Two reads as "that worked"
 * without crowding.
 *
 * The cap holds even when nothing is open. Lifting it there made the *best*
 * state of the column its busiest: four struck-through rows and four ticked
 * boxes, with the affirmative "All clear" line suppressed because the list was
 * not technically empty. The layout leads that case with "All clear" and keeps
 * the completions as a short log underneath.
 */
export const MAX_COMPLETED_TASKS = 2;

export async function getDisplayTasks(
  sql: postgres.Sql,
  limit: number,
  t: TFunction = defaultT(),
  locale: Locale = "en",
): Promise<DisplayTask[]> {
  const rows = await sql`
    SELECT name, fields, updated_at
    FROM entries
    WHERE category = 'tasks'
      AND deleted_at IS NULL
      AND visibility = 'shared'
      AND (
        fields->>'status' = 'pending'
        OR (fields->>'status' = 'done' AND updated_at > now() - interval '24 hours')
      )
    ORDER BY
      -- Open work first; completions are a footnote.
      CASE WHEN fields->>'status' = 'pending' THEN 0 ELSE 1 END,
      -- Within the open block: dated before undated, soonest first.
      CASE WHEN fields->>'status' = 'pending' AND fields->>'due_date' IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN fields->>'status' = 'pending' THEN (fields->>'due_date')::date END ASC NULLS LAST,
      -- Within the completed block: freshest first, so both the LIMIT and the
      -- MAX_COMPLETED_TASKS cap keep the ticks just earned rather than an
      -- arbitrary pair chosen by creation order.
      CASE WHEN fields->>'status' = 'done' THEN updated_at END DESC NULLS LAST,
      created_at ASC
    LIMIT ${limit}
  `;

  const now = new Date();

  const tasks = rows.map((row) => {
    const fields = row.fields as { status?: string; due_date?: string | null };
    const done = fields.status === "done";
    return {
      name: row.name as string,
      // A completed task has no due state. "overdue" beside a strikethrough
      // contradicts itself, and "due tomorrow" on something already ticked is
      // noise. The date is still on the entry; the panel just stops labelling it.
      due: done ? null : formatDueDate(fields.due_date ?? null, now, t, locale),
      done,
    };
  });

  // The SQL already returns open work first, but partitioning explicitly keeps
  // this independent of the ORDER BY and mirrors what the layout draws.
  const open = tasks.filter((task) => !task.done);
  const completed = tasks.filter((task) => task.done);
  return [...open, ...completed.slice(0, MAX_COMPLETED_TASKS)];
}
