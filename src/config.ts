import type postgres from "postgres";

const REQUIRED_VARS = [
  "DATABASE_URL",
  "LLM_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "WEBAPP_PASSWORD",
  "SESSION_SECRET",
] as const;

const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}`,
  );
}

const databaseUrl = process.env.DATABASE_URL!;
if (
  !databaseUrl.startsWith("postgresql://") &&
  !databaseUrl.startsWith("postgres://")
) {
  throw new Error(
    `DATABASE_URL is malformed or has an invalid format: "${databaseUrl}"`,
  );
}

export const config = {
  databaseUrl,
  llmProvider: process.env.LLM_PROVIDER || "anthropic",
  llmApiKey: process.env.LLM_API_KEY!,
  llmModel: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
  llmBaseUrl: process.env.LLM_BASE_URL || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,
  webappPassword: process.env.WEBAPP_PASSWORD!,
  sessionSecret: process.env.SESSION_SECRET!,
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  ollamaModel: process.env.OLLAMA_MODEL || "snowflake-arctic-embed2",
  timezone: process.env.TZ || "Europe/Berlin",
  dailyDigestCron: process.env.DAILY_DIGEST_CRON || "30 7 * * *",
  weeklyDigestCron: process.env.WEEKLY_DIGEST_CRON || "0 16 * * 0",
};

const SETTINGS_TO_ENV: Record<string, string> = {
  llm_provider: "LLM_PROVIDER",
  llm_model: "LLM_MODEL",
  llm_base_url: "LLM_BASE_URL",
  timezone: "TZ",
  daily_digest_cron: "DAILY_DIGEST_CRON",
  weekly_digest_cron: "WEEKLY_DIGEST_CRON",
  ollama_url: "OLLAMA_URL",
  confidence_threshold: "CONFIDENCE_THRESHOLD",
  digest_email_to: "DIGEST_EMAIL_TO",
};

export async function resolveConfigValue(
  key: string,
  sql: postgres.Sql,
): Promise<string | undefined> {
  const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
  if (rows.length > 0) {
    return rows[0].value;
  }

  const envVar = SETTINGS_TO_ENV[key];
  if (envVar) {
    return process.env[envVar];
  }

  return undefined;
}
