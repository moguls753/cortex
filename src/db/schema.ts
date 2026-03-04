import {
  pgTable,
  uuid,
  text,
  real,
  timestamp,
  jsonb,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: text("category"),
    name: text("name").notNull(),
    content: text("content"),
    fields: jsonb("fields").notNull().default({}),
    tags: text("tags").array().default([]),
    confidence: real("confidence"),
    source: text("source").notNull(),
    sourceType: text("source_type").default("text"),
    // embedding column is vector(1024), defined via raw SQL migration
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    check(
      "entries_category_check",
      sql`${table.category} IN ('people', 'projects', 'tasks', 'ideas', 'reference')`,
    ),
    check(
      "entries_source_check",
      sql`${table.source} IN ('telegram', 'webapp', 'mcp')`,
    ),
    check(
      "entries_source_type_check",
      sql`${table.sourceType} IN ('text', 'voice')`,
    ),
    index("entries_category_idx").on(table.category),
    index("entries_created_at_idx").on(table.createdAt),
  ],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
