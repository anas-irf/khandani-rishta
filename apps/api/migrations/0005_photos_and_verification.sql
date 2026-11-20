-- 0005_photos_and_verification.sql
-- Generated from specs/04-database-schema.md. Never edit after merge; add a new migration.

CREATE TABLE profile_photos (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    profile_id        uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    status            text NOT NULL DEFAULT 'processing'
                      CHECK (status IN ('processing', 'pending_review', 'approved', 'rejected', 'failed')),
    rejection_reason  text CHECK (rejection_reason IN (
                          'not_a_person', 'face_not_visible', 'group_photo', 'inappropriate',
                          'contains_contact_info', 'low_quality', 'not_the_candidate', 'other')),
    position          smallint NOT NULL DEFAULT 0,              -- display order, 0 first
    is_primary        boolean NOT NULL DEFAULT false,
    upload_key        text NOT NULL,                            -- temporary R2 object written by the client
    key_large         text,                                     -- R2 keys of the processed variants
    key_medium        text,
    key_thumb         text,
    key_blur_medium   text,
    key_blur_thumb    text,
    width             integer,
    height            integer,
    moderation        jsonb,                                    -- raw result of the automated check
    reviewed_by       uuid REFERENCES users (id),
    reviewed_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_photos_profile_idx ON profile_photos (profile_id, position);
CREATE UNIQUE INDEX profile_photos_one_primary_idx ON profile_photos (profile_id) WHERE is_primary;
CREATE INDEX profile_photos_review_idx ON profile_photos (created_at) WHERE status = 'pending_review';

-- Per-viewer permission to see photos, used when photo_visibility = 'approved_only'
-- and for explicit requests under the other restricted modes.
CREATE TABLE photo_access (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    owner_profile_id   uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    viewer_profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'granted', 'denied', 'revoked')),
    decided_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_profile_id, viewer_profile_id),
    CHECK (owner_profile_id <> viewer_profile_id)
);
CREATE INDEX photo_access_viewer_idx ON photo_access (viewer_profile_id, status);
CREATE INDEX photo_access_owner_pending_idx ON photo_access (owner_profile_id, created_at DESC) WHERE status = 'pending';

-- A request for a moderator to verify identity documents or a live selfie.
CREATE TABLE verification_requests (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    profile_id         uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    kind               text NOT NULL CHECK (kind IN ('id_document', 'selfie')),
    status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    front_key          text,                                    -- id_document: front of the card
    back_key           text,                                    -- id_document: back of the card
    selfie_key         text,                                    -- both kinds: live selfie
    gesture            text CHECK (gesture IN ('peace_sign', 'thumbs_up', 'open_palm', 'hand_on_head')),
    rejection_reason   text CHECK (rejection_reason IN (
                           'unreadable', 'document_mismatch', 'face_mismatch', 'gesture_missing',
                           'expired_document', 'underage', 'suspected_fraud', 'other')),
    reviewer_note      text,
    reviewed_by        uuid REFERENCES users (id),
    reviewed_at        timestamptz,
    media_purge_after  timestamptz,                             -- images are deleted from R2 after this time
    media_purged_at    timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_requests_profile_idx ON verification_requests (profile_id, created_at DESC);
CREATE INDEX verification_requests_queue_idx ON verification_requests (created_at) WHERE status = 'pending';
CREATE UNIQUE INDEX verification_requests_one_pending_idx
    ON verification_requests (profile_id, kind) WHERE status = 'pending';
CREATE INDEX verification_requests_purge_idx
    ON verification_requests (media_purge_after) WHERE media_purged_at IS NULL;

-- Keep updated_at current on every update.
CREATE TRIGGER profile_photos_set_updated_at
    BEFORE UPDATE ON profile_photos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER photo_access_set_updated_at
    BEFORE UPDATE ON photo_access
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER verification_requests_set_updated_at
    BEFORE UPDATE ON verification_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
