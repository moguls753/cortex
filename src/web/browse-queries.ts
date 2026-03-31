import type postgres from "postgres";
import type { EntryRow } from "./dashboard-queries.js";

type Sql = postgres.Sql;

export interface BrowseFilters {
  category?: string;
  tag?: string;
}

export async function browseEntries(
  sql: Sql,
  filters?: BrowseFilters,
): Promise<EntryRow[]> {
  const category = filters?.category;
  const tag = filters?.tag;

  const rows = await sql`
    SELECT id, name, category, content, fields, tags, confidence,
           source, source_type, deleted_at, created_at, updated_at
    FROM entries
    WHERE deleted_at IS NULL
      ${category === "unclassified" ? sql`AND category IS NULL` : category ? sql`AND category = ${category}` : sql``}
      ${tag ? sql`AND ${tag} = ANY(tags)` : sql``}
    ORDER BY updated_at DESC
  `;
  return rows as unknown as EntryRow[];
}

export async function semanticSearch(
  sql: Sql,
  queryEmbedding: number[],
  filters?: BrowseFilters,
): Promise<EntryRow[]> {
  const category = filters?.category;
  const tag = filters?.tag;
  const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

  const rows = await sql`
    SELECT id, name, category, content, fields, tags, confidence,
           source, source_type, deleted_at, created_at, updated_at,
           1 - (embedding <=> ${embeddingLiteral}::vector(1024)) AS similarity
    FROM entries
    WHERE deleted_at IS NULL
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${embeddingLiteral}::vector(1024)) >= 0.5
      ${category === "unclassified" ? sql`AND category IS NULL` : category ? sql`AND category = ${category}` : sql``}
      ${tag ? sql`AND ${tag} = ANY(tags)` : sql``}
    ORDER BY similarity DESC
  `;
  return rows as unknown as EntryRow[];
}

export async function textSearch(
  sql: Sql,
  query: string,
  filters?: BrowseFilters,
): Promise<EntryRow[]> {
  const category = filters?.category;
  const tag = filters?.tag;
  const pattern = `%${query}%`;

  const rows = await sql`
    SELECT id, name, category, content, fields, tags, confidence,
           source, source_type, deleted_at, created_at, updated_at
    FROM entries
    WHERE deleted_at IS NULL
      AND (name ILIKE ${pattern} OR content ILIKE ${pattern})
      ${category === "unclassified" ? sql`AND category IS NULL` : category ? sql`AND category = ${category}` : sql``}
      ${tag ? sql`AND ${tag} = ANY(tags)` : sql``}
    ORDER BY updated_at DESC
  `;
  return rows as unknown as EntryRow[];
}

export async function getFilterTags(
  sql: Sql,
  options?: { category?: string },
): Promise<string[]> {
  const category = options?.category;

  const rows = await sql`
    SELECT DISTINCT unnest(tags) AS tag
    FROM entries
    WHERE deleted_at IS NULL
      ${category === "unclassified" ? sql`AND category IS NULL` : category ? sql`AND category = ${category}` : sql``}
    ORDER BY tag
  `;
  return rows.map((r) => r.tag as string);
}
