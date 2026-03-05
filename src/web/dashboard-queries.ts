import type postgres from "postgres";

type Sql = postgres.Sql;

export async function getRecentEntries(
  _sql: Sql,
  _limit = 5,
): Promise<any[]> {
  return [];
}

export async function getDashboardStats(
  _sql: Sql,
): Promise<{
  entriesThisWeek: number;
  openTasks: number;
  stalledProjects: number;
}> {
  return { entriesThisWeek: 0, openTasks: 0, stalledProjects: 0 };
}

export async function getLatestDigest(
  _sql: Sql,
): Promise<{ content: string; created_at: Date } | null> {
  return null;
}

export async function insertEntry(
  _sql: Sql,
  _data: Record<string, unknown>,
): Promise<string> {
  return "";
}
