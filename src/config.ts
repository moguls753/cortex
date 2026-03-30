import { randomBytes } from "node:crypto";
import type postgres from "postgres";

const REQUIRED_VARS = ["DATABASE_URL"] as const;

const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable: ${missing.join(", ")}`,
  );
}

const databaseUrl = process.env.DATABASE_URL!;

export const config = {
  databaseUrl,
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  ollamaUrl: process.env.OLLAMA_URL || "http://ollama:11434",
  whisperUrl: process.env.WHISPER_URL || "http://whisper:8000",
  timezone: process.env.TZ || "Europe/Berlin",
};

export async function resolveSessionSecret(
  sql: postgres.Sql,
): Promise<string> {
  // 1. Check env var first
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  // 2. Check settings table
  const rows = await sql`SELECT value FROM settings WHERE key = 'session_secret'`;
  if (rows.length > 0) {
    return rows[0].value;
  }

  // 3. Generate and save a new secret
  const secret = randomBytes(32).toString("hex");
  await sql`
    INSERT INTO settings (key, value) VALUES ('session_secret', ${secret})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
  return secret;
}

export async function resolveConfigValue(
  key: string,
  sql: postgres.Sql,
): Promise<string | undefined> {
  const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
  if (rows.length > 0) {
    return rows[0].value;
  }

  return undefined;
}
