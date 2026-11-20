-- 0007_matching.sql
-- Generated from specs/04-database-schema.md. Never edit after merge; add a new migration.

-- Cached recommendations for one profile. Rebuilt as a whole (delete then insert) by the matching job.
CREATE TABLE match_recommendations (
    profile_id            uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    candidate_profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    compat                smallint NOT NULL CHECK (compat BETWEEN 0 AND 100),   -- shown as "N% match"
    rank_score            real NOT NULL,                                        -- ordering only, never shown
    reasons               text[] NOT NULL DEFAULT '{}',                         -- reason codes, see 10 section 7
    shown_count           smallint NOT NULL DEFAULT 0,
    last_shown_at         timestamptz,
    computed_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, candidate_profile_id)
);
CREATE INDEX match_recommendations_rank_idx ON match_recommendations (profile_id, rank_score DESC);

-- Daily counters used for limits (interests per day and so on).
CREATE TABLE usage_counters (
    profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    counter     text NOT NULL CHECK (counter IN (
                    'interests_sent', 'profiles_viewed', 'photo_requests_sent', 'messages_sent', 'reports_filed')),
    day         date NOT NULL,                                  -- in Asia/Karachi
    count       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, counter, day)
);
