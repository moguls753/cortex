import type { Sql } from "postgres";

export interface DailyDigestData {
  activeProjects: Array<{ id: string; name: string; fields: Record<string, unknown> }>;
  pendingFollowUps: Array<{ id: string; name: string; fields: Record<string, unknown> }>;
  upcomingTasks: Array<{ id: string; name: string; content: string | null; fields: Record<string, unknown>; tags: string[] }>;
  yesterdayEntries: Array<{ id: string; name: string; category: string; content: string | null; created_at: Date }>;
}

export interface WeeklyReviewData {
  weekEntries: Array<{ id: string; name: string; category: string; content: string | null; created_at: Date }>;
  dailyCounts: Array<{ date: string; count: number }>;
  categoryCounts: Array<{ category: string; count: number }>;
  stalledProjects: Array<{ id: string; name: string; fields: Record<string, unknown>; updated_at: Date }>;
}

export interface CachedDigest {
  content: string;
  generated_at: Date;
}

export async function getDailyDigestData(sql: Sql): Promise<DailyDigestData> {
  const activeProjects = await sql`
    SELECT id, name, fields FROM entries
    WHERE category = 'projects'
      AND deleted_at IS NULL
      AND fields->>'status' = 'active'
      AND fields->>'next_action' IS NOT NULL
      AND fields->>'next_action' != ''
  `;

  const pendingFollowUps = await sql`
    SELECT id, name, fields FROM entries
    WHERE category = 'people'
      AND deleted_at IS NULL
      AND fields->>'follow_ups' IS NOT NULL
      AND fields->>'follow_ups' != ''
  `;

  const upcomingTasks = await sql`
    SELECT id, name, content, fields, tags FROM entries
    WHERE category = 'tasks'
      AND deleted_at IS NULL
      AND fields->>'status' = 'pending'
      AND (fields->>'due_date')::date <= (CURRENT_DATE + INTERVAL '7 days')
  `;

  const yesterdayEntries = await sql`
    SELECT id, name, category, content, created_at FROM entries
    WHERE deleted_at IS NULL
      AND created_at >= CURRENT_DATE - INTERVAL '1 day'
      AND created_at < CURRENT_DATE
  `;

  return {
    activeProjects: activeProjects as any,
    pendingFollowUps: pendingFollowUps as any,
    upcomingTasks: upcomingTasks as any,
    yesterdayEntries: yesterdayEntries as any,
  };
}

export async function getWeeklyReviewData(sql: Sql): Promise<WeeklyReviewData> {
  const weekEntries = await sql`
    SELECT id, name, category, content, created_at FROM entries
    WHERE deleted_at IS NULL
      AND created_at >= CURRENT_DATE - INTERVAL '7 days'
  `;

  const dailyCounts = await sql`
    SELECT created_at::date::text AS date, COUNT(*)::int AS count FROM entries
    WHERE deleted_at IS NULL
      AND created_at >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY created_at::date
    ORDER BY date
  `;

  const categoryCounts = await sql`
    SELECT category, COUNT(*)::int AS count FROM entries
    WHERE deleted_at IS NULL
      AND created_at >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY category
    ORDER BY count DESC
  `;

  const stalledProjects = await sql`
    SELECT id, name, fields, updated_at FROM entries
    WHERE category = 'projects'
      AND deleted_at IS NULL
      AND fields->>'status' = 'active'
      AND updated_at < CURRENT_DATE - INTERVAL '5 days'
  `;

  return {
    weekEntries: weekEntries as any,
    dailyCounts: dailyCounts as any,
    categoryCounts: categoryCounts as any,
    stalledProjects: stalledProjects as any,
  };
}

export async function cacheDigest(sql: Sql, type: "daily" | "weekly", content: string): Promise<void> {
  await sql`
    INSERT INTO digests (type, content, generated_at)
    VALUES (${type}, ${content}, now())
    ON CONFLICT (type) DO UPDATE SET content = ${content}, generated_at = now()
  `;
}

export async function getLatestDigest(sql: Sql, type: "daily" | "weekly"): Promise<CachedDigest | null> {
  const rows = await sql`SELECT content, generated_at FROM digests WHERE type = ${type}`;
  if (rows.length === 0) return null;
  return { content: rows[0].content, generated_at: rows[0].generated_at };
}

