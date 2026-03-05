import { Hono } from "hono";
import type { SSEBroadcaster } from "./sse.js";
import type postgres from "postgres";

type Sql = postgres.Sql;

export function createDashboardRoutes(
  _sql: Sql,
  _broadcaster: SSEBroadcaster,
): Hono {
  return new Hono();
}
