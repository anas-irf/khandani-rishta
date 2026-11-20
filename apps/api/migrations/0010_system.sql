-- 0010_system.sql
-- Generated from specs/04-database-schema.md. Never edit after merge; add a new migration.

-- Background job queue, claimed with FOR UPDATE SKIP LOCKED (see 19-jobs-and-realtime.md).
CREATE TABLE jobs (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    kind          text NOT NULL,                                -- job kinds are listed in 19 section 2
    payload       jsonb NOT NULL DEFAULT '{}',
    status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'succeeded', 'dead')),   -- a failed attempt goes back to queued, or to dead after max_attempts
    run_at        timestamptz NOT NULL DEFAULT now(),
    attempts      smallint NOT NULL DEFAULT 0,
    max_attempts  smallint NOT NULL DEFAULT 5,
    dedupe_key    text,                                         -- optional: at most one queued job per key
    locked_at     timestamptz,
    last_error    text,
    finished_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim_idx ON jobs (run_at) WHERE status = 'queued';
CREATE UNIQUE INDEX jobs_dedupe_idx ON jobs (kind, dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL;

-- Clerk webhook deliveries already handled (idempotency).
CREATE TABLE webhook_events (
    id            text PRIMARY KEY,                             -- the `svix-id` header
    source        text NOT NULL CHECK (source IN ('clerk')),
    event_type    text NOT NULL,
    received_at   timestamptz NOT NULL DEFAULT now()
);

-- Operational settings that admins can change without a deploy. Keys and defaults: 03 section 7.
CREATE TABLE app_settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_by  uuid REFERENCES users (id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Published Android builds, used by the in-app update prompt.
CREATE TABLE app_releases (
    id                          uuid PRIMARY KEY DEFAULT uuidv7(),
    platform                    text NOT NULL CHECK (platform IN ('android')),
    version_code                integer NOT NULL,
    version_name                text NOT NULL,
    min_supported_version_code  integer NOT NULL,               -- older builds must update before continuing
    download_url                text NOT NULL,
    release_notes               text,
    released_at                 timestamptz NOT NULL DEFAULT now(),
    UNIQUE (platform, version_code)
);

-- "Download my data" requests.
CREATE TABLE data_exports (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'failed', 'expired')),
    file_key      text,                                         -- R2 key of the JSON archive
    expires_at    timestamptz,                                  -- ready_at + 7 days
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX data_exports_user_idx ON data_exports (user_id, created_at DESC);

-- Keep updated_at current on every update.
CREATE TRIGGER app_settings_set_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER data_exports_set_updated_at
    BEFORE UPDATE ON data_exports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
