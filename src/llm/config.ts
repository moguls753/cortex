import type postgres from "postgres";

export interface LLMConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeys: Record<string, string>;
}

const DEFAULT_CONFIG: LLMConfig = {
  provider: process.env.LLM_PROVIDER || "anthropic",
  model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
  baseUrl: process.env.LLM_BASE_URL || "https://api.anthropic.com/v1",
  apiKeys: {
    anthropic: process.env.LLM_API_KEY || "",
  },
};

export async function getLLMConfig(sql: postgres.Sql): Promise<LLMConfig> {
  const rows = await sql`SELECT value FROM settings WHERE key = 'llm_config'`;
  if (rows.length === 0) return { ...DEFAULT_CONFIG, apiKeys: { ...DEFAULT_CONFIG.apiKeys } };
  try {
    const parsed = JSON.parse(rows[0].value) as Partial<LLMConfig>;
    return {
      provider: parsed.provider ?? DEFAULT_CONFIG.provider,
      model: parsed.model ?? DEFAULT_CONFIG.model,
      baseUrl: parsed.baseUrl ?? DEFAULT_CONFIG.baseUrl,
      apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...(parsed.apiKeys ?? {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG, apiKeys: { ...DEFAULT_CONFIG.apiKeys } };
  }
}

export async function saveLLMConfig(sql: postgres.Sql, config: LLMConfig): Promise<void> {
  const json = JSON.stringify(config);
  await sql`
    INSERT INTO settings (key, value) VALUES ('llm_config', ${json})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}
