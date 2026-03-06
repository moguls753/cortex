import type postgres from "postgres";
import type { EntryRow } from "./dashboard-queries.js";

type Sql = postgres.Sql;

export interface BrowseFilters {
  category?: string;
  tag?: string;
}

export async function browseEntries(
  _sql: Sql,
  _filters?: BrowseFilters,
): Promise<EntryRow[]> {
  throw new Error("Not implemented");
}

export async function semanticSearch(
  _sql: Sql,
  _queryEmbedding: number[],
  _filters?: BrowseFilters,
): Promise<EntryRow[]> {
  throw new Error("Not implemented");
}

export async function textSearch(
  _sql: Sql,
  _query: string,
  _filters?: BrowseFilters,
): Promise<EntryRow[]> {
  throw new Error("Not implemented");
}

export async function getFilterTags(
  _sql: Sql,
  _options?: { category?: string },
): Promise<string[]> {
  throw new Error("Not implemented");
}
