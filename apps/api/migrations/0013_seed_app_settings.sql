-- 0013_seed_app_settings.sql
-- Defaults of every operational setting (specs/03-domain-model.md section 7).
-- The API also codes these defaults, so a missing row never changes behaviour.

INSERT INTO app_settings (key, value) VALUES
    ('limits.interests_per_day', '10'),
    ('limits.interests_per_day_verified', '20'),
    ('limits.pending_interests_max', '50'),
    ('limits.profile_views_per_day', '150'),
    ('limits.photo_requests_per_day', '10'),
    ('limits.messages_per_minute', '20'),
    ('limits.messages_per_day', '500'),
    ('limits.reports_per_day', '10'),
    ('limits.photos_max', '6'),
    ('limits.saved_searches_max', '10'),
    ('limits.active_connections_max', '30'),
    ('interest.expiry_days', '21'),
    ('interest.cooldown_after_decline_days', '90'),
    ('interest.cooldown_after_expiry_days', '30'),
    ('interest.cooldown_after_withdraw_days', '7'),
    ('connection.cooldown_after_end_days', '90'),
    ('pass.duration_days', '180'),
    ('photo_access.retry_days', '30'),
    ('moderation.profile_review', '"auto"'),
    ('moderation.photo_review', '"manual"'),
    ('moderation.text_review', '"auto"'),
    ('onboarding.identity_required', 'true'),
    ('onboarding.photo_required', 'false'),
    ('matching.candidate_pool_size', '600'),
    ('matching.recommendations_size', '200'),
    ('matching.refresh_hours', '24'),
    ('account.deletion_grace_days', '30'),
    ('verification.media_retention_days', '30'),
    ('legal.terms_version', '"2026-11-20"'),
    ('legal.privacy_version', '"2026-11-20"'),
    ('legal.guidelines_version', '"2026-11-20"'),
    ('support.email', '"support@<domain>"'),
    ('announcement.banner', 'null')
ON CONFLICT (key) DO NOTHING;
