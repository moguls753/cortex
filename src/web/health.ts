import { Hono } from "hono";
import {
  type ServiceCheckers,
  type ServiceStatus,
  withTimeout,
} from "./service-checkers.js";

export type { ServiceCheckers, ServiceStatus };

const TIMEOUT_STATUS: ServiceStatus = {
  ready: false,
  detail: "Service check timed out",
};

export function createHealthRoute(checkers: ServiceCheckers): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const [postgres, ollama, whisper, telegram] = await Promise.all([
      withTimeout<ServiceStatus>(checkers.checkPostgres(), TIMEOUT_STATUS),
      withTimeout<ServiceStatus>(checkers.checkOllama(), TIMEOUT_STATUS),
      withTimeout<ServiceStatus>(checkers.checkWhisper(), TIMEOUT_STATUS),
      withTimeout<ServiceStatus | null>(checkers.checkTelegram(), TIMEOUT_STATUS),
    ]);

    const services: Record<string, ServiceStatus> = { postgres, ollama, whisper };
    if (telegram !== null) services.telegram = telegram;

    const status: "ok" | "degraded" = postgres.ready ? "ok" : "degraded";

    return c.json({
      status,
      services,
      uptime: checkers.getUptime(),
    });
  });

  return app;
}
