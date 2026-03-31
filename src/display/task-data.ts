import type postgres from "postgres";
import type { DisplayTask } from "./types.js";

// ─── Date Formatting ───────────────────────────────────────────

const MONTH_ABBREV = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDueDate(dueDate: string | null, now: Date): string | null {
  if (dueDate === null) return null;

  // Parse the YYYY-MM-DD date as local midnight
  const [y, m, d] = dueDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((due.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "due today";
  if (diffDays === 1) return "due tomorrow";

  return `due ${MONTH_ABBREV[due.getMonth()]} ${due.getDate()}`;
}

// ─── Query Tasks ───────────────────────────────────────────────

export async function getDisplayTasks(
  sql: postgres.Sql,
  limit: number,
): Promise<DisplayTask[]> {
  const rows = await sql`
    SELECT name, fields, updated_at
    FROM entries
    WHERE category = 'tasks'
      AND deleted_at IS NULL
      AND (
        fields->>'status' = 'pending'
        OR (fields->>'status' = 'done' AND updated_at > now() - interval '24 hours')
      )
    ORDER BY
      CASE WHEN fields->>'status' = 'pending' THEN 0 ELSE 1 END,
      CASE WHEN fields->>'status' = 'pending' AND fields->>'due_date' IS NOT NULL THEN 0 ELSE 1 END,
      (fields->>'due_date')::date ASC NULLS LAST,
      created_at ASC
    LIMIT ${limit}
  `;

  const now = new Date();

  return rows.map((row) => {
    const fields = row.fields as { status?: string; due_date?: string | null };
    return {
      name: row.name as string,
      due: formatDueDate(fields.due_date ?? null, now),
      done: fields.status === "done",
    };
  });
}
