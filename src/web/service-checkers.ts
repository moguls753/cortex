import type postgres from "postgres";
import { getLLMConfig } from "../llm/config.js";
import { resolveConfigValue } from "../config.js";
import { getAllSettings } from "./settings-queries.js";
import { createLogger } from "../logger.js";

const log = createLogger("service-checkers");

export type ServiceStatus = { ready: boolean; detail: string | null };

export type HealthStatus = {
  postgres: ServiceStatus;
  ollama: ServiceStatus;
  whisper: ServiceStatus;
  telegram?: ServiceStatus;
};

export type ServiceCheckers = {
  checkPostgres: () => Promise<ServiceStatus>;
  checkOllama: () => Promise<ServiceStatus>;
  checkWhisper: () => Promise<ServiceStatus>;
  checkTelegram: () => Promise<ServiceStatus | null>;
  getUptime: () => number;
};

const FETCH_TIMEOUT_MS = 3000;
const ROUTE_TIMEOUT_MS = 3000;

const EMBEDDING_MODEL = "qwen3-embedding";

// ─── Pure checker functions ────────────────────────────────────────

export async function checkPostgres(sql: postgres.Sql): Promise<ServiceStatus> {
  try {
    await sql`SELECT 1`;
    return { ready: true, detail: null };
  } catch {
    return { ready: false, detail: "Database unreachable" };
  }
}

export type OllamaCheckDeps = {
  ollamaUrl: string;
  llmBaseUrl: string;
  llmModel: string;
};

export async function checkOllama(deps: OllamaCheckDeps): Promise<ServiceStatus> {
  let modelNames: string[];
  try {
    const res = await fetch(`${deps.ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ready: false, detail: "Ollama unreachable" };
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    modelNames = data.models?.map((m) => m.name) ?? [];
  } catch {
    return { ready: false, detail: "Ollama unreachable" };
  }

  if (!modelNames.some((name) => name.includes(EMBEDDING_MODEL))) {
    return {
      ready: false,
      detail: `Downloading embedding model (${EMBEDDING_MODEL})`,
    };
  }

  if (deps.llmModel && isSameHost(deps.ollamaUrl, deps.llmBaseUrl)) {
    if (!modelNames.some((name) => name.includes(deps.llmModel))) {
      return {
        ready: false,
        detail: `Downloading classification model (${deps.llmModel})`,
      };
    }
  }

  return { ready: true, detail: null };
}

export async function checkWhisper(whisperUrl: string): Promise<ServiceStatus> {
  try {
    const res = await fetch(`${whisperUrl}/health`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 200) {
      return { ready: true, detail: null };
    }
    return { ready: false, detail: "Whisper unreachable" };
  } catch {
    // Connection refused, timeout, DNS error — all indistinguishable from
    // "model still loading" when PRELOAD_MODELS is in effect.
    return {
      ready: false,
      detail: "Loading Whisper model — first boot can take several minutes",
    };
  }
}

export type TelegramCheckDeps = {
  telegramBotToken: string;
  isBotRunning: () => boolean;
};

export async function checkTelegram(
  deps: TelegramCheckDeps,
): Promise<ServiceStatus | null> {
  if (!deps.telegramBotToken) return null;
  if (deps.isBotRunning()) {
    return { ready: true, detail: null };
  }
  return { ready: false, detail: "Telegram bot stopped or crashed" };
}

// ─── URL comparison helper ─────────────────────────────────────────

function isSameHost(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

// ─── Route-level timeout ───────────────────────────────────────────

export function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ROUTE_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

// ─── Factory used by src/index.ts and getServiceStatus ─────────────

export function createServiceCheckers(deps: {
  sql: postgres.Sql;
  startTime: number;
  isBotRunning: () => boolean;
}): ServiceCheckers {
  return {
    checkPostgres: () => checkPostgres(deps.sql),

    checkOllama: async () => {
      const [llmConfig, ollamaUrlSetting] = await Promise.all([
        getLLMConfig(deps.sql).catch((err) => {
          log.warn("Failed to read LLM config for ollama check", {
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }),
        resolveConfigValue("ollama_url", deps.sql).catch(() => null),
      ]);
      const ollamaUrl =
        ollamaUrlSetting ||
        process.env.OLLAMA_URL ||
        "http://ollama:11434";
      return checkOllama({
        ollamaUrl,
        llmBaseUrl: llmConfig?.baseUrl ?? "",
        llmModel: llmConfig?.model ?? "",
      });
    },

    checkWhisper: async () => {
      const whisperUrlSetting = await resolveConfigValue(
        "whisper_url",
        deps.sql,
      ).catch(() => null);
      const whisperUrl =
        whisperUrlSetting ||
        process.env.WHISPER_URL ||
        "http://whisper:8000";
      return checkWhisper(whisperUrl);
    },

    checkTelegram: async () => {
      const settings = await getAllSettings(deps.sql).catch(
        () => ({}) as Record<string, string>,
      );
      return checkTelegram({
        telegramBotToken: settings.telegram_bot_token ?? "",
        isBotRunning: deps.isBotRunning,
      });
    },

    getUptime: () => Math.floor((Date.now() - deps.startTime) / 1000),
  };
}

// ─── Aggregate helper used by page-render handlers ─────────────────

const TIMEOUT_STATUS: ServiceStatus = {
  ready: false,
  detail: "Service check timed out",
};

export async function getServiceStatus(
  sql: postgres.Sql,
  options: { isBotRunning?: () => boolean; startTime?: number } = {},
): Promise<HealthStatus> {
  const checkers = createServiceCheckers({
    sql,
    startTime: options.startTime ?? Date.now(),
    isBotRunning: options.isBotRunning ?? (() => false),
  });

  const [postgres, ollama, whisper, telegram] = await Promise.all([
    withTimeout<ServiceStatus>(checkers.checkPostgres(), TIMEOUT_STATUS),
    withTimeout<ServiceStatus>(checkers.checkOllama(), TIMEOUT_STATUS),
    withTimeout<ServiceStatus>(checkers.checkWhisper(), TIMEOUT_STATUS),
    withTimeout<ServiceStatus | null>(checkers.checkTelegram(), TIMEOUT_STATUS),
  ]);

  const result: HealthStatus = { postgres, ollama, whisper };
  if (telegram !== null) result.telegram = telegram;
  return result;
}
