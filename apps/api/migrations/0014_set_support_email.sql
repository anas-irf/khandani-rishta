-- 0014_set_support_email.sql
-- The domain is decided (specs/02-decisions-and-feasibility.md Q-11). Replace the placeholder
-- support address seeded by 0013, unless staff already changed it in the admin console.

UPDATE app_settings
SET value = '"support@khandanirishta.app"', updated_at = now()
WHERE key = 'support.email' AND value = '"support@<domain>"';
