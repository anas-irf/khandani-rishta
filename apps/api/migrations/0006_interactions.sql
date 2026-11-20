-- 0006_interactions.sql
-- Generated from specs/04-database-schema.md. Never edit after merge; add a new migration.

CREATE TABLE interests (
    id                   uuid PRIMARY KEY DEFAULT uuidv7(),
    sender_profile_id    uuid NOT NULL REFERENCES profiles (id),
    receiver_profile_id  uuid NOT NULL REFERENCES profiles (id),
    status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
    message              text CHECK (char_length(message) <= 300),
    compat_score         smallint CHECK (compat_score BETWEEN 0 AND 100),   -- snapshot at send time
    seen_at              timestamptz,                           -- receiver opened it
    responded_at         timestamptz,
    expires_at           timestamptz NOT NULL,                  -- created_at + 21 days; set to now() when expired early (03 section 4.7)
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CHECK (sender_profile_id <> receiver_profile_id)
);
CREATE UNIQUE INDEX interests_one_pending_idx
    ON interests (sender_profile_id, receiver_profile_id) WHERE status = 'pending';
CREATE INDEX interests_received_idx ON interests (receiver_profile_id, status, created_at DESC);
CREATE INDEX interests_sent_idx ON interests (sender_profile_id, status, created_at DESC);
CREATE INDEX interests_expiry_idx ON interests (expires_at) WHERE status = 'pending';

CREATE TABLE connections (
    id                   uuid PRIMARY KEY DEFAULT uuidv7(),
    profile_low_id       uuid NOT NULL REFERENCES profiles (id),
    profile_high_id      uuid NOT NULL REFERENCES profiles (id),
    interest_id          uuid NOT NULL REFERENCES interests (id),
    status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    stage                text NOT NULL DEFAULT 'chatting'
                         CHECK (stage IN ('chatting', 'families_talking', 'engaged', 'nikah_done')),
    stage_updated_at     timestamptz NOT NULL DEFAULT now(),
    ended_by_profile_id  uuid REFERENCES profiles (id),
    ended_reason         text CHECK (ended_reason IN (
                             'not_compatible', 'family_declined', 'no_response', 'found_someone_else',
                             'inappropriate_behaviour', 'blocked', 'account_closed', 'other')),
    ended_at             timestamptz,
    last_message_at      timestamptz,
    last_message_preview text,                                  -- first 80 characters, for the chat list
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CHECK (profile_low_id < profile_high_id)
);
CREATE UNIQUE INDEX connections_one_active_idx
    ON connections (profile_low_id, profile_high_id) WHERE status = 'active';

-- Per-member state of a connection. Two rows per connection.
CREATE TABLE connection_members (
    connection_id         uuid NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
    profile_id            uuid NOT NULL REFERENCES profiles (id),
    last_read_message_id  uuid,
    last_read_at          timestamptz,
    unread_count          integer NOT NULL DEFAULT 0,
    is_muted              boolean NOT NULL DEFAULT false,
    is_archived           boolean NOT NULL DEFAULT false,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (connection_id, profile_id)
);
CREATE INDEX connection_members_profile_idx ON connection_members (profile_id);

CREATE TABLE messages (
    id                 uuid PRIMARY KEY,                        -- UUIDv7 from the API, so ids sort by time
    connection_id      uuid NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
    sender_profile_id  uuid REFERENCES profiles (id),           -- NULL for system messages
    kind               text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system')),
    body               text CHECK (char_length(body) <= 2000),
    system_event       text CHECK (system_event IN (
                           'connected', 'contact_shared', 'contact_share_revoked',
                           'stage_proposed', 'stage_confirmed', 'stage_declined', 'connection_ended')),
    system_data        jsonb,
    client_message_id  text CHECK (char_length(client_message_id) <= 64),   -- idempotency key from the client
    safety_flag        text CHECK (safety_flag IN ('money', 'off_platform', 'contact_info')),   -- matched a safety pattern (13 section 5)
    deleted_at         timestamptz,                             -- sender removed it; body is cleared
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT messages_kind_shape CHECK (
        (kind = 'text' AND sender_profile_id IS NOT NULL AND system_event IS NULL)
        OR (kind = 'system' AND system_event IS NOT NULL)
    )
);
CREATE INDEX messages_connection_idx ON messages (connection_id, id DESC);
CREATE UNIQUE INDEX messages_idempotency_idx
    ON messages (connection_id, sender_profile_id, client_message_id) WHERE client_message_id IS NOT NULL;

CREATE TABLE connection_stage_proposals (
    id                      uuid PRIMARY KEY DEFAULT uuidv7(),
    connection_id           uuid NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
    proposed_by_profile_id  uuid NOT NULL REFERENCES profiles (id),
    stage                   text NOT NULL CHECK (stage IN ('families_talking', 'engaged', 'nikah_done')),
    status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
    responded_at            timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX connection_stage_proposals_one_pending_idx
    ON connection_stage_proposals (connection_id) WHERE status = 'pending';

CREATE TABLE contact_shares (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    connection_id      uuid NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
    sharer_profile_id  uuid NOT NULL REFERENCES profiles (id),
    share_phone        boolean NOT NULL DEFAULT false,
    share_whatsapp     boolean NOT NULL DEFAULT false,
    share_email        boolean NOT NULL DEFAULT false,
    share_guardian     boolean NOT NULL DEFAULT false,
    status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    revoked_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (connection_id, sharer_profile_id),
    CHECK (share_phone OR share_whatsapp OR share_email OR share_guardian)
);

-- Private bookmarks. The target is never told.
CREATE TABLE shortlists (
    profile_id         uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    target_profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    note               text CHECK (char_length(note) <= 300),
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, target_profile_id),
    CHECK (profile_id <> target_profile_id)
);
CREATE INDEX shortlists_list_idx ON shortlists (profile_id, created_at DESC);

-- "Not interested": hides the target from the member's recommendations and searches.
CREATE TABLE passes (
    profile_id         uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    target_profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    expires_at         timestamptz NOT NULL,                    -- created_at + 180 days
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, target_profile_id),
    CHECK (profile_id <> target_profile_id)
);

-- Blocks hide both profiles from each other everywhere.
CREATE TABLE blocks (
    blocker_profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    blocked_profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_profile_id, blocked_profile_id),
    CHECK (blocker_profile_id <> blocked_profile_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_profile_id);

-- One row per viewer, viewed profile and day.
CREATE TABLE profile_views (
    viewer_profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    viewed_profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    viewed_on          date NOT NULL,
    view_count         integer NOT NULL DEFAULT 1,
    is_private         boolean NOT NULL DEFAULT false,          -- viewer had record_my_visits = false
    last_viewed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (viewer_profile_id, viewed_profile_id, viewed_on)
);
CREATE INDEX profile_views_viewed_idx ON profile_views (viewed_profile_id, last_viewed_at DESC) WHERE NOT is_private;
CREATE INDEX profile_views_viewer_idx ON profile_views (viewer_profile_id, last_viewed_at DESC);

CREATE TABLE saved_searches (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    profile_id        uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    filters           jsonb NOT NULL,                           -- the SearchFilters object from 15-api-contract.md
    notify_new        boolean NOT NULL DEFAULT false,
    last_notified_at  timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_searches_profile_idx ON saved_searches (profile_id);

-- Keep updated_at current on every update.
CREATE TRIGGER interests_set_updated_at
    BEFORE UPDATE ON interests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER connections_set_updated_at
    BEFORE UPDATE ON connections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER connection_members_set_updated_at
    BEFORE UPDATE ON connection_members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER connection_stage_proposals_set_updated_at
    BEFORE UPDATE ON connection_stage_proposals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER contact_shares_set_updated_at
    BEFORE UPDATE ON contact_shares
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER saved_searches_set_updated_at
    BEFORE UPDATE ON saved_searches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
