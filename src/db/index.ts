import postgres from "postgres";

export function createDbConnection(url: string): postgres.Sql {
  return postgres(url);
}

export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });

  try {
    await sql.unsafe(`
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE IF NOT EXISTS entries (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category      TEXT CHECK (category IN ('people', 'projects', 'tasks', 'ideas', 'reference')),
        name          TEXT NOT NULL,
        content       TEXT,
        fields        JSONB NOT NULL DEFAULT '{}',
        tags          TEXT[] DEFAULT '{}',
        confidence    REAL,
        source        TEXT NOT NULL CHECK (source IN ('telegram', 'webapp', 'mcp')),
        source_type   TEXT DEFAULT 'text' CHECK (source_type IN ('text', 'voice')),
        embedding     vector(1024),
        deleted_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT now(),
        updated_at    TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS entries_embedding_idx ON entries USING hnsw (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS entries_category_idx ON entries (category);
      CREATE INDEX IF NOT EXISTS entries_created_at_idx ON entries (created_at);
      CREATE INDEX IF NOT EXISTS entries_tags_idx ON entries USING gin (tags);

      CREATE TABLE IF NOT EXISTS settings (
        key           TEXT PRIMARY KEY,
        value         TEXT NOT NULL,
        updated_at    TIMESTAMPTZ DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS entries_updated_at ON entries;
      CREATE TRIGGER entries_updated_at
        BEFORE UPDATE ON entries
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at();

      DROP TRIGGER IF EXISTS settings_updated_at ON settings;
      CREATE TRIGGER settings_updated_at
        BEFORE UPDATE ON settings
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at();
    `);
  } finally {
    await sql.end();
  }
}
