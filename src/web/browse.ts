import { Hono } from "hono";
import type postgres from "postgres";

type Sql = postgres.Sql;

export function createBrowseRoutes(_sql: Sql): Hono {
  const app = new Hono();
  // Stub: not yet implemented
  return app;
}
