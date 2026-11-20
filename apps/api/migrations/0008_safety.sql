-- 0008_safety.sql
-- Generated from specs/04-database-schema.md. Never edit after merge; add a new migration.

CREATE TABLE reports (
    id                   uuid PRIMARY KEY DEFAULT uuidv7(),
    source               text NOT NULL DEFAULT 'member' CHECK (source IN ('member', 'system')),
    reporter_profile_id  uuid REFERENCES profiles (id),         -- NULL for system-generated reports
    target_profile_id    uuid NOT NULL REFERENCES profiles (id),
    subject_type         text NOT NULL CHECK (subject_type IN ('profile', 'photo', 'message')),
    photo_id             uuid REFERENCES profile_photos (id) ON DELETE SET NULL,
    message_id           uuid REFERENCES messages (id) ON DELETE SET NULL,
    reason               text NOT NULL CHECK (reason IN (
                             'fake_profile', 'already_married', 'misleading_information', 'inappropriate_photo',
                             'harassment', 'asking_for_money', 'marriage_bureau_or_agent', 'underage',
                             'impersonation', 'offensive_content', 'other')),
    details              text CHECK (char_length(details) <= 1000),
    context              jsonb,                                 -- snapshot of the reported content (13 section 6)
    status               text NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'in_review', 'actioned', 'dismissed')),
    resolution_note      text,
    handled_by           uuid REFERENCES users (id),
    handled_at           timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CHECK (reporter_profile_id IS NULL OR reporter_profile_id <> target_profile_id),
    CHECK ((source = 'member') = (reporter_profile_id IS NOT NULL))
);
CREATE INDEX reports_queue_idx ON reports (created_at) WHERE status IN ('open', 'in_review');
CREATE INDEX reports_target_idx ON reports (target_profile_id, created_at DESC);
CREATE INDEX reports_reporter_idx ON reports (reporter_profile_id, created_at DESC);

CREATE TABLE sanctions (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id     uuid NOT NULL REFERENCES users (id),
    type        text NOT NULL CHECK (type IN ('warning', 'suspension', 'ban')),
    reason      text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),   -- shown to the user
    report_id   uuid REFERENCES reports (id),
    starts_at   timestamptz NOT NULL DEFAULT now(),
    ends_at     timestamptz,                                    -- suspension only
    created_by  uuid REFERENCES users (id),                     -- NULL when the system applied it (06 section 8)
    revoked_at  timestamptz,
    revoked_by  uuid REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sanctions_user_idx ON sanctions (user_id, created_at DESC);

-- Hashes of identifiers that may not register again.
CREATE TABLE banned_identities (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    kind        text NOT NULL CHECK (kind IN ('identity_document', 'phone', 'email')),
    value_hash  bytea NOT NULL,                                 -- HMAC-SHA256 with IDENTITY_HASH_PEPPER
    reason      text,
    created_by  uuid REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, value_hash)
);

-- Append-only record of every moderator and admin action.
CREATE TABLE admin_audit_log (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    actor_user_id  uuid NOT NULL REFERENCES users (id),
    action         text NOT NULL,                               -- action codes are listed in 18-admin-console.md
    target_type    text NOT NULL CHECK (target_type IN (
                       'user', 'profile', 'photo', 'verification_request', 'report',
                       'caste', 'caste_suggestion', 'app_setting', 'app_release')),
    target_id      text NOT NULL,                               -- uuid or code, as text
    details        jsonb NOT NULL DEFAULT '{}',
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_target_idx ON admin_audit_log (target_type, target_id, created_at DESC);
CREATE INDEX admin_audit_log_actor_idx ON admin_audit_log (actor_user_id, created_at DESC);

-- Keep updated_at current on every update.
CREATE TRIGGER reports_set_updated_at
    BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
