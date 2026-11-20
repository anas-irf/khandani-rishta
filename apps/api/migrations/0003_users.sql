-- 0003_users.sql
-- Generated from specs/04-database-schema.md. Never edit after merge; add a new migration.

CREATE TABLE users (
    id                     uuid PRIMARY KEY DEFAULT uuidv7(),
    clerk_user_id          text NOT NULL UNIQUE,                -- Clerk "user_..." id, the JWT `sub`
    email                  text,
    email_verified         boolean NOT NULL DEFAULT false,
    phone_e164             text,
    phone_verified         boolean NOT NULL DEFAULT false,
    role                   text NOT NULL DEFAULT 'member'
                           CHECK (role IN ('member', 'moderator', 'admin')),
    status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'suspended', 'banned', 'deletion_scheduled', 'deleted')),
    status_reason          text,                                -- shown to the user on the blocked screen
    suspended_until        timestamptz,                         -- only for status = 'suspended'
    locale                 text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ur')),
    timezone               text NOT NULL DEFAULT 'Asia/Karachi',
    last_seen_at           timestamptz,
    deletion_requested_at  timestamptz,
    purge_after            timestamptz,                         -- deletion_requested_at + 30 days; may also be set on a banned user (06 section 9)
    deleted_at             timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (lower(email));
CREATE INDEX users_phone_idx ON users (phone_e164);
CREATE INDEX users_purge_idx ON users (purge_after) WHERE purge_after IS NOT NULL;

-- One row per acceptance of a legal document version.
CREATE TABLE user_consents (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    document     text NOT NULL CHECK (document IN (
                     'terms', 'privacy', 'community_guidelines', 'age_declaration', 'candidate_consent')),
    version      text NOT NULL,                                 -- for example '2026-11-01'
    accepted_at  timestamptz NOT NULL DEFAULT now(),
    ip_address   inet,
    user_agent   text,
    UNIQUE (user_id, document, version)
);

-- Push notification targets.
CREATE TABLE user_devices (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    platform      text NOT NULL CHECK (platform IN ('android', 'web')),
    push_token    text NOT NULL UNIQUE,                         -- FCM registration token
    app_version   text,
    device_model  text,
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_devices_user_idx ON user_devices (user_id);

-- Keep updated_at current on every update.
CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
