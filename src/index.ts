import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "./config.js";
import { createLogger } from "./logger.js";
import { createDbConnection, runMigrations } from "./db/index.js";
import { createHealthRoute, type ServiceCheckers } from "./web/health.js";
import { createAuthMiddleware, createAuthRoutes } from "./web/auth.js";
import { createDashboardRoutes } from "./web/dashboard.js";
import { createBrowseRoutes } from "./web/browse.js";
import { createSSEBroadcaster } from "./web/sse.js";
import { initializeEmbedding } from "./embed.js";
import { startBot } from "./telegram.js";

const log = createLogger("server");
const startTime = Date.now();

async function main(): Promise<void> {
  log.info("Starting Cortex", { port: config.port });

  // Run database migrations
  log.info("Running database migrations");
  await runMigrations(config.databaseUrl);

  // Create database connection
  const sql = createDbConnection(config.databaseUrl);

  // Initialize embedding model (best-effort)
  initializeEmbedding().catch(() => {
    log.warn("Embedding model initialization failed — will retry on first use");
  });

  // Create SSE broadcaster
  const broadcaster = createSSEBroadcaster();

  // Telegram bot state (must be declared before checkers reference it)
  let telegramStarted = false;

  // Service checkers for health endpoint
  const checkers: ServiceCheckers = {
    checkPostgres: async () => {
      try {
        await sql`SELECT 1`;
        return "connected";
      } catch {
        return "disconnected";
      }
    },
    checkOllama: async () => {
      try {
        const ollamaUrl = process.env.OLLAMA_URL || "http://ollama:11434";
        const res = await fetch(ollamaUrl, { signal: AbortSignal.timeout(3000) });
        return res.ok ? "connected" : "disconnected";
      } catch {
        return "disconnected";
      }
    },
    checkWhisper: async () => {
      try {
        const whisperUrl = process.env.WHISPER_URL || "http://whisper:8000";
        const res = await fetch(whisperUrl, { signal: AbortSignal.timeout(3000) });
        return res.ok ? "connected" : "disconnected";
      } catch {
        return "disconnected";
      }
    },
    checkTelegram: async () => {
      return telegramStarted ? "polling" : "stopped";
    },
    getUptime: () => Math.floor((Date.now() - startTime) / 1000),
  };

  // Build the app
  const app = new Hono();

  // Static files (CSS, etc.) — before auth so they load on the login page
  app.use("/public/*", serveStatic({ root: "./" }));

  // Auth middleware (protects all routes except /health and /login)
  app.use("*", createAuthMiddleware(config.sessionSecret));

  // Mount routes
  app.route("/", createAuthRoutes(config.webappPassword, config.sessionSecret));
  app.route("/", createHealthRoute(checkers));
  app.route("/", createDashboardRoutes(sql, broadcaster));
  app.route("/", createBrowseRoutes(sql));

  // Start HTTP server
  serve({ fetch: app.fetch, port: config.port }, () => {
    log.info(`Cortex listening on http://0.0.0.0:${config.port}`);
  });

  // Start Telegram bot
  startBot(sql)
    .then(() => {
      telegramStarted = true;
      log.info("Telegram bot started");
    })
    .catch((err) => {
      log.error("Telegram bot failed to start", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

main().catch((err) => {
  log.error("Fatal startup error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
