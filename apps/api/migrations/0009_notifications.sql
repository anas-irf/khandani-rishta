-- 0009_notifications.sql
-- Generated from specs/04-database-schema.md. Never edit after merge; add a new migration.

-- In-app notification feed. The client renders the text from `type` and `data`.
CREATE TABLE notifications (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type              text NOT NULL CHECK (type IN (
                          'interest_received', 'interest_accepted',
                          'photo_request_received', 'photo_request_granted',
                          'contact_shared', 'stage_proposed', 'stage_confirmed',
                          'profile_approved', 'profile_changes_requested',
                          'photo_approved', 'photo_rejected', 'text_rejected',
                          'verification_approved', 'verification_rejected',
                          'new_matches', 'profile_views_summary',
                          'account_warning', 'announcement')),
    actor_profile_id  uuid REFERENCES profiles (id) ON DELETE CASCADE,   -- who caused it, if a member
    data              jsonb NOT NULL DEFAULT '{}',              -- shape per type in 14-notifications.md
    read_at           timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_feed_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
    user_id              uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    push_interests       boolean NOT NULL DEFAULT true,
    push_messages        boolean NOT NULL DEFAULT true,
    push_photo_requests  boolean NOT NULL DEFAULT true,
    push_profile_views   boolean NOT NULL DEFAULT false,
    push_matches         boolean NOT NULL DEFAULT true,
    email_interests      boolean NOT NULL DEFAULT true,
    email_messages       boolean NOT NULL DEFAULT false,
    email_match_digest   text NOT NULL DEFAULT 'weekly' CHECK (email_match_digest IN ('off', 'daily', 'weekly')),
    email_announcements  boolean NOT NULL DEFAULT true,
    quiet_hours_start    time,                                  -- in users.timezone; NULL: no quiet hours
    quiet_hours_end      time,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL))
);

-- Keep updated_at current on every update.
CREATE TRIGGER notification_preferences_set_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
