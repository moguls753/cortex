import type postgres from "postgres";
import type { EntryRow } from "./dashboard-queries.js";

type Sql = postgres.Sql;

export type SinceValue = "today" | "week" | "month";
export type StatusValue = "pending" | "done" | "active" | "paused" | "completed";

export interface BrowseFilters {
  category?: string;
  tag?: string;
  deleted?: boolean;
  since?: SinceValue;
  status?: StatusValue;
  stale_days?: number;
}

/**
 * SQL fragment for the `since` filter. Uses date_trunc in the PG server's
 * timezone, matching `getDashboardStats` in dashboard-queries.ts.
 */
function sinceFragment(sql: Sql, since: SinceValue | undefined) {
  if (!since) return sql``;
  const unit =
    since === "today" ? "day" : since === "week" ? "week" : "month";
  return sql`AND created_at >= date_trunc(${unit}, CURRENT_DATE)`;
}

function statusFragment(sql: Sql, status: StatusValue | undefined) {
  if (!status) return sql``;
  return sql`AND fields->>'status' = ${status}`;
}

function staleDaysFragment(sql: Sql, staleDays: number | undefined) {
  if (staleDays === undefined) return sql``;
  return sql`AND updated_at < now() - make_interval(days => ${staleDays})`;
}

export async function browseEntries(
  sql: Sql,
  filters?: BrowseFilters,
): Promise<EntryRow[]> {
  const category = filters?.category;
  const tag = filters?.tag;
  const deleted = filters?.deleted ?? false;

  const rows = await sql`
    SELECT id, name, category, content, fields, tags, confidence,
           source, source_type, visibility, deleted_at, created_at, updated_at
    FROM entries
    WHERE ${deleted ? sql`deleted_at IS NOT NULL` : sql`deleted_at IS NULL`}
      ${category === "unclassified" ? sql`AND category IS NULL` : category ? sql`AND category = ${category}` : sql``}
      ${tag ? sql`AND ${tag} = ANY(tags)` : sql``}
      ${sinceFragment(sql, filters?.since)}
      ${statusFragment(sql, filters?.status)}
      ${staleDaysFragment(sql, filters?.stale_days)}
    ORDER BY ${deleted ? sql`deleted_at DESC` : sql`updated_at DESC`}
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
  const deleted = filters?.deleted ?? false;
  const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

  const rows = await sql`
    SELECT id, name, category, content, fields, tags, confidence,
           source, source_type, visibility, deleted_at, created_at, updated_at,
           1 - (embedding <=> ${embeddingLiteral}::vector(4096)) AS similarity
    FROM entries
    WHERE ${deleted ? sql`deleted_at IS NOT NULL` : sql`deleted_at IS NULL`}
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${embeddingLiteral}::vector(4096)) >= 0.6
      ${category === "unclassified" ? sql`AND category IS NULL` : category ? sql`AND category = ${category}` : sql``}
      ${tag ? sql`AND ${tag} = ANY(tags)` : sql``}
      ${sinceFragment(sql, filters?.since)}
      ${statusFragment(sql, filters?.status)}
      ${staleDaysFragment(sql, filters?.stale_days)}
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
  const deleted = filters?.deleted ?? false;
  const pattern = `%${query}%`;

  const rows = await sql`
    SELECT id, name, category, content, fields, tags, confidence,
           source, source_type, visibility, deleted_at, created_at, updated_at
    FROM entries
    WHERE ${deleted ? sql`deleted_at IS NOT NULL` : sql`deleted_at IS NULL`}
      AND (name ILIKE ${pattern} OR content ILIKE ${pattern})
      ${category === "unclassified" ? sql`AND category IS NULL` : category ? sql`AND category = ${category}` : sql``}
      ${tag ? sql`AND ${tag} = ANY(tags)` : sql``}
      ${sinceFragment(sql, filters?.since)}
      ${statusFragment(sql, filters?.status)}
      ${staleDaysFragment(sql, filters?.stale_days)}
    ORDER BY ${deleted ? sql`deleted_at DESC` : sql`updated_at DESC`}
  `;
  return rows as unknown as EntryRow[];
}

export async function getFilterTags(
  sql: Sql,
  options?: { category?: string; deleted?: boolean },
): Promise<string[]> {
  const category = options?.category;
  const deleted = options?.deleted ?? false;

  const rows = await sql`
    SELECT DISTINCT unnest(tags) AS tag
    FROM entries
    WHERE ${deleted ? sql`deleted_at IS NOT NULL` : sql`deleted_at IS NULL`}
      ${category === "unclassified" ? sql`AND category IS NULL` : category ? sql`AND category = ${category}` : sql``}
    ORDER BY tag
  `;
  return rows.map((r) => r.tag as string);
}

export interface TagCount {
  tag: string;
  count: number;
}

export async function getTagCounts(
  sql: Sql,
  options?: { category?: string; deleted?: boolean },
): Promise<TagCount[]> {
  const category = options?.category;
  const deleted = options?.deleted ?? false;

  const rows = await sql`
    SELECT t.tag, COUNT(*)::int AS count
    FROM entries e, unnest(e.tags) AS t(tag)
    WHERE ${deleted ? sql`e.deleted_at IS NOT NULL` : sql`e.deleted_at IS NULL`}
      ${category === "unclassified" ? sql`AND e.category IS NULL` : category ? sql`AND e.category = ${category}` : sql``}
    GROUP BY t.tag
    ORDER BY count DESC, t.tag ASC
  `;
  return rows as unknown as TagCount[];
}
