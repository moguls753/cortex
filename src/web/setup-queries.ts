import type postgres from "postgres";

type Sql = postgres.Sql;

export async function getUserCount(sql: Sql): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM "user"`;
  return rows[0].count;
}

export async function getUserPasswordHash(sql: Sql): Promise<string | null> {
  const rows = await sql`SELECT password_hash FROM "user" WHERE id = 1`;
  if (rows.length === 0) return null;
  return rows[0].password_hash;
}

export async function getDisplayName(sql: Sql): Promise<string | null> {
  const rows = await sql`SELECT display_name FROM "user" WHERE id = 1`;
  if (rows.length === 0) return null;
  return rows[0].display_name ?? null;
}

export async function createUser(
  sql: Sql,
  opts: { passwordHash: string; displayName: string | null },
): Promise<{ id: number }> {
  const rows = await sql`
    INSERT INTO "user" (id, password_hash, display_name)
    VALUES (1, ${opts.passwordHash}, ${opts.displayName})
    RETURNING id
  `;
  return { id: rows[0].id };
}

export async function getSetupSummary(
  sql: Sql,
): Promise<{ hasUser: boolean; hasLLM: boolean; hasTelegram: boolean }> {
  const userCount = await getUserCount(sql);
  const hasUser = userCount > 0;

  const settingsRows = await sql`
    SELECT key FROM settings WHERE key IN ('llm_config', 'telegram_bot_token')
  `;
  const settingKeys = new Set(settingsRows.map((r) => (r as { key: string }).key));

  return {
    hasUser,
    hasLLM: settingKeys.has("llm_config"),
    hasTelegram: settingKeys.has("telegram_bot_token"),
  };
}
