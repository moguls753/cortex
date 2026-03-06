import type postgres from "postgres";

type Sql = postgres.Sql;

import type { EntryRow } from "./dashboard-queries.js";

export async function getEntry(
  sql: Sql,
  id: string,
): Promise<EntryRow | null> {
  const rows = await sql`
    SELECT id, name, category, content, fields, tags, confidence,
           source, source_type, deleted_at, created_at, updated_at
    FROM entries
    WHERE id = ${id}
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as EntryRow;
}

export async function updateEntry(
  sql: Sql,
  id: string,
  data: {
    name: string;
    category: string | null;
    content: string | null;
    fields: Record<string, unknown>;
    tags: string[];
  },
): Promise<void> {
  await sql`
    UPDATE entries
    SET name = ${data.name},
        category = ${data.category},
        content = ${data.content},
        fields = ${sql.json(data.fields as unknown as Parameters<typeof sql.json>[0])},
        tags = ${data.tags},
        confidence = NULL
    WHERE id = ${id}
  `;
}

export async function softDeleteEntry(
  sql: Sql,
  id: string,
): Promise<void> {
  await sql`
    UPDATE entries SET deleted_at = NOW() WHERE id = ${id}
  `;
}

export async function restoreEntry(
  sql: Sql,
  id: string,
): Promise<void> {
  await sql`
    UPDATE entries SET deleted_at = NULL WHERE id = ${id}
  `;
}

export async function getAllTags(sql: Sql): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT unnest(tags) AS tag
    FROM entries
    WHERE deleted_at IS NULL
    ORDER BY tag
  `;
  return rows.map((r) => r.tag as string);
}
