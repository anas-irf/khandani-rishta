# 18. Admin Console

| | |
|---|---|
| Status | Design complete, not implemented |
| Related | [15-api-contract.md](15-api-contract.md) section 16 for the routes, [13-safety-and-moderation.md](13-safety-and-moderation.md) for the rules moderators apply, [12-verification-and-trust.md](12-verification-and-trust.md) for verification checklists, [06-auth-and-accounts.md](06-auth-and-accounts.md) section 8 for sanctions, [03-domain-model.md](03-domain-model.md) section 7 for settings, [17-web-app.md](17-web-app.md) for routing |

The admin console is where staff review profiles, photos, text, verification requests and reports, apply sanctions, and maintain reference data and settings. This document defines its screens, the response shapes of the admin routes, and the audit trail.

## 1. Scope and roles

### 1.1 Scope

1. The console is part of the web app (`apps/web`), in its own lazily loaded route group. There is no separate site and no separate login.
2. It does not exist in the Android app.
3. Staff sign in like any member. The console's entry link appears in the account menu only when `Me.user.role` is `moderator` or `admin`.
4. Hiding the link is a convenience. Every admin route is protected by the `moderator` or `admin` access level in the API (15 section 3).
5. English only. Desktop layout only (minimum width 1,024 pixels); no mobile layout is required.
6. A staff user may also have an ordinary profile. Staff actions are always taken as the user, never as the profile.

### 1.2 What each role may do

| Capability | Moderator | Admin |
|---|---|---|
| See the overview and all five queues | Yes | Yes |
| Approve or request changes on a profile | Yes | Yes |
| Approve or reject photos and text | Yes | Yes |
| Review verification requests (sees identity images and the decrypted number) | Yes | Yes |
| Claim and resolve reports | Yes | Yes |
| Search users and view an account | Yes, without contact details | Yes, with contact details |
| Warn, suspend, lift a suspension | Yes | Yes |
| Ban, lift a ban | No | Yes |
| Change roles | No | Yes |
| Correct locked fields (name, gender, date of birth) | No | Yes |
| Reject a caste suggestion | Yes | Yes |
| Promote a suggestion, add or edit castes | No | Yes |
| Settings, releases, announcements | No | Yes |
| Read the audit log | No | Yes |

Staff never see chat messages except the excerpt attached to a report (13 section 6.3).

## 2. First admin setup

There is no screen for creating the first admin. It is done once per environment, directly in the database.

1. The product owner signs in to the web app of that environment once, so that their `users` row exists (06 section 5).
2. Connect to the environment's database with `psql` and run, replacing the email address:

```sql
BEGIN;

UPDATE users
SET role = 'admin'
WHERE lower(email) = lower('owner@example.com')
  AND status = 'active'
RETURNING id, email, role;
-- Expect exactly one row. If zero or more than one row is returned: ROLLBACK and investigate.

INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, details)
SELECT id, 'user.role_change', 'user', id::text,
       '{"from": "member", "to": "admin", "note": "first admin, set by SQL"}'::jsonb
FROM users
WHERE lower(email) = lower('owner@example.com');

COMMIT;
```

3. Wait 30 seconds (the account snapshot cache, 06 section 6.3) or restart the API, then reload the web app. The "Admin" entry appears in the account menu.

From then on, roles change only through `PATCH /v1/admin/users/{user_id}/role`. Rules enforced by that route:

| Rule | Error |
|---|---|
| An admin cannot change their own role | `403 forbidden` |
| The target user must be `active` | `409 invalid_state` |
| Nothing else is needed to guarantee one admin remains: since nobody can demote themselves, the last admin cannot be removed | |

Keep at least two admins once the team allows it, so that one can act when the other is unavailable.

## 3. Navigation and screens

A fixed left sidebar with a count badge on each queue (from `GET /v1/admin/overview`, refreshed every 60 seconds).

| ID | Sidebar label | Role | Purpose |
|---|---|---|---|
| `ADM-HOME` | Overview | Moderator | Queue sizes and headline numbers |
| `ADM-PROFILES` | Profiles | Moderator | Profile review queue and profile search |
| `ADM-PROFILE` | (opened from lists) | Moderator | One profile in full |
| `ADM-PHOTOS` | Photos | Moderator | Photo review queue |
| `ADM-TEXTS` | Text | Moderator | Free text review queue |
| `ADM-VERIFICATIONS` | Verification | Moderator | Verification request queue |
| `ADM-VERIFICATION` | (opened from the queue) | Moderator | One verification request |
| `ADM-REPORTS` | Reports | Moderator | Report queue |
| `ADM-REPORT` | (opened from the queue) | Moderator | One report |
| `ADM-USERS` | Users | Moderator | User search |
| `ADM-USER` | (opened from lists) | Moderator | One account: sanctions, devices, history |
| `ADM-CASTES` | Castes | Moderator (promotion: admin) | Caste suggestions and the caste list |
| `ADM-SETTINGS` | Settings | Admin | `app_settings` |
| `ADM-RELEASES` | Releases | Admin | Android release records |
| `ADM-ANNOUNCE` | Announcements | Admin | Send an announcement |
| `ADM-AUDIT` | Audit log | Admin | Who did what |

Admin-only entries are not rendered for moderators.

Conventions for every list screen: cursor pagination with "Load more"; the newest request wins when filters change; an empty queue shows "Nothing waiting. Well done."; every action button is disabled while its request is in flight; after an action the item leaves the list without a full reload.

Keyboard shortcuts work when no text field has focus. `J` and `K` move to the next and previous item on every queue screen. `?` shows the shortcut list.

## 4. Queues

### 4.1 Profile review (`ADM-PROFILES`, `ADM-PROFILE`)

**List.** `GET /v1/admin/profiles?status=pending_review`, ordered by `onboarding_completed_at` ascending (longest waiting first). The same screen has a status filter (any `profiles.status`) and a search box `q` (profile code, first or last name) for looking up any profile.

```ts
type AdminProfileListItem = {
  profile_id: string
  user_id: string
  public_code: string
  status: string
  first_name: string | null
  last_name: string | null
  gender: 'male' | 'female' | null
  age: number | null
  city_name: string | null
  managed_by: string | null
  onboarding_completed_at: string | null
  photo_thumb_url: string | null       // first photo of any status, unblurred
  open_system_reports: number
  created_at: string
}
```

**Detail.** `GET /v1/admin/profiles/{profile_id}`.

```ts
type AdminProfile = {
  user: {
    id: string
    email: string | null
    email_verified: boolean
    phone_e164: string | null          // null for moderators
    role: string
    status: string
    status_reason: string | null
    suspended_until: string | null
    created_at: string
    last_seen_at: string | null
  }
  profile: OwnProfile                  // 15 section 4.3. `contacts` is null for moderators.
  preferences: Preferences | null
  privacy: Privacy
  first_activated_at: string | null
  last_active_at: string | null
  stats: {
    interests_sent: number
    interests_received: number
    interests_accepted_by_others: number   // sent interests that were accepted
    active_connections: number
    connections_ended_by_others: number
    money_flags_30d: number                // messages with safety_flag = 'money' sent in 30 days
    blocks_received: number
  }
  reports_against: AdminReportListItem[]   // newest 10
  reports_filed: { total: number; actioned: number; dismissed: number }
  sanctions: {
    id: string; type: string; reason: string; starts_at: string; ends_at: string | null
    revoked_at: string | null; created_by_email: string | null
  }[]
  verification_requests: {
    id: string; kind: string; status: string; rejection_reason: string | null
    created_at: string; reviewed_at: string | null
  }[]
  audit: AuditEntry[]                      // newest 20 entries whose target is this profile or its user
}
```

Photo URLs inside `profile.photos` are signed URLs of the unblurred variants, whatever the member's privacy settings.

**What the moderator checks**, in order:

| # | Check | If it fails |
|---|---|---|
| 1 | The profile is for one real marriage candidate, not a business, a joke or a test | Request changes, or for a bureau open `ADM-USER` and ask an admin to ban (13 section 8) |
| 2 | Names look like real names in a plausible spelling | Request changes: "Please enter the candidate's real name." |
| 3 | The candidate is 18 or older and the age is plausible against the photos | Suspend and escalate to an admin (13 section 7.2) |
| 4 | `managed_by` and `manager_name` make sense together | Request changes |
| 5 | Each photo follows 13 section 4.3 | Reject the photo on the spot (4.2). A profile can be approved with zero approved photos unless `onboarding.photo_required` is true. |
| 6 | `about_me`, `about_family` and partner notes are suitable | Reject the text on the spot (4.3) |
| 7 | Short free-text fields (job title, employer, institute, occupations) hold what they should | Request changes naming the field |
| 8 | No open `system` report points to a returning banned user (13 section 9) | Open the report, compare with the previous account, then decide |

**Actions.**

| Action | Shortcut | Route | Effects |
|---|---|---|---|
| Approve | `A` | `POST /v1/admin/profiles/{profile_id}/approve` | `pending_review` to `active`; `first_activated_at` set if null; `status_reason` cleared; `match_stale = true`; enqueue `refresh_recommendations`; notification `profile_approved` and its email; audit `profile.approve` |
| Request changes | `C` | `POST /v1/admin/profiles/{profile_id}/request-changes` with `{ "reason": string }` (10 to 500 characters) | `pending_review` to `changes_requested`; `status_reason = reason`; notification `profile_changes_requested` and its email; audit `profile.request_changes` |
| Open the account | `U` | Navigation to `ADM-USER` | |

Both routes answer `409 invalid_state` when the profile is not `pending_review`.

The reason box offers presets that the moderator may edit. The text is shown to the member on `GATE-CHANGES`, so it is written for them:

| Preset |
|---|
| Please enter the candidate's real first and last name. |
| Please add at least one clear photo of the candidate. |
| Some details look inconsistent (age, education or job). Please review and correct them. |
| Please remove contact details and links from the profile text. |
| This profile appears to be for more than one person. Each profile must be for one candidate. |

### 4.2 Photo review (`ADM-PHOTOS`)

**List.** `GET /v1/admin/photos?status=pending_review`. Order: photos whose automatic check result is `flag` first, then by `created_at` ascending.

```ts
type AdminPhotoItem = {
  photo_id: string
  profile_id: string
  public_code: string
  first_name: string | null
  gender: 'male' | 'female' | null
  age: number | null
  status: string
  created_at: string
  large_url: string                    // unblurred, signed
  moderation: object | null            // profile_photos.moderation (13 section 4.2)
  would_be_primary: boolean            // the profile has no approved photo yet
  profile_is_photo_verified: boolean
  other_photos: { photo_id: string; status: string; is_primary: boolean; medium_url: string }[]
}
```

The screen shows one photo large, with the profile's other photos beside it for comparison, the automatic scores, and a banner "First photo of this profile" when `would_be_primary` is true or "Photo-verified profile: must be the same person" when `profile_is_photo_verified` is true.

**Checklist:** 13 section 4.3, first matching row.

**Actions.**

| Action | Shortcut | Route | Effects |
|---|---|---|---|
| Approve | `A` | `POST /v1/admin/photos/{photo_id}/approve` | `status = 'approved'`, `reviewed_by`, `reviewed_at`; if the profile has no primary photo this one becomes primary and `has_approved_photo = true`; recompute completeness; `match_stale = true`; notification `photo_approved`; audit `photo.approve` |
| Reject | `1` to `8` for the eight reasons in the order of 05 section 2.43 | `POST /v1/admin/photos/{photo_id}/reject` with `{ "reason": string }` | `status = 'rejected'`, `rejection_reason`, `reviewed_by`, `reviewed_at`; if it was primary (only possible when rejecting an already approved photo from a report) promote the next approved photo; notification `photo_rejected`; audit `photo.reject` |

Both routes accept a photo in `pending_review` or `approved` (so a reported, already approved photo can be removed). Any other status answers `409 invalid_state`.

### 4.3 Text review (`ADM-TEXTS`)

**List.** `GET /v1/admin/texts`. Returns moderated texts with status `pending` that are waiting for a person, which means: no `moderate_text` job for that profile and field is `queued` or `running` (the job's `dedupe_key` is `<profile_id>:<field>`). Ordered by the owning row's `updated_at` ascending.

```ts
type AdminTextItem = {
  profile_id: string
  public_code: string
  first_name: string | null
  gender: 'male' | 'female' | null
  field: 'about_me' | 'about_family' | 'partner_notes'
  text: string
  text_sha256: string                  // hex; must be sent back with the decision
  updated_at: string
}
```

`partner_notes` is `partner_preferences.notes` with `notes_status`.

**Checklist.** Approve unless the text: contains contact details or links that slipped past the validators; is abusive, hateful or sexual; advertises a service; is about someone other than the candidate and family; is nonsense or copied filler. Text about self-harm or distress is never just rejected: approve or reject on the content rules, and tell an admin so that someone can reach out by email.

**Actions.**

| Action | Shortcut | Route and body | Effects |
|---|---|---|---|
| Approve | `A` | `POST /v1/admin/texts/{profile_id}/{field}/approve` with `{ "text_sha256": string }` | Status `approved`; `match_stale = true`; no notification; audit `text.approve` |
| Reject | `R` | `POST /v1/admin/texts/{profile_id}/{field}/reject` with `{ "text_sha256": string, "note"?: string }` | Status `rejected`; notification `text_rejected` with `data.field` and `data.note`; audit `text.reject` |

Rules:

1. `text_sha256` guards against deciding on text the moderator did not read. If the stored text's hash differs, or the status is no longer `pending`, the route answers `409 invalid_state` and the screen reloads the item.
2. `note` (up to 300 characters) is shown to the member. The input is labelled "Note to the member (they will see this)". Presets: "Please remove contact details.", "Please keep the wording respectful.", "Please write about the candidate and the family only."

### 4.4 Verification review (`ADM-VERIFICATIONS`, `ADM-VERIFICATION`)

**List.** `GET /v1/admin/verifications?status=pending`, optional `kind`. Ordered by `created_at` ascending.

```ts
type AdminVerificationListItem = {
  request_id: string
  kind: 'id_document' | 'selfie'
  status: string
  profile_id: string
  public_code: string
  first_name: string | null
  created_at: string
}
```

**Detail.** `GET /v1/admin/verifications/{request_id}`. Every call writes an audit entry `verification.view`, including calls for requests already decided.

```ts
type AdminVerificationDetail = {
  request_id: string
  kind: 'id_document' | 'selfie'
  status: string
  gesture: string
  gesture_valid: boolean               // the gesture equals the challenge of the submission day or the day before
  created_at: string
  images: {
    front_url: string | null           // signed, valid 10 minutes; null when not provided or already purged
    back_url: string | null
    selfie_url: string | null
  }
  media_purged: boolean
  identity: {
    document_type: string
    number: string                     // decrypted, formatted #####-#######-# for 13-digit types
    status: string
  } | null                             // null for kind = 'selfie'
  profile: {
    profile_id: string
    public_code: string
    first_name: string | null
    last_name: string | null
    gender: 'male' | 'female' | null
    date_of_birth: string | null
    age: number | null
    marital_status: string | null
    managed_by: string | null
    manager_name: string | null
    photos: { photo_id: string; status: string; is_primary: boolean; large_url: string }[]   // approved photos
  }
  previous_requests: { id: string; kind: string; status: string; rejection_reason: string | null; created_at: string }[]
}
```

The screen lays the images on the left and the profile data on the right, with the checklist between them as tick boxes: 12 section 5.3 for `id_document`, 12 section 4.4 for `selfie`. Images can be zoomed and rotated in the browser. They are never downloaded to disk by the app, and the browser's cache is bypassed with `Cache-Control: no-store` on the signed responses where the storage allows it.

**Actions.**

| Action | Shortcut | Route and body | Effects |
|---|---|---|---|
| Approve | `A` | `POST /v1/admin/verifications/{request_id}/approve` with `{ "photos_match"?: boolean }` | 12 section 5.4 (`id_document`) or 4.5 (`selfie`). `photos_match: true` on an `id_document` request also sets `is_photo_verified`. Audit `verification.approve`. |
| Reject | `R` | `POST /v1/admin/verifications/{request_id}/reject` with `{ "reason": string, "note"?: string }` | 12 section 5.4 or 4.5. `reason` is a `verification_rejection_reason`. `note` is stored in `reviewer_note` and is for staff only. Audit `verification.reject`. |

Both answer `409 invalid_state` unless the request is `pending`. The approve button stays disabled until every checklist box is ticked. On an `underage` rejection the screen offers "Suspend this account now", which opens the suspension dialog of section 5.3 with the reason prefilled.

### 4.5 Reports (`ADM-REPORTS`, `ADM-REPORT`)

**List.** `GET /v1/admin/reports?status=open` (also `in_review`, `actioned`, `dismissed`). Order: priority (13 section 6.5), then `created_at` ascending.

```ts
type AdminReportListItem = {
  report_id: string
  source: 'member' | 'system'
  priority: 1 | 2 | 3
  reason: string
  subject_type: 'profile' | 'photo' | 'message'
  status: string
  target: { profile_id: string; user_id: string; public_code: string; first_name: string | null }
  reporter: { profile_id: string; public_code: string; first_name: string | null } | null
  open_reports_on_target: number
  handled_by_email: string | null
  created_at: string
}
```

**Detail.** `GET /v1/admin/reports/{report_id}`.

```ts
type AdminReportDetail = AdminReportListItem & {
  details: string | null
  context: object | null               // 13 section 6.3 and 5.5
  photo: { photo_id: string; status: string; large_url: string | null } | null   // for subject_type = 'photo'
  resolution_note: string | null
  handled_at: string | null
  target_summary: {
    user_status: string
    profile_status: string
    reports_against_total: number
    reports_against_actioned: number
    sanctions: { type: string; reason: string; starts_at: string; ends_at: string | null; revoked_at: string | null }[]
    is_id_verified: boolean
    is_photo_verified: boolean
  }
  reporter_summary: { filed: number; actioned: number; dismissed: number } | null
  related_reports: AdminReportListItem[]   // other open or in-review reports on the same target
}
```

For a message report the context is rendered as a small chat transcript with the reported message highlighted and each sender labelled "Reporter" or "Reported member".

**Workflow.**

| Step | Action | Shortcut | Route | Effects |
|---|---|---|---|---|
| 1 | Claim | `C` | `POST /v1/admin/reports/{report_id}/claim` | `open` to `in_review`; `handled_by` = the moderator; audit `report.claim`. Answers `409 invalid_state` if not `open` (someone else claimed it). |
| 2 | Investigate | | Open `ADM-PROFILE` or `ADM-USER` of the target; read related reports | |
| 3a | Remove content | | The photo reject route (4.2) or the text reject route (4.3) | As described there |
| 3b | Sanction | `S` | One of the user routes of section 5.3 with `report_id` set | The sanction is linked to the report |
| 4 | Resolve | `X` | `POST /v1/admin/reports/{report_id}/resolve` with `{ "outcome": "actioned" \| "dismissed", "note": string }` | Status set; `resolution_note`, `handled_by`, `handled_at`; audit `report.resolve` |

Rules:

1. `note` is required (10 to 1,000 characters) and is for staff only.
2. `resolve` is allowed from `in_review`, and from `open` only with `outcome = 'dismissed'` (bulk dismissal of duplicates).
3. Choosing `actioned` without having removed content or applied a sanction is allowed but shows a confirmation: "No action is recorded for this report. Resolve as actioned anyway?"
4. When one report on a target is resolved as `actioned`, the screen offers to resolve the related open reports with the same note.
5. The reporter is not notified (13 section 6.4). The target is notified only through the sanction or content removal itself.

## 5. Users and sanctions

### 5.1 Search (`ADM-USERS`)

`GET /v1/admin/users?q=...`. `q` (at least 3 characters) matches, case-insensitively: the exact email; the phone number (digits only, suffix match of at least 7 digits); the exact profile code; a prefix of the first or last name. Optional filters: `status`, `role`.

```ts
type AdminUserListItem = {
  user_id: string
  profile_id: string
  public_code: string
  email: string | null
  role: string
  status: string
  profile_status: string
  first_name: string | null
  last_name: string | null
  gender: 'male' | 'female' | null
  created_at: string
  last_seen_at: string | null
}
```

Searching by identity number is not offered. To find the profile holding a number (a support case), an admin asks the member for their profile code or email.

### 5.2 Account view (`ADM-USER`)

`GET /v1/admin/users/{user_id}`.

```ts
type AdminUser = AdminUserListItem & {
  email_verified: boolean
  phone_e164: string | null            // null for moderators
  phone_verified: boolean
  status_reason: string | null
  suspended_until: string | null
  deletion_requested_at: string | null
  purge_after: string | null
  locale: string
  devices: { platform: string; app_version: string | null; device_model: string | null; last_seen_at: string }[]
  consents: { document: string; version: string; accepted_at: string }[]
  sanctions: {
    id: string; type: string; reason: string; report_id: string | null
    starts_at: string; ends_at: string | null
    created_by_email: string | null; revoked_at: string | null; revoked_by_email: string | null
  }[]
  reports_against: AdminReportListItem[]   // newest 20
  reports_filed: { total: number; actioned: number; dismissed: number }
  flags: {
    reporter_misuse: boolean           // 5 or more dismissed and none actioned in 30 days (13 section 6.6)
    money_flags_30d: number
    shared_device_with_sanctioned_user: boolean
  }
  audit: AuditEntry[]                  // newest 50 entries whose target is this user or their profile
}
```

A "View profile" link opens `ADM-PROFILE`. Push tokens are never shown.

### 5.3 Sanction actions

Each opens a dialog with a required reason. The reason is shown to the member, so the dialog labels it "Reason (the member will see this)" and offers the example texts of 13 section 7.3.

| Action | Role | Route and body | Allowed when | Effects |
|---|---|---|---|---|
| Warn | Moderator | `POST /v1/admin/users/{user_id}/warn` with `{ "reason": string, "report_id"?: string }` | User `active` | `sanctions` row of type `warning`; notification `account_warning` with `data.reason`; email; audit `user.warn` |
| Suspend | Moderator | `POST /v1/admin/users/{user_id}/suspend` with `{ "reason": string, "days": number, "report_id"?: string }` | User `active`. `days` is 1 to 365. Presets: 7, 30, 90. | 06 section 8.1; audit `user.suspend` |
| Lift suspension | Moderator | `POST /v1/admin/users/{user_id}/unsuspend` | User `suspended` | 06 section 8.3; audit `user.unsuspend` |
| Ban | Admin | `POST /v1/admin/users/{user_id}/ban` with `{ "reason": string, "report_id"?: string }` | User `active` or `suspended` | 06 section 8.1; audit `user.ban`. The dialog requires typing the profile code to confirm. |
| Lift ban | Admin | `POST /v1/admin/users/{user_id}/unban` | User `banned` | 06 section 8.3; audit `user.unban` |
| Change role | Admin | `PATCH /v1/admin/users/{user_id}/role` with `{ "role": string }` | Section 2 rules | `users.role` updated; snapshot invalidated; audit `user.role_change` |

`reason` is 3 to 500 characters (the schema limit). Any other starting status answers `409 invalid_state`. A moderator cannot sanction a staff user: suspending or warning a user whose role is `moderator` or `admin` requires the `admin` role (`403 forbidden` otherwise), and an admin cannot sanction themselves.

### 5.4 Correcting locked fields

Members cannot change `gender` or `date_of_birth` after onboarding, or their names after identity verification (03 section 8 rule 15). When a member emails support with a genuine mistake, an admin corrects it from `ADM-PROFILE`.

`PATCH /v1/admin/profiles/{profile_id}/locked-fields` with any of `{ "first_name"?, "last_name"?, "gender"?, "date_of_birth"? }` plus a required `"reason": string` (staff only, 10 to 500 characters).

| Field | Rules |
|---|---|
| `first_name`, `last_name` | The name pattern of 13 section 3.3. If the profile is `id_verified`, the admin must have seen the document again; the screen shows a reminder. |
| `date_of_birth` | The corrected date must make the candidate 18 or older today. Otherwise `400 validation_failed` with code `too_young`: the right action is a ban for `underage`, not a correction. |
| `gender` | Allowed only when the profile has no `active` connection and no `pending` interest in either direction (`409 invalid_state` otherwise; the admin ends them first by asking the member, or suspends and lifts). On change: clear `hijab` and `beard`; if `marital_status = 'married'` and the new gender is `female`, refuse (`400 validation_failed`); delete the profile's `match_recommendations` in both directions; set `match_stale = true`; if a CNIC or NICOP number is registered and its last digit no longer agrees with the gender, refuse with field code `mismatch`. |

Effects: update the columns, invalidate the account snapshot when `gender` changed, audit `profile.locked_fields_change` with the old and new values.

## 6. Reference data (`ADM-CASTES`)

Two tabs.

### 6.1 Suggestions

`GET /v1/admin/caste-suggestions?status=pending`, ordered by `usage_count` descending.

```ts
type CasteSuggestionItem = {
  id: string
  name: string
  normalized_name: string
  parent_code: string | null
  parent_name: string | null
  usage_count: number
  status: 'pending' | 'promoted' | 'rejected'
  similar: { code: string; name: string }[]   // existing castes whose name or alias is close (trigram similarity of 0.4 or more)
  created_at: string
}
```

| Action | Role | Route | Effects |
|---|---|---|---|
| Promote | Admin | `POST /v1/admin/caste-suggestions/{id}/promote` with `{ "code": string, "name": string, "name_ur"?: string, "parent_code"?: string }` | Insert the `castes` row; set the suggestion to `promoted` with `promoted_code`; rewrite matching profiles from free text to the new code (05 section 13); reload the reference cache; audit `caste_suggestion.promote` |
| Reject | Moderator | `POST /v1/admin/caste-suggestions/{id}/reject` | Status `rejected`; audit `caste_suggestion.reject` |

Promotion rules: `code` matches `^[a-z][a-z0-9_]*$` and is unused (`409 already_exists`); a sub-caste's code starts with `<parent_code>_`; `parent_code`, when given, must be a top-level caste (two levels only, `400 validation_failed`). Promote when a name has been typed by at least 5 different profiles and is a real community name; if `similar` shows the same community under another spelling, do not promote: add the spelling to that caste's aliases instead (6.2) and reject the suggestion.

### 6.2 Caste list

Reads the list from `GET /v1/reference/bootstrap` plus inactive rows from the admin route responses.

| Action | Role | Route and body | Effects |
|---|---|---|---|
| Add | Admin | `POST /v1/admin/castes` with `{ "code": string, "name": string, "name_ur"?: string, "parent_code"?: string, "aliases"?: string[], "sort_order"?: number }` | Insert; reload the reference cache; audit `caste.create` |
| Edit | Admin | `PATCH /v1/admin/castes/{code}` with any of `{ "name", "name_ur", "aliases", "sort_order", "is_active" }` | Update; reload the cache; audit `caste.update` |

Codes cannot be changed and rows cannot be deleted (05 section 13). Deactivating a caste that has active sub-castes is refused (`409 invalid_state`).

## 7. Settings, releases and announcements

### 7.1 Settings (`ADM-SETTINGS`)

`GET /v1/admin/settings` returns `{ "items": [{ "key": string, "value": any, "default": any, "updated_by_email": string | null, "updated_at": string | null }] }` with one item per key of 03 section 7, whether or not a row exists yet. `PUT /v1/admin/settings/{key}` with `{ "value": any }` upserts the row, refreshes the settings cache at once, and writes audit `setting.update`.

The screen groups keys by their prefix and shows each with its meaning from 03 section 7, its default, and a "Reset to default" button (which writes the default value). Validation per key, enforced by the API (`400 validation_failed`, field `value`); an unknown key answers `404 not_found`:

| Keys | Type and range |
|---|---|
| `limits.interests_per_day`, `limits.interests_per_day_verified` | Integer 1 to 200. The verified limit must be greater than or equal to the normal limit. |
| `limits.pending_interests_max` | Integer 5 to 500 |
| `limits.profile_views_per_day` | Integer 10 to 2,000 |
| `limits.photo_requests_per_day` | Integer 1 to 100 |
| `limits.messages_per_minute` | Integer 5 to 120 |
| `limits.messages_per_day` | Integer 50 to 5,000 |
| `limits.reports_per_day` | Integer 1 to 50 |
| `limits.photos_max` | Integer 1 to 10 |
| `limits.saved_searches_max` | Integer 1 to 50 |
| `limits.active_connections_max` | Integer 5 to 200 |
| `interest.expiry_days` | Integer 3 to 90 |
| `interest.cooldown_after_decline_days`, `interest.cooldown_after_expiry_days`, `interest.cooldown_after_withdraw_days`, `connection.cooldown_after_end_days`, `photo_access.retry_days` | Integer 0 to 365 |
| `pass.duration_days` | Integer 7 to 730 |
| `moderation.profile_review`, `moderation.photo_review`, `moderation.text_review` | The string `auto` or `manual` |
| `onboarding.identity_required`, `onboarding.photo_required` | Boolean |
| `matching.candidate_pool_size` | Integer 100 to 2,000 |
| `matching.recommendations_size` | Integer 20 to 500, not greater than the pool size |
| `matching.refresh_hours` | Integer 1 to 168 |
| `account.deletion_grace_days` | Integer 1 to 90 |
| `verification.media_retention_days` | Integer 1 to 180 |
| `legal.terms_version`, `legal.privacy_version`, `legal.guidelines_version` | A date string `YYYY-MM-DD`, not earlier than the current value |
| `support.email` | A valid email address |
| `announcement.banner` | `null`, or an object with `text_en` (1 to 200 characters), optional `text_ur` (up to 200) and optional `url` (must start with `https://`) |

Warnings shown before saving:

| Change | Warning |
|---|---|
| Any `legal.*` version | "Every member will be asked to accept the new document the next time they open the app. Publish the new document text first." |
| `moderation.photo_review` to `auto` | "Photos that pass the automatic check will go live without a person looking at them." |
| `onboarding.identity_required` to `false` | "New members will be able to skip the identity number. Duplicate and returning banned accounts become harder to stop." |

Changes apply to future actions only. Lowering a limit does not undo anything already done.

### 7.2 Releases (`ADM-RELEASES`)

`GET /v1/admin/releases` returns the `app_releases` rows, newest first. `POST /v1/admin/releases` records a build that CI has already uploaded:

```ts
{
  platform: 'android'
  version_code: number                 // must be greater than every existing version_code
  version_name: string                 // for example "1.3.0"
  min_supported_version_code: number   // not greater than version_code, not lower than the current minimum
  download_url: string                 // must start with "https://download."
  release_notes?: string               // up to 1,000 characters, shown in the update prompt
}
```

Effects: insert the row, clear the cached latest release, audit `release.create`. Raising `min_supported_version_code` forces every older build to update before it can continue (`426 upgrade_required`, `GATE-UPGRADE`); the form shows a confirmation naming how many version codes will be locked out. Rows are never edited or deleted. To correct a mistake, publish a new record.

### 7.3 Announcements (`ADM-ANNOUNCE`)

Two tools on one screen.

| Tool | What it does | How |
|---|---|---|
| Banner | A line at the top of `APP-HOME` for everyone, until removed | Edit the `announcement.banner` setting (7.1) |
| Notification | One entry in every member's notification feed | `POST /v1/admin/announcements` |

`POST /v1/admin/announcements` body `{ "text_en": string, "text_ur"?: string, "url"?: string }` (`text_en` 1 to 300 characters, `url` must start with `https://`). The route enqueues one `announcement_fanout` job, writes audit `announcement.send`, and answers `202` with `{ "recipients_estimate": number }`. The job inserts a `notifications` row of type `announcement` with `data = { "text_en", "text_ur", "url" }` for every user who is `active` and whose profile is `active` or `paused`, in batches of 500 (19 section 2.18). Announcements appear in every recipient's feed. They are emailed only at the lowest email priority and only to members with `email_announcements` on, so with the small daily email budget most members receive them in the feed alone (14 section 5).

Rules: at most one announcement per 24 hours (`429 limit_reached`); the screen shows the recipient estimate and requires typing `SEND` to confirm; an announcement cannot be recalled.

## 8. Audit log (`ADM-AUDIT`)

### 8.1 Rules

1. Every state-changing admin route writes exactly one `admin_audit_log` row in the same transaction as the change (03 section 8 rule 13). If the insert fails, the change rolls back.
2. `GET /v1/admin/verifications/{request_id}` also writes a row (`verification.view`) although it changes nothing, because it reveals identity documents.
3. Rows are never updated or deleted by the application.
4. `details` never contains an identity number, a contact detail or the text of a private message.
5. Automatic actions by jobs (a suspension running out, automatic photo decisions) are not audited: there is no acting user. They are visible in the affected rows themselves.

### 8.2 Reading

`GET /v1/admin/audit-log` with optional `actor_user_id`, `target_type`, `target_id`, `action`, and pagination, newest first.

```ts
type AuditEntry = {
  id: string
  actor: { user_id: string; email: string | null }
  action: string
  target_type: string
  target_id: string
  details: object
  created_at: string
}
```

The screen is a table with filters for actor, action and target, and a link from each row to the target's screen.

### 8.3 Action codes

`target_type` must be one of the values allowed by the schema (04 section 9.4).

| `action` | `target_type` | `target_id` | `details` |
|---|---|---|---|
| `profile.approve` | `profile` | profile id | `{}` |
| `profile.request_changes` | `profile` | profile id | `{ "reason": string }` |
| `profile.locked_fields_change` | `profile` | profile id | `{ "reason": string, "changes": { "<field>": { "from": any, "to": any } } }` |
| `photo.approve` | `photo` | photo id | `{ "profile_id": string }` |
| `photo.reject` | `photo` | photo id | `{ "profile_id": string, "reason": string }` |
| `text.approve` | `profile` | profile id | `{ "field": string, "text_sha256": string }` |
| `text.reject` | `profile` | profile id | `{ "field": string, "text_sha256": string, "note": string \| null }` |
| `verification.view` | `verification_request` | request id | `{ "profile_id": string, "kind": string }` |
| `verification.approve` | `verification_request` | request id | `{ "profile_id": string, "kind": string, "photos_match": boolean \| null }` |
| `verification.reject` | `verification_request` | request id | `{ "profile_id": string, "kind": string, "reason": string }` |
| `report.claim` | `report` | report id | `{}` |
| `report.resolve` | `report` | report id | `{ "outcome": string, "note": string }` |
| `user.warn` | `user` | user id | `{ "reason": string, "report_id": string \| null, "sanction_id": string }` |
| `user.suspend` | `user` | user id | `{ "reason": string, "days": number, "ends_at": string, "report_id": string \| null, "sanction_id": string }` |
| `user.unsuspend` | `user` | user id | `{ "sanction_id": string }` |
| `user.ban` | `user` | user id | `{ "reason": string, "report_id": string \| null, "sanction_id": string }` |
| `user.unban` | `user` | user id | `{ "sanction_id": string }` |
| `user.role_change` | `user` | user id | `{ "from": string, "to": string }` |
| `caste.create` | `caste` | caste code | `{ "name": string, "parent_code": string \| null }` |
| `caste.update` | `caste` | caste code | `{ "changes": { "<field>": { "from": any, "to": any } } }` |
| `caste_suggestion.promote` | `caste_suggestion` | suggestion id | `{ "code": string, "profiles_updated": number }` |
| `caste_suggestion.reject` | `caste_suggestion` | suggestion id | `{ "name": string }` |
| `setting.update` | `app_setting` | setting key | `{ "from": any, "to": any }` |
| `release.create` | `app_release` | release id | `{ "version_code": number, "min_supported_version_code": number }` |
| `announcement.send` | `app_setting` | the literal `announcement` | `{ "text_en": string, "url": string \| null, "recipients_estimate": number }` |

`announcement.send` uses `app_setting` because the schema has no target type for announcements.

## 9. Overview (`ADM-HOME`)

`GET /v1/admin/overview`. The response is computed with the queries below and cached in memory for 60 seconds.

```ts
type AdminOverview = {
  generated_at: string
  queues: {
    profiles_pending: number
    photos_pending: number
    photos_flagged: number             // subset of photos_pending whose automatic result is 'flag'
    texts_pending: number
    verifications_pending: number
    reports_open: number
    reports_in_review: number
    caste_suggestions_pending: number
    oldest_waiting: {                  // created time of the longest-waiting item, null when the queue is empty
      profiles: string | null
      photos: string | null
      verifications: string | null
      reports: string | null
    }
  }
  metrics: {
    users_total: number
    signups_today: number
    signups_7d: number
    profiles_by_status: { draft: number; pending_review: number; changes_requested: number; active: number; paused: number; closed: number; suspended: number }
    active_male: number
    active_female: number
    active_id_verified: number
    active_photo_verified: number
    active_last_7d: number             // active profiles with last_active_at in the last 7 days
    interests_sent_today: number
    interests_sent_7d: number
    interests_accepted_7d: number
    connections_active: number
    connections_created_7d: number
    stage_counts: { chatting: number; families_talking: number; engaged: number; nikah_done: number }
    messages_7d: number
    reports_filed_7d: number
    users_suspended: number
    users_banned: number
    deletions_scheduled: number
    jobs_dead: number
  }
}
```

"Today" starts at midnight in `Asia/Karachi`: `date_trunc('day', now() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi'`, written below as `:today`.

```sql
-- queues
SELECT count(*), min(onboarding_completed_at) FROM profiles WHERE status = 'pending_review';

SELECT count(*),
       count(*) FILTER (WHERE moderation ->> 'result' = 'flag'),
       min(created_at)
FROM profile_photos WHERE status = 'pending_review';

-- texts waiting for a person: pending, and no moderate_text job still queued or running for them
SELECT
  (SELECT count(*) FROM profiles p
     WHERE p.about_me_status = 'pending' AND p.status <> 'deleted'
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'moderate_text'
                         AND j.status IN ('queued', 'running')
                         AND j.dedupe_key = p.id::text || ':about_me'))
+ (SELECT count(*) FROM profile_family f
     WHERE f.about_family_status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'moderate_text'
                         AND j.status IN ('queued', 'running')
                         AND j.dedupe_key = f.profile_id::text || ':about_family'))
+ (SELECT count(*) FROM partner_preferences pp
     WHERE pp.notes_status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'moderate_text'
                         AND j.status IN ('queued', 'running')
                         AND j.dedupe_key = pp.profile_id::text || ':partner_notes'));

SELECT count(*), min(created_at) FROM verification_requests WHERE status = 'pending';

SELECT count(*) FILTER (WHERE status = 'open'),
       count(*) FILTER (WHERE status = 'in_review'),
       min(created_at)
FROM reports WHERE status IN ('open', 'in_review');

SELECT count(*) FROM caste_suggestions WHERE status = 'pending';

-- metrics
SELECT count(*),
       count(*) FILTER (WHERE created_at >= :today),
       count(*) FILTER (WHERE created_at > now() - interval '7 days'),
       count(*) FILTER (WHERE status = 'suspended'),
       count(*) FILTER (WHERE status = 'banned'),
       count(*) FILTER (WHERE status = 'deletion_scheduled')
FROM users WHERE status <> 'deleted';

SELECT status, count(*) FROM profiles WHERE status <> 'deleted' GROUP BY status;

SELECT count(*) FILTER (WHERE gender = 'male'),
       count(*) FILTER (WHERE gender = 'female'),
       count(*) FILTER (WHERE is_id_verified),
       count(*) FILTER (WHERE is_photo_verified),
       count(*) FILTER (WHERE last_active_at > now() - interval '7 days')
FROM profiles WHERE status = 'active';

SELECT count(*) FILTER (WHERE created_at >= :today),
       count(*)
FROM interests WHERE created_at > now() - interval '7 days';

SELECT count(*) FROM interests
WHERE status = 'accepted' AND responded_at > now() - interval '7 days';

SELECT count(*),
       count(*) FILTER (WHERE created_at > now() - interval '7 days')
FROM connections WHERE status = 'active';

SELECT stage, count(*) FROM connections WHERE status = 'active' GROUP BY stage;

SELECT count(*) FROM messages WHERE kind = 'text' AND created_at > now() - interval '7 days';

SELECT count(*) FROM reports WHERE created_at > now() - interval '7 days';

SELECT count(*) FROM jobs WHERE status = 'dead';
```

The screen shows the queues as cards (each linking to its queue, coloured amber when the oldest item has waited longer than the target of 13 section 6.5 for reports, or 24 hours for the other queues) and the metrics as a plain grid of numbers. No charts are required. `jobs_dead` above zero is shown in red: it means a background job failed permanently and needs a developer.

## 10. Staff conduct

These rules are part of onboarding every moderator and are linked from the console's footer.

1. **Least access.** Open a profile, an account or a document only because a queue item or a support request requires it. The console has no "browse members" screen on purpose.
2. **No curiosity.** Looking up someone you know, a public figure, or a profile you matched with as a member is forbidden and is grounds for removal of the role.
3. **Identity documents.** Every view of a verification request is logged with your name. Never photograph, copy, download or forward an identity image or number. Close the tab when you finish.
4. **Chat privacy.** You see private messages only as the excerpt inside a report. Never ask a developer for more.
5. **Write for the member.** Reasons and notes that the member will see must be polite, specific and free of blame. Never name or hint at the reporter.
6. **No contact outside the product.** Do not phone, message or email a member from a personal account. Support email goes through the shared support mailbox.
7. **Conflicts of interest.** If a queue item concerns your own profile, a relative or a friend, skip it and tell an admin.
8. **Two people for the hardest calls.** A ban for fraud, a decision on a possible minor, and any request from law enforcement are confirmed by an admin (13 sections 7 and 10).
9. **Your own account.** Use a strong, unique Google account or mailbox for your staff login. A compromised staff account must be reported to an admin at once so that the role can be removed and the audit log reviewed.
10. **When in doubt, hold.** Leave the item in the queue and ask. A late decision is better than a wrong one.

## Open questions

1. **Second admin.** The appeal and two-person rules assume at least two admins. With a single admin (the product owner), the same person must review their own decisions after a delay. The product owner should name a second admin before launch.
2. **Moderator access to contact details.** Moderators currently do not see members' phone numbers or contact email. If support work is handed to moderators, this needs revisiting.
