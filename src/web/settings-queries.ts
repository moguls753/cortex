import type postgres from "postgres";

type Sql = postgres.Sql;

export async function getAllSettings(
  sql: Sql,
): Promise<Record<string, string>> {
  const rows = await sql`SELECT key, value FROM settings`;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export async function saveAllSettings(
  sql: Sql,
  settings: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(settings);
  if (entries.length === 0) return;

  const keys = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v);

  await sql`
    INSERT INTO settings (key, value)
    SELECT * FROM unnest(${keys}::text[], ${values}::text[])
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}
