import type postgres from "postgres";

type Sql = postgres.Sql;

export interface EntryRow {
  id: string;
  name: string;
  category: string | null;
  content: string | null;
  fields: Record<string, unknown>;
  tags: string[];
  confidence: number | null;
  source: string;
  source_type: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function getRecentEntries(
  sql: Sql,
  limit = 5,
): Promise<EntryRow[]> {
  const rows = await sql`
    SELECT id, name, category, content, fields, tags, confidence,
           source, source_type, deleted_at, created_at, updated_at
    FROM entries
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as EntryRow[];
}

export async function getDashboardStats(
  sql: Sql,
): Promise<{
  entriesThisWeek: number;
  totalEntries: number;
  openTasks: number;
  stalledProjects: number;
}> {
  const [weekResult, totalResult, tasksResult, stalledResult] = await Promise.all([
    sql`
      SELECT COUNT(*)::int AS count FROM entries
      WHERE deleted_at IS NULL
        AND created_at >= date_trunc('week', CURRENT_DATE)
    `,
    sql`
      SELECT COUNT(*)::int AS count FROM entries
      WHERE deleted_at IS NULL
    `,
    sql`
      SELECT COUNT(*)::int AS count FROM entries
      WHERE deleted_at IS NULL
        AND category = 'tasks'
        AND fields->>'status' = 'pending'
    `,
    sql`
      SELECT COUNT(*)::int AS count FROM entries
      WHERE deleted_at IS NULL
        AND category = 'projects'
        AND fields->>'status' = 'active'
        AND updated_at < NOW() - INTERVAL '5 days'
    `,
  ]);

  return {
    entriesThisWeek: weekResult[0]?.count ?? 0,
    totalEntries: totalResult[0]?.count ?? 0,
    openTasks: tasksResult[0]?.count ?? 0,
    stalledProjects: stalledResult[0]?.count ?? 0,
  };
}

export async function getLatestDigest(
  sql: Sql,
): Promise<{ content: string; created_at: Date } | null> {
  const rows = await sql`
    SELECT content, generated_at FROM digests WHERE type = 'daily'
  `;
  if (!rows.length) return null;
  return { content: rows[0].content, created_at: rows[0].generated_at };
}

export async function insertEntry(
  sql: Sql,
  data: Record<string, unknown>,
): Promise<string> {
  const rows = await sql`
    INSERT INTO entries (name, content, category, confidence, fields, tags, source, source_type)
    VALUES (
      ${(data.name as string) ?? "Untitled"},
      ${(data.content as string) ?? null},
      ${(data.category as string) ?? null},
      ${(data.confidence as number) ?? null},
      ${sql.json((data.fields ?? {}) as unknown as Parameters<typeof sql.json>[0])},
      ${(data.tags as string[]) ?? []},
      ${(data.source as string) ?? "webapp"},
      ${(data.source_type as string) ?? "text"}
    )
    RETURNING id
  `;
  return rows[0]!.id;
}
