import type postgres from "postgres";

type Sql = postgres.Sql;

const VALID_CATEGORIES = ["people", "projects", "tasks", "ideas", "reference"];

export async function searchBySimilarity(
  sql: Sql,
  embedding: number[],
  limit: number,
): Promise<any[]> {
  const vecStr = `[${embedding.join(",")}]`;
  const rows = await sql`
    SELECT id, category, name, content, tags,
           1 - (embedding <=> ${vecStr}::vector) AS similarity,
           created_at
    FROM entries
    WHERE deleted_at IS NULL
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${vecStr}::vector) >= 0.6
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;
  return rows as unknown as any[];
}

export async function insertMcpEntry(
  sql: Sql,
  data: {
    name: string;
    content: string;
    category: string | null;
    confidence: number | null;
    fields: Record<string, unknown>;
    tags: string[];
    source: string;
    source_type: string;
    embedding: number[] | null;
  },
): Promise<any> {
  if (data.embedding) {
    const vecStr = `[${data.embedding.join(",")}]`;
    const rows = await sql`
      INSERT INTO entries (name, content, category, confidence, fields, tags, source, source_type, embedding)
      VALUES (
        ${data.name},
        ${data.content},
        ${data.category},
        ${data.confidence},
        ${sql.json(data.fields as unknown as Parameters<typeof sql.json>[0])},
        ${data.tags},
        ${data.source},
        ${data.source_type},
        ${vecStr}::vector(4096)
      )
      RETURNING *
    `;
    return rows[0];
  }

  const rows = await sql`
    INSERT INTO entries (name, content, category, confidence, fields, tags, source, source_type)
    VALUES (
      ${data.name},
      ${data.content},
      ${data.category},
      ${data.confidence},
      ${sql.json(data.fields as unknown as Parameters<typeof sql.json>[0])},
      ${data.tags},
      ${data.source},
      ${data.source_type}
    )
    RETURNING *
  `;
  return rows[0];
}

export async function listRecentEntries(
  sql: Sql,
  days: number,
  category?: string,
): Promise<any[]> {
  if (category) {
    const rows = await sql`
      SELECT id, category, name, tags, created_at, updated_at
      FROM entries
      WHERE deleted_at IS NULL
        AND category = ${category}
        AND created_at >= NOW() - ${days + " days"}::interval
      ORDER BY created_at DESC
    `;
    return rows as unknown as any[];
  }

  const rows = await sql`
    SELECT id, category, name, tags, created_at, updated_at
    FROM entries
    WHERE deleted_at IS NULL
      AND created_at >= NOW() - ${days + " days"}::interval
    ORDER BY created_at DESC
  `;
  return rows as unknown as any[];
}

export async function getEntryById(
  sql: Sql,
  id: string,
): Promise<any | null> {
  const rows = await sql`
    SELECT id, category, name, content, fields, tags, confidence,
           source, source_type, deleted_at, created_at, updated_at
    FROM entries
    WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function updateEntryFields(
  sql: Sql,
  id: string,
  updates: Record<string, unknown>,
): Promise<any> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if ("name" in updates) {
    setClauses.push("name = $" + (values.length + 1));
    values.push(updates.name);
  }
  if ("content" in updates) {
    setClauses.push("content = $" + (values.length + 1));
    values.push(updates.content);
  }
  if ("category" in updates) {
    setClauses.push("category = $" + (values.length + 1));
    values.push(updates.category);
  }
  if ("tags" in updates) {
    setClauses.push("tags = $" + (values.length + 1));
    values.push(updates.tags);
  }
  if ("fields" in updates) {
    setClauses.push("fields = $" + (values.length + 1) + "::jsonb");
    values.push(JSON.stringify(updates.fields));
  }
  if ("embedding" in updates) {
    if (updates.embedding === null) {
      setClauses.push("embedding = NULL");
    } else {
      const vecStr = `[${(updates.embedding as number[]).join(",")}]`;
      setClauses.push("embedding = $" + (values.length + 1) + "::vector(4096)");
      values.push(vecStr);
    }
  }

  if (setClauses.length === 0) {
    return getEntryById(sql, id);
  }

  const query = `
    UPDATE entries SET ${setClauses.join(", ")}
    WHERE id = $${values.length + 1} AND deleted_at IS NULL
    RETURNING id, category, name, content, fields, tags, confidence,
              source, source_type, deleted_at, created_at, updated_at
  `;
  values.push(id);

  const rows = await sql.unsafe(query, values as any[]);
  return rows[0] ?? null;
}

export async function softDeleteEntry(
  sql: Sql,
  id: string,
): Promise<void> {
  await sql`
    UPDATE entries SET deleted_at = NOW()
    WHERE id = ${id}
  `;
}

export async function getBrainStats(sql: Sql): Promise<{
  total_entries: number;
  by_category: Record<string, number>;
  entries_this_week: number;
  open_tasks: number;
  stalled_projects: number;
  recent_activity: Array<{ date: string; count: number }>;
}> {
  const [totalResult, weekResult, tasksResult, stalledResult, categoryResult, activityResult] =
    await Promise.all([
      sql`SELECT COUNT(*)::int AS count FROM entries WHERE deleted_at IS NULL`,
      sql`
        SELECT COUNT(*)::int AS count FROM entries
        WHERE deleted_at IS NULL
          AND created_at >= date_trunc('week', CURRENT_DATE)
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
      sql`
        SELECT category, COUNT(*)::int AS count FROM entries
        WHERE deleted_at IS NULL AND category IS NOT NULL
        GROUP BY category
      `,
      sql`
        SELECT d::date AS date, COUNT(e.id)::int AS count
        FROM generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          '1 day'
        ) AS d
        LEFT JOIN entries e ON e.created_at::date = d::date AND e.deleted_at IS NULL
        GROUP BY d::date
        ORDER BY d::date ASC
      `,
    ]);

  const by_category: Record<string, number> = {
    people: 0,
    projects: 0,
    tasks: 0,
    ideas: 0,
    reference: 0,
  };
  for (const row of categoryResult) {
    if (row.category && row.category in by_category) {
      by_category[row.category] = row.count;
    }
  }

  const recent_activity = activityResult.map((row: any) => ({
    date: row.date instanceof Date
      ? row.date.toISOString().split("T")[0]
      : String(row.date),
    count: row.count,
  }));

  return {
    total_entries: totalResult[0]?.count ?? 0,
    by_category,
    entries_this_week: weekResult[0]?.count ?? 0,
    open_tasks: tasksResult[0]?.count ?? 0,
    stalled_projects: stalledResult[0]?.count ?? 0,
    recent_activity,
  };
}
