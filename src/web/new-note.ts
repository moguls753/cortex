import { Hono } from "hono";
import type postgres from "postgres";

type Sql = postgres.Sql;

export function createNewNoteRoutes(sql: Sql): Hono {
  const app = new Hono();
  return app;
}
