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

      CREATE OR REPLACE FUNCTION notify_entry_change()
      RETURNS TRIGGER AS $$
      DECLARE
        event_type TEXT;
        payload JSONB;
      BEGIN
        -- Determine event type
        -- NOTE: pg_notify payload limited to ~8000 bytes. Keep payload minimal.
        IF TG_OP = 'INSERT' THEN
          event_type := 'entry:created';
        ELSIF NEW.deleted_at IS NOT NULL AND (OLD.deleted_at IS NULL) THEN
          event_type := 'entry:deleted';
        ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
          event_type := 'entry:created';
        ELSE
          -- Skip if only embedding or updated_at changed
          IF NEW.name = OLD.name
             AND NEW.category IS NOT DISTINCT FROM OLD.category
             AND NEW.confidence IS NOT DISTINCT FROM OLD.confidence
             AND NEW.fields = OLD.fields
             AND NEW.tags = OLD.tags
             AND NEW.content IS NOT DISTINCT FROM OLD.content
             AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
            RETURN NEW;
          END IF;
          event_type := 'entry:updated';
        END IF;

        -- Build payload
        IF event_type = 'entry:deleted' THEN
          payload := jsonb_build_object('type', event_type, 'data', jsonb_build_object('id', NEW.id));
        ELSE
          payload := jsonb_build_object(
            'type', event_type,
            'data', jsonb_build_object(
              'id', NEW.id,
              'name', NEW.name,
              'category', NEW.category,
              'confidence', NEW.confidence
            )
          );
        END IF;

        PERFORM pg_notify('entries_changed', payload::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS entries_notify ON entries;
      CREATE TRIGGER entries_notify
        AFTER INSERT OR UPDATE ON entries
        FOR EACH ROW
        EXECUTE FUNCTION notify_entry_change();

      CREATE TABLE IF NOT EXISTS digests (
        type          TEXT PRIMARY KEY,
        content       TEXT NOT NULL,
        generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      ALTER TABLE entries ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS google_calendar_target TEXT;

      CREATE TABLE IF NOT EXISTS "user" (
        id             INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash  TEXT NOT NULL,
        display_name   TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } finally {
    await sql.end();
  }
}
