-- 0001_extensions_and_helpers.sql
-- Generated from specs/04-database-schema.md. Never edit after merge; add a new migration.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
