import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { config, resolveSessionSecret } from "./config.js";
import { createLogger } from "./logger.js";
import { createDbConnection, runMigrations } from "./db/index.js";
import { createHealthRoute } from "./web/health.js";
import { createServiceCheckers } from "./web/service-checkers.js";
import { createSetupMiddleware, createSetupRoutes } from "./web/setup.js";
import { createLocaleMiddleware } from "./web/i18n/middleware.js";
import { initI18n } from "./web/i18n/index.js";
import { createDashboardRoutes } from "./web/dashboard.js";
import { createBrowseRoutes } from "./web/browse.js";
import { createEntryRoutes } from "./web/entry.js";
import { createNewNoteRoutes } from "./web/new-note.js";
import { createSettingsRoutes } from "./web/settings.js";
import { createTrashRoutes } from "./web/trash.js";
import { createMcpHttpHandler } from "./mcp-tools.js";
import { createDisplayRoutes } from "./display/index.js";
import { createSSEBroadcaster } from "./web/sse.js";
import { initializeEmbedding } from "./embed.js";
import { startBot, isBotRunning } from "./telegram.js";
import { listenForEntryChanges } from "./db/notify.js";
import { startScheduler } from "./digests.js";

const log = createLogger("server");
const startTime = Date.now();

async function main(): Promise<void> {
  log.info("Starting Cortex", { port: config.port });

  // Run database migrations
  log.info("Running database migrations");
  await runMigrations(config.databaseUrl);

  // Create database connection
  const sql = createDbConnection(config.databaseUrl);

  // Resolve session secret (env var -> DB -> auto-generate)
  const sessionSecret = await resolveSessionSecret(sql);

  // Initialize embedding model (best-effort, retries internally for up to 10 min)
  initializeEmbedding();

  // Create SSE broadcaster
  const broadcaster = createSSEBroadcaster();

  // Listen for DB entry changes and broadcast via SSE
  listenForEntryChanges(sql, broadcaster).catch((err) => {
    log.warn("Failed to start entry change listener", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Service checkers for /health endpoint and page-render status bar.
  const checkers = createServiceCheckers({ sql, startTime, isBotRunning });

  // Build the app
  const app = new Hono();

  // Initialize i18next catalogs (idempotent)
  await initI18n();

  // Static files (CSS, etc.) — before auth so they load on the login page
  app.use("/public/*", serveStatic({ root: "./" }));

  // Display routes — before auth middleware (they handle their own token-based auth)
  app.route("/", createDisplayRoutes(sql));

  // Locale middleware — runs before everything else so pre-auth pages
  // (login, setup wizard) also see the resolved locale in c.get("t").
  app.use("*", createLocaleMiddleware(sql));

  // Setup middleware handles both setup-mode detection and authentication
  app.use("*", createSetupMiddleware(sql, sessionSecret));

  // Mount routes (setup routes include login/logout + wizard)
  app.route("/", createSetupRoutes(sql, sessionSecret));
  app.route("/", createHealthRoute(checkers));
  app.route("/", createDashboardRoutes(sql, broadcaster));
  app.route("/", createBrowseRoutes(sql));
  app.route("/", createTrashRoutes(sql));
  app.route("/", createEntryRoutes(sql));
  app.route("/", createNewNoteRoutes(sql));
  app.route("/", createSettingsRoutes(sql, broadcaster));

  // MCP HTTP endpoint (JSON-RPC)
  const mcpHandler = createMcpHttpHandler(sql);
  app.post("/mcp", async (c) => {
    const body = await c.req.json();
    const result = await mcpHandler(body);
    return c.json(result);
  });

  // Start HTTP server
  serve({ fetch: app.fetch, port: config.port }, () => {
    log.info(`Cortex listening on http://0.0.0.0:${config.port}`);
  });

  // Start digest scheduler (cron jobs for daily/weekly digests + background retry)
  startScheduler(sql, broadcaster)
    .then(() => {
      log.info("Digest scheduler started");
    })
    .catch((err) => {
      log.error("Digest scheduler failed to start", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  // Start Telegram bot
  startBot(sql)
    .then(() => {
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
