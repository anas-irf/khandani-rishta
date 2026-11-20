# 09. Privacy and Visibility

| | |
|---|---|
| Status | Design complete, not implemented |
| Related | [03-domain-model.md](03-domain-model.md) for tiers and invariants, [04-database-schema.md](04-database-schema.md) section 5.7 for `profile_privacy`, [10-matching-and-discovery.md](10-matching-and-discovery.md) for must-haves, [15-api-contract.md](15-api-contract.md) for response types |

This document defines who may see a profile, which parts they see, and every privacy control a member has. All rules here are enforced by the API. Clients only render what they receive.

## 1. Principles

1. **The owner decides.** Every optional disclosure has a setting, and the setting takes effect on the next request by any viewer.
2. **Server-side only.** A value the viewer may not see is never sent. It is `null` in the response, and its group is listed in `locked` when connecting would reveal it.
3. **No silent leaks.** A hidden value must not leak through search filters, match reasons, compatibility breakdowns or notifications (section 5.4).
4. **Reciprocity.** A member who hides a signal about themselves (visits, last active, online status, read receipts) does not receive that signal about others.
5. **Contact details are never automatic.** Phone, WhatsApp, email and guardian contact are revealed only by an explicit contact share to one connection.
6. **Honest wording.** Helper text states the cost of each choice (for example, hiding caste removes the member from caste-filtered searches).
7. **Opposite gender only, members only.** There are no public profile pages. Nothing in this document applies to visitors without a session: they see no profile data at all.

## 2. Who can open a profile

"Open" means: the profile may appear as a `ProfileCard` in any list for this viewer, and `GET /v1/profiles/{profile_id}` returns `ProfileDetail`. When the answer is no, the API behaves exactly as if the profile did not exist (`404 not_found`, absent from lists).

Names used below: V is the viewer's profile, O is the owner's profile.

### 2.1 Inputs

| Input | Source |
|---|---|
| Genders | `profiles.gender` of V and O |
| Block | A row in `blocks` in either direction |
| Statuses | `profiles.status` and `users.status` of V and O |
| Active connection | A `connections` row for the pair with `status = 'active'` |
| Pending interest | An `interests` row between the pair with `status = 'pending'`, either direction |
| Discovery setting | O's `profile_privacy.discovery_visibility` |
| Must-have check | `passes_must_haves(O.preferences, V)` from 10 section 3 |
| Second-marriage rule | 10 section 3 rule E9, applied in both directions |

### 2.2 Decision table

Evaluate the rows top to bottom. The first row that matches decides.

| # | Condition | Result |
|---|---|---|
| 1 | V and O are the same profile | Not handled here. The owner uses `GET /v1/me/profile`, and `GET /v1/me/profile/preview` to see the profile as others do. `GET /v1/profiles/{own id}` returns `404`. |
| 2 | V and O have the same gender | No |
| 3 | A block exists in either direction | No |
| 4 | `O.user.status` is not `active`, or `O.status` is `draft`, `pending_review`, `changes_requested`, `suspended` or `deleted` | No |
| 5 | An active connection exists, O is `active`, `paused` or `closed`, and V is `active`, `paused` or `closed` | Yes, tier `connection` |
| 6 | O has a pending interest to V, O is `active` or `paused`, V is `active` or `paused` | Yes, tier `interest_from_owner` |
| 7 | V has a pending interest to O, O is `active` or `paused`, V is `active` or `paused` | Yes, tier `interest_to_owner` |
| 8 | V is not `active`, or O is not `active` | No |
| 9 | Second-marriage rule fails: O is `married` and V's `marital_statuses` does not contain `married`, or V is `married` and O's `marital_statuses` does not contain `married` | No |
| 10 | O's `discovery_visibility = 'hidden'` | No |
| 11 | O's `discovery_visibility = 'preference_match'` and `passes_must_haves(O.preferences, V)` is false | No |
| 12 | Otherwise | Yes, tier `member` |

Notes:

- Rows 5 to 7 are the "relation" paths. They ignore `discovery_visibility`, so a `hidden` owner stays visible to the people the owner contacted, to people whose earlier interest is still pending, and to connections.
- A `hidden` owner can still browse and send interests. The receiver can open the sender through row 6.
- Row 9 keeps invariant 10 of 03 section 8 true for every path that has no relation. A `married` man therefore cannot open, and so cannot send an interest to, a woman who has not opted in.
- The table uses current data on every request. There is no cached permission.

### 2.3 Discovery versus open

Appearing in discovery lists (recommendations, search, `new_members`, `nearby`) is stricter than being openable. Discovery uses only row 12 (tier `member`) plus the extra exclusions in 10 section 3 (passes, cooldowns, existing relations). Lists that are built from relations (interests, connections, shortlist, visitors, notifications) use the full table.

| `discovery_visibility` | In recommendations, search, home lists | Openable by a member with no relation | Openable by interest counterparts and connections |
|---|---|---|---|
| `everyone` | Yes | Yes | Yes |
| `preference_match` | Only for viewers who pass all of the owner's must-haves | Same condition | Yes |
| `hidden` | Never | No | Yes |

### 2.4 Pseudocode

```text
fn relation(v, o) -> Option<Tier>:
    if v.id == o.id:                          return Some(Self)        // only used by preview, see section 13
    if v.gender == o.gender:                  return None
    if block_exists(v, o):                    return None
    if o.user_status != active:               return None
    if o.status in [draft, pending_review, changes_requested, suspended, deleted]: return None

    let v_linked = v.status in [active, paused, closed]
    if active_connection(v, o) and v_linked:  return Some(Connection)  // o is active, paused or closed here

    let both_engaged = o.status in [active, paused] and v.status in [active, paused]
    if pending_interest(from = o, to = v) and both_engaged: return Some(InterestFromOwner)
    if pending_interest(from = v, to = o) and both_engaged: return Some(InterestToOwner)

    if v.status != active or o.status != active: return None
    if !second_marriage_ok(v, o):             return None
    match o.privacy.discovery_visibility:
        hidden           => None
        preference_match => if passes_must_haves(o.prefs, v) { Some(Member) } else { None }
        everyone         => Some(Member)

fn can_open(v, o) -> bool:
    relation(v, o).is_some()
```

`second_marriage_ok(v, o)` is true unless one side has `marital_status = 'married'` and the other side's `partner_preferences.marital_statuses` does not contain `married`. A missing preferences row counts as an empty array.

## 3. Settings reference

All settings live in `profile_privacy` and are edited on `SET-PRIVACY` through `PATCH /v1/me/privacy`. The "Label" and "Helper text" columns are the exact English strings (keys in the i18n catalogue; Urdu follows in the second phase).

### 3.1 Who can find and contact me

| Column | Value | Label | Helper text |
|---|---|---|---|
| `discovery_visibility` (default `everyone`) | `everyone` | Everyone | Your profile appears in matches and search for all members. |
| | `preference_match` | Only people who fit my must-haves | Only members who meet every preference you marked as a must-have can find or open your profile. |
| | `hidden` | Hidden | Nobody can find you. Only people you send an interest to, and your connections, can open your profile. |
| `interest_permission` (default `everyone`) | `everyone` | Anyone | Any member can send you an interest. |
| | `verified_only` | Verified members only | Only members with a verified photo or verified ID can send you an interest. |
| | `preference_match` | Only people who fit my must-haves | Only members who meet every preference you marked as a must-have can send you an interest. |

Section title: "Who can find me". Setting titles: "Profile visibility" and "Who can send me an interest".

### 3.2 Name and photos

| Column | Value | Label | Helper text |
|---|---|---|---|
| `name_display` (default `first_name_last_initial`) | `full_name` | Full name | Example: Ayesha Khan |
| | `first_name_last_initial` | First name and initial | Example: Ayesha K. |
| | `first_name_only` | First name only | Example: Ayesha |
| | `initials` | Initials | Example: A. K. |
| | `code_only` | Profile code only | Example: KR7F3K2QX9 |
| `photo_visibility` (default `members`; `interests_and_connections` for female profiles, see 3.5) | `members` | All members | Every member who can open your profile sees your photos. |
| | `interests_and_connections` | People I show interest in | Photos are blurred. They become clear for people you send an interest to and for your connections. |
| | `connections` | Connections only | Photos are blurred until you and the other person are connected. |
| | `approved_only` | Only people I approve | Photos are blurred for everyone. You approve each person who may see them, including connections. |
| `allow_photo_requests` (default `true`) | on / off | Let members ask to see my photos | When your photos are blurred, members can send you a request. You decide each one. |

Under `name_display` show this fixed note: "Your connections always see your full name." The example strings are rendered with the member's own name.

### 3.3 Details I share

Each of these seven columns takes `members`, `connections` or `nobody`.

| Value | Label |
|---|---|
| `members` | All members |
| `connections` | Connections only |
| `nobody` | Nobody |

| Column | Default | Title | Helper text |
|---|---|---|---|
| `caste_visibility` | `members` | Caste and sub-caste | If you hide this from members, people who search or match by caste will not find you through it. |
| `income_visibility` | `connections` | Income | If you hide this from members, it is not used to match you with people who ask for a minimum income. |
| `family_visibility` | `members` | Family details | Parents, siblings, family type and values, and your "about my family" text. If hidden from members, family values are not used in matching. |
| `career_details_visibility` | `connections` | Job title, employer and institute | Your education level and profession category are always visible. |
| `home_visibility` | `connections` | Home details | Ownership, type and size of the family home. |
| `area_visibility` | `connections` | Neighbourhood | Your city is always visible. This controls the area within the city. |
| `health_visibility` | `connections` | Health details | Disability information and blood group. |

### 3.4 Activity

| Column | Default | Title | Helper text |
|---|---|---|---|
| `show_last_active` | `true` | Show when I was last active | If you turn this off, you also will not see when others were last active. Search can still order members by recent activity. |
| `show_online_status` | `true` | Show when I am online | If you turn this off, you also will not see who is online. |
| `record_my_visits` | `true` | Let members see that I viewed their profile | If you turn this off you browse privately, your earlier visits are hidden too, and you cannot see who viewed your profile. |
| `send_read_receipts` | `true` | Read receipts | If you turn this off, others will not see when you have read their messages or opened their interest, and you will not see it for theirs. |

### 3.5 Defaults

1. Database defaults are those in 04 section 5.7.
2. When `PUT /v1/me/profile/sections/basics` is saved with `gender = 'female'` while the profile is `draft`, and `photo_visibility` still has the database default `members`, the API sets `photo_visibility = 'interests_and_connections'`. It never changes the value again after the owner has made a choice (the onboarding photos step, 07, always asks explicitly).
3. No other default depends on gender.

## 4. Display name rules

Other members never receive `first_name` or `last_name` as separate fields. They receive one string, `display_name`, built by the server.

### 4.1 Rule table

`first` and `last` are the stored `first_name` and `last_name` after trimming. `F` is the first character of `first` and `L` is the first character of `last`, both upper-cased when the script has case.

| `name_display` | Tier `member`, `interest_from_owner`, `interest_to_owner` | Tier `connection` and `self` |
|---|---|---|
| `full_name` | `{first} {last}` | `{first} {last}` |
| `first_name_last_initial` | `{first} {L}.` | `{first} {last}` |
| `first_name_only` | `{first}` | `{first} {last}` |
| `initials` | `{F}. {L}.` | `{first} {last}` |
| `code_only` | `public_code` | `{first} {last}` |

`locked` contains `full_name` exactly when the rendered `display_name` is not `{first} {last}`, that is, when the tier is not `connection` or `self` and `name_display` is not `full_name`.

### 4.2 Examples

| Stored name | `first_name_last_initial` | `first_name_only` | `initials` | `code_only` |
|---|---|---|---|---|
| Ayesha / Khan | Ayesha K. | Ayesha | A. K. | KR7F3K2QX9 |
| Muhammad Ali / Raza | Muhammad Ali R. | Muhammad Ali | M. R. | KR2M8PQ4TZ |
| Sana / Khan Niazi | Sana K. | Sana | S. K. | KR9A1BC3DE |
| Bilal / ul Haq | Bilal U. | Bilal | B. U. | KR5H7JK2MN |

### 4.3 Edge cases

1. **Several words.** A first name with several words is kept whole. Initials always use the first character of the first word of each field.
2. **Characters.** "First character" means the first extended grapheme cluster, not the first byte. For scripts without case (Urdu, Arabic) no case change is applied: a first name written in Urdu script yields its first letter followed by a full stop.
3. **Short names.** The schema requires at least 2 characters per name, so an initial always exists.
4. **Managed profiles.** The display name is always the candidate's name. `manager_name` is never shown to other members.
5. **Deleted member.** `Connection.other` is `null`; clients show the i18n string "Member no longer available" (15 section 4.7).
6. **Ended connections.** After a connection ends the tier falls back to `member`, so the display name follows `name_display` again. The other member may remember the full name; the helper text on `SET-PRIVACY` does not promise otherwise.
7. **Where the rule applies.** Every place a name leaves the API: `ProfileCard.display_name`, `ProfileDetail`, `notifications.actor.display_name`, the `GET /v1/blocks` list (always rendered at tier `member`), and WebSocket events. Push payloads carry no names at all (14 section 4).
8. **Search.** There is no search by name. Members are found by profile code only (`GET /v1/profiles/by-code/{public_code}`, which the search screen uses, or the `public_code` search filter).

## 5. Field groups and the visibility matrix

### 5.1 Levels

| Setting value | Who sees the group |
|---|---|
| `members` | Any viewer who can open the profile (tiers `member`, `interest_from_owner`, `interest_to_owner`, `connection`) |
| `connections` | Tier `connection` only |
| `nobody` | Only the owner |

The two interest tiers count as `member` for every group except photos (section 6).

### 5.2 Groups

| `LockedGroup` | Controlled by | Fields |
|---|---|---|
| `full_name` | `name_display` | The full name (section 4) |
| `photos` | `photo_visibility`, `photo_access` | Clear photo variants (section 6) |
| `caste` | `caste_visibility` | `caste_label`, `sub_caste_label` |
| `income` | `income_visibility` | `income_band_code` |
| `family` | `family_visibility` | `father_status`, `father_occupation`, `mother_status`, `mother_occupation`, `brothers_count`, `brothers_married`, `sisters_count`, `sisters_married`, `family_type`, `family_class`, `family_values`, `family_country_code`, `family_city_name`, `about_family` |
| `career_details` | `career_details_visibility` | `degree_title`, `institute_name`, `job_title`, `employer_name` |
| `home` | `home_visibility` | `home_ownership`, `home_type`, `home_size_value`, `home_size_unit` |
| `area` | `area_visibility` | `area` |
| `health` | `health_visibility` | `disability`, `disability_details`, `blood_group` |

### 5.3 Field matrix

"Always" means visible to every viewer who can open the profile. "Group" means the outcome depends on the group's setting and the tier, as in 5.1. "Never" means no other member ever receives it.

| Response field (15 section 4.6) | Source | Visibility |
|---|---|---|
| `id`, `public_code` | `profiles` | Always |
| `display_name` | `first_name`, `last_name` | Always, reduced per section 4 |
| `age` | `date_of_birth` | Always (age only) |
| `gender`, `managed_by` | `profiles` | Always |
| `height_cm`, `weight_kg`, `complexion`, `body_type` | `profiles` | Always (null when not filled) |
| `marital_status`, `children_status`, `children_count`, `current_wives_count` | `profiles` | Always |
| `religion_code`, `sect_code`, `mother_tongue_code`, `language_codes` | `profiles`, `profile_languages` | Always |
| `caste_label`, `sub_caste_label` | `caste_code` or `caste_other`, `sub_caste_code` or `sub_caste_other` | Group `caste` |
| `country_code`, `region_name`, `city_name` | `profiles`, `regions`, `cities` or `city_other` | Always |
| `area` | `profiles.area` | Group `area` |
| `nationality_code`, `residency_status`, `relocation`, `origin_label` | `profiles` | Always |
| `education_level_code`, `education_field_code` | `profiles` | Always |
| `degree_title`, `institute_name` | `profiles` | Group `career_details` |
| `employment_type`, `profession_code` | `profiles` | Always |
| `job_title`, `employer_name` | `profiles` | Group `career_details` |
| `income_band_code` | `profiles` | Group `income` |
| `religiosity`, `prayer_frequency`, `hijab`, `beard`, `religious_education`, `smoking`, `living_arrangement`, `work_after_marriage`, `marriage_timeline`, `jahez_stance`, `hobby_codes` | `profiles`, `profile_hobbies` | Always |
| `disability`, `disability_details`, `blood_group` | `profiles` | Group `health` |
| `family.*` except the home fields | `profile_family` | Group `family` |
| `family.home_ownership`, `family.home_type`, `family.home_size_value`, `family.home_size_unit` | `profile_family` | Group `home` |
| `about_me` | `profiles.about_me` | Always, only when `about_me_status = 'approved'` |
| `about_family` | `profile_family.about_family` | Group `family`, only when `about_family_status = 'approved'` |
| `partner_notes` | `partner_preferences.notes` | Always, only when `notes_status = 'approved'` |
| `looking_for` | `partner_preferences` | Always |
| `compatibility`, `compat`, `reasons` | Computed | Always, computed only from matchable values (5.4) |
| `photo`, `photos`, `photo_count` | `profile_photos` with `status = 'approved'` | Clear or blurred per section 6 |
| `badges` | `is_phone_verified`, `is_photo_verified`, `is_id_verified`, `first_activated_at` | Always |
| `last_active`, `is_online` | `last_active_at`, hub | Per section 9 |
| `relation` | Computed | Always |
| `date_of_birth` | `profiles` | Never |
| `first_name`, `last_name` as separate values, `manager_name` | `profiles` | Never |
| Identity number, `number_last4`, identity `status` | `profile_identity` | Never (only the `id_verified` badge) |
| `phone_e164`, `whatsapp_e164`, `contact_email`, guardian fields, `preferred_contact`, `best_time_to_call` | `profile_contacts` | Never, except through an active contact share (section 10) |
| `users.email`, `users.phone_e164` | `users` | Never |
| Exact `last_active_at`, `created_at`, `first_activated_at` | `profiles` | Never (only labels and the `new` badge) |
| `status`, `status_reason`, `completeness`, text and photo moderation statuses, rejected or pending photos | Various | Never |
| Privacy settings, preferences importance of hidden groups, shortlists, passes, blocks, views marked private | Various | Never |

### 5.4 Hidden values do not take part in matching or search

A value in a controlled group is **matchable** only when the group's setting is `members`. When the setting is `connections` or `nobody`, the matching engine and the search filters treat the value as unknown, for every viewer and at every tier. This keeps hidden values from leaking through filter results, reasons or compatibility lines, and keeps `compat` the same before and after connecting.

| Group | Effect when not `members` |
|---|---|
| `caste` | The profile fails a `caste` must-have, scores neutral on a non-must caste preference, never matches a `caste_codes` search filter, never gets reason `same_caste` |
| `income` | The same for the `income` dimension and the `income_min_rank` filter |
| `family` | The same for the `family` dimension, the `family_values` and `family_types` filters, and reason `family_values_fit` |

The groups `career_details`, `home`, `area` and `health` are never matching or search inputs. Exact rules are in 10 sections 4 and 9.

### 5.5 How `locked` and nulls are produced

1. For each controlled group, decide `visible` from the setting and the tier (5.1).
2. If not visible, set every field of the group to `null` in the response.
3. Add the group to `locked` only when the setting is `connections`, the tier is not `connection`, and the owner has at least one non-null value in the group. `locked` therefore means "you would see this after connecting". A group set to `nobody` is never listed.
4. `family` in `ProfileDetail` is `null` when the owner has no `profile_family` row, or when both `family` and `home` are not visible. Otherwise it is an object in which the fields of a hidden group are `null`.
5. `photos` is in `locked` when the profile has at least one approved photo and the viewer receives blurred variants.
6. `full_name` is in `locked` per section 4.1.
7. A `ProfileCard` carries no `locked` array. It applies the same rules to `display_name`, `caste_label` and `photo`.

Clients render a locked group as a single line, for example "Family details: shared with connections", never as empty fields.

## 6. Photos

### 6.1 Modes by tier

| `photo_visibility` | `member` | `interest_to_owner` (viewer sent the interest) | `interest_from_owner` (owner sent the interest) | `connection` |
|---|---|---|---|---|
| `members` | Clear | Clear | Clear | Clear |
| `interests_and_connections` | Blurred | Blurred | Clear | Clear |
| `connections` | Blurred | Blurred | Blurred | Clear |
| `approved_only` | Blurred | Blurred | Blurred | Blurred |

In every mode, a `photo_access` row for (owner, viewer) with `status = 'granted'` gives clear photos.

```text
fn photo_mode(owner, viewer, tier) -> Clear | Blurred:
    if tier == Self: return Clear
    if photo_access(owner, viewer).status == granted: return Clear
    match owner.privacy.photo_visibility:
        members                   => Clear
        interests_and_connections => if tier in [InterestFromOwner, Connection] { Clear } else { Blurred }
        connections               => if tier == Connection { Clear } else { Blurred }
        approved_only             => Blurred
```

### 6.2 What "blurred" means

1. Only photos with `status = 'approved'` are ever listed. `photo_count` is the number of approved photos in both modes.
2. Clear: each `PhotoView` has `is_blurred = false` and signed URLs for `key_thumb`, `key_medium`, `key_large`.
3. Blurred: each `PhotoView` has `is_blurred = true`, `thumb_url` signed for `key_blur_thumb`, `medium_url` signed for `key_blur_medium`, and `large_url = null`.
4. The blurred files are separate objects created during processing (08 section 5). The API never signs a clear key for a viewer in blurred mode, so the blur cannot be removed on the client.
5. The same mode applies everywhere the owner's photo is sent to that viewer: cards, profile detail, interests, the chat list, notification actors.
6. A profile with no approved photo has `photo = null`, `photos = []`, and is not listed as `locked`.

### 6.3 Photo access requests

The viewer asks with `POST /v1/profiles/{profile_id}/photo-access`. Checks, in order:

| # | Check | Error |
|---|---|---|
| 1 | Viewer's profile is `active` (access level `browse`) and `can_open(viewer, owner)` | `profile_not_active`, `not_found` |
| 2 | The viewer currently gets blurred photos and the owner has at least one approved photo | `invalid_state` |
| 3 | Owner's `allow_photo_requests` is true | `not_permitted_by_member` |
| 4 | No `pending` row exists | `already_exists` |
| 5 | If a `denied` or `revoked` row exists, `updated_at + photo_access.retry_days` has passed | `cooldown_active` with `retry_after_date` |
| 6 | Viewer's `photo_requests_sent` counter for today is below `limits.photo_requests_per_day` | `limit_reached` |

On success: upsert the row to `pending`, increase the counter, create a `photo_request_received` notification for the owner.

Owner actions:

| Action | Endpoint | Effect |
|---|---|---|
| Approve | `POST /v1/me/photo-access/{id}/grant` | `granted`, `decided_at = now()`, notification `photo_request_granted` to the viewer |
| Deny | `POST /v1/me/photo-access/{id}/deny` | `denied`, `decided_at = now()`. No notification. |
| Grant without a request | `PUT /v1/me/photo-access/grants/{profile_id}` | Upsert to `granted`. Allowed only when `can_open(owner, target)`. Notification `photo_request_granted`. |
| Revoke | `DELETE /v1/me/photo-access/grants/{profile_id}` | `revoked`. No notification. Takes effect on the viewer's next request. |

### 6.4 Mapping to `Relation.photo_access`

Evaluate top to bottom for (owner, viewer):

| # | Condition | Value |
|---|---|---|
| 1 | `photo_mode` is Clear, or the owner has no approved photo | `visible` |
| 2 | A `pending` row exists | `requested` |
| 3 | Owner's `allow_photo_requests` is false | `requests_off` |
| 4 | A `denied` or `revoked` row exists and the retry period has not passed | `denied` |
| 5 | Otherwise | `can_request` |

Clients show the request button only for `can_request`. For `denied` they show "Photos are private" without naming the denial.

### 6.5 Automatic revocation

| Event | Effect on `photo_access` rows between the pair |
|---|---|
| Connection ends | `granted` rows in both directions become `revoked` |
| Block (either direction) | `granted` become `revoked`, `pending` become `denied`, both directions |
| Owner changes `photo_visibility` | Nothing. Existing grants stay; the owner revokes individually. |
| Account purge | Rows are deleted |

### 6.6 Protection against copying

| Platform | Measure |
|---|---|
| Android | `FLAG_SECURE` on `APP-PROFILE`, `APP-PHOTOS`, `APP-CHAT`, `APP-CONNECTION`, `ME-VERIFY-ID` and `ME-VERIFY-SELFIE`: screenshots and screen recording show a black frame, and the app preview in the recent-apps list is hidden. |
| Web | Screenshots cannot be prevented. Images are rendered with `draggable="false"`, the context menu is disabled on photo elements, there is no download or share button, and photo URLs expire (08 section 5.4). |
| Both | Clear `large_url` is only requested when the member opens `APP-PHOTOS`. |
| Later phase | A faint watermark with the viewer's profile code drawn over full-size photos, to discourage leaks. Not in the first release. |

`SET-PRIVACY` shows this fixed note under the photo setting: "No app can fully stop someone from photographing their screen. Share clear photos only with people you trust."

## 7. Who may send an interest

### 7.1 Evaluation

Run for sender S and receiver R as check 5 of `POST /v1/interests` (15 section 11):

| R's `interest_permission` | S is allowed when |
|---|---|
| `everyone` | Always |
| `verified_only` | `S.is_id_verified` or `S.is_photo_verified` |
| `preference_match` | `passes_must_haves(R.preferences, S)` (10 section 3). If R has no must-have dimension, this is always true. |

On failure the API returns `409 not_permitted_by_member` with `details.reason` equal to `verified_only` or `preference_match`.

**Mutual interest bypass:** when R already has a pending interest to S, S's request accepts it and this check is skipped. R chose S, so R's inbound filter does not apply.

`interest_permission` only filters new interests. It does not hide the profile (that is `discovery_visibility`) and does not affect interests already pending.

### 7.2 Surfacing before the member tries

`Relation.can_send_interest` and `cannot_send_reason` on `ProfileDetail` are computed with the same checks as `POST /v1/interests`, in this order. The first failing row gives the reason.

| # | Condition | `cannot_send_reason` |
|---|---|---|
| 1 | The viewer's own profile is not `active` | `own_profile_not_active` |
| 2 | An active connection exists | `already_connected` |
| 3 | A pending interest exists in either direction | `already_pending` |
| 4 | A cooldown applies (03 sections 4.7 and 4.8). Set `can_send_interest_after` to the date it ends. | `cooldown` |
| 5 | The owner's `interest_permission` rejects the viewer | `not_permitted_by_member` |
| 6 | The viewer has `limits.pending_interests_max` pending sent interests | `pending_limit` |
| 7 | The viewer has `limits.active_connections_max` active connections | `connection_limit` |
| 8 | The viewer has used today's interest limit | `daily_limit` |
| 9 | None of the above | `null`, `can_send_interest = true` |

When row 3 matches because the owner sent the interest (`relation.interest.direction = 'received'`), the client shows Accept and Decline in place of Send.

`Relation.cannot_send_detail` says which rule applied, so the client can be specific:

| `cannot_send_detail` | Client text |
|---|---|
| `verified_only` | "This member accepts interests only from verified members." With a "Get verified" link to `ME-VERIFY`. |
| `preference_match` | "This member accepts interests only from people who fit their preferences." |

## 8. Profile views and private browsing

### 8.1 Recording a view

On every successful `GET /v1/profiles/{profile_id}`:

1. Skip when the tier is `connection` (connections open each other often; it is noise).
2. Look for the row (`viewer_profile_id`, `viewed_profile_id`, `viewed_on = today in Asia/Karachi`).
3. If no row exists, this is a new distinct view for today:
   - If the viewer's `profiles_viewed` counter for today has reached `limits.profile_views_per_day`, return `429 limit_reached` and send no profile data.
   - Otherwise insert the row with `view_count = 1`, `is_private = NOT viewer.record_my_visits`, and increase the counter.
4. If the row exists, set `last_viewed_at = now()` and `is_private = NOT viewer.record_my_visits`. Increase `view_count` only when the previous `last_viewed_at` is more than 30 minutes old.

Opening a profile already viewed today never counts against the limit.

### 8.2 Private browsing

`record_my_visits = false` means:

1. New views are stored with `is_private = true` and never appear in anyone's visitors list.
2. When the setting changes from true to false, the API sets `is_private = true` on all of the member's existing `profile_views` rows in the same transaction. Turning it back on does not make old visits visible again.
3. **Reciprocity:** `GET /v1/me/visitors` returns `{ "items": [], "next_cursor": null, "hidden_because_private": true }`, and `GET /v1/home` returns `recent_visitors: []` and `visitors_count_7d: 0`. The client shows "Turn off private browsing to see who viewed your profile" with a link to `SET-PRIVACY`.
4. The member's own history (`GET /v1/me/visited`) still works, because it is their own data.

### 8.3 Visitors list

`GET /v1/me/visitors`: rows where `viewed_profile_id` is the caller, `is_private = false`, `last_viewed_at` within 30 days, grouped by viewer (`max(last_viewed_at)`, `sum(view_count)`), newest first. A viewer the caller can no longer open (section 2) is left out.

`visitors_count_7d` is the number of distinct such viewers in the last 7 days.

### 8.4 Summary notification

The `profile_views_summary` job (19 section 2) runs daily at 19:00 `Asia/Karachi`. For each member with `record_my_visits = true` and at least one new non-private visitor since the previous run, it creates one `profile_views_summary` notification with the count. A push is sent only when `push_profile_views` is true (default false). Rows older than 90 days are deleted by `cleanup_old_rows`.

## 9. Last active, online status, read receipts

Each signal is shared only when **both** sides share it.

| Signal | Sent to viewer V about owner O when | Otherwise |
|---|---|---|
| `last_active` label on cards and detail | `O.show_last_active` and `V.show_last_active` | `null` |
| The label value `online` and `ProfileDetail.is_online` | Additionally `O.show_online_status` and `V.show_online_status`, and O is online (03 section 6) | The label falls back to `today`; `is_online` is `null` |
| WebSocket `presence` events | The two are connected and both have `show_online_status` | Not sent |
| `Connection.their_last_read_message_id` and WebSocket `message.read` | Both have `send_read_receipts` | `null`, not sent |
| `Interest.seen` as shown to the sender | Both have `send_read_receipts` | Always `false` for the sender |

Rules:

1. Labels are coarse: `online`, `today`, `this_week`, `this_month`, `earlier`. An exact time is never sent.
2. Ranking, the `recently_active` sort and the `active_within_days` filter use the true `last_active_at` of every member, including those who hide the label (the helper text in 3.4 says so). Reason `recently_active` is never given for a member who hides the label, or to a viewer who hides theirs.
3. The receiver always sees their own unread state. Hiding read receipts never affects unread counters.

## 10. Contact details and contact sharing

### 10.1 What exists

Contact details live in `profile_contacts` and are edited on `SET-CONTACTS` (`PUT /v1/me/profile/sections/contacts`, validation in 08 section 3). The login email and phone in `users` are never shared automatically; the member re-enters what they want to share.

| Item | Columns | Share flag |
|---|---|---|
| Phone | `phone_e164` | `share_phone` |
| WhatsApp | `whatsapp_e164` | `share_whatsapp` |
| Email | `contact_email` | `share_email` |
| Guardian | `guardian_name`, `guardian_relation`, `guardian_phone_e164` | `share_guardian` |

### 10.2 Sharing

1. Sharing is per connection and one-directional. Each member decides separately.
2. `PUT /v1/connections/{connection_id}/contact-share` with at least one flag true. A selected item must be filled: phone, WhatsApp and email need their value; guardian needs `guardian_name` and `guardian_phone_e164`. Otherwise `validation_failed` with field code `required`, and the client opens `SET-CONTACTS`.
3. The share is a reference, not a copy. If the owner later edits a shared number, the connection sees the new value.
4. The other member receives `Connection.their_contact` (`SharedContact`): only the selected items, plus `preferred_contact` and `best_time_to_call`. Unselected items are `null`.
5. Effects: system message `contact_shared`, notification `contact_shared`, WebSocket `connection.updated` to both.
6. For a profile with `managed_by` other than `self`, the share dialog preselects the guardian item and explains: "Many families prefer that first contact goes through a parent or guardian."

### 10.3 Revocation

1. `DELETE /v1/connections/{connection_id}/contact-share` sets the share to `revoked`. `their_contact` becomes `null` for the other member on the next fetch. System message `contact_share_revoked`.
2. Ending the connection revokes both shares automatically.
3. Sharing again after a revocation sets the same row back to `active`.
4. The share dialog and the revoke confirmation both show this fixed text: "Once shared, the other person may have saved your details. Stopping the share hides them in the app but cannot take them back."

### 10.4 Contact details elsewhere

Free text (about me, about family, partner notes, interest messages) may not contain phone numbers, email addresses, links or social handles (13 section 3). Chat messages may; the receiver then sees a safety notice (13 section 5).

## 11. Block, pass, pause, hide and close compared

| | Pass | Block | Hidden mode | Pause | Close |
|---|---|---|---|---|---|
| How | `PUT /v1/passes/{profile_id}` | `PUT /v1/blocks/{profile_id}` | `discovery_visibility = 'hidden'` | `POST /v1/me/profile/pause` | `POST /v1/me/profile/close` |
| Scope | One profile | One profile | Everyone | Everyone | Everyone |
| The other side notices | No | Not told; you vanish for them | No | No | No |
| I see them in matches and search | No, for 180 days | Never | Yes | I cannot browse | I cannot browse |
| They see me in matches and search | Yes | Never | No | No | No |
| They can open my profile | Yes | No | Only if a pending interest exists between us (either direction), or we are connected | Only interest counterparts and connections | Only connections |
| Pending interests between us | Unchanged | Closed (03 section 4.7) | Unchanged | Kept | Expired |
| Active connection | Unchanged | Ended, reason `blocked` | Unchanged | Unchanged, chat works | Chat is read-only for me |
| Contact shares and photo grants | Unchanged | Revoked both ways | Unchanged | Unchanged | Unchanged |
| Shortlist entries | My entry for them is removed | Removed both ways | Unchanged | Unchanged | Unchanged |
| Undo | `DELETE /v1/passes/{profile_id}` | `DELETE /v1/blocks/{profile_id}` removes the block only; nothing else is restored | Change the setting | `POST /v1/me/profile/resume` | `POST /v1/me/profile/reopen` |

Ending a connection (without blocking) is described in 11 section 5.

## 12. Data rights

### 12.1 Export

`POST /v1/me/exports` enqueues `build_export`. The job writes one JSON file to `exports/{user_id}/{export_id}.json`, sets the export `ready` with `expires_at = now() + 7 days`, and emails a link to `SET-ACCOUNT`, where `GET /v1/me/exports/latest` returns a presigned download URL.

| Included | Content |
|---|---|
| `users` | The member's own row except `clerk_user_id` |
| `user_consents` | All rows |
| `profiles`, `profile_family`, `profile_contacts`, `partner_preferences`, `profile_privacy` | All columns |
| `profile_identity` | `document_type`, `number_last4`, `status`, `verified_at` only |
| `profile_languages`, `profile_hobbies` | Codes |
| `profile_photos` | Status, dates and a 7-day signed URL of the large variant of each approved photo |
| `verification_requests` | Kind, status, dates, rejection reason. No images. |
| `interests` | Sent and received, with the other profile's `public_code` and display name as currently visible |
| `connections`, `connection_stage_proposals`, `contact_shares` | The member's connections, own shares |
| `messages` | Every message in the member's connections that still exists (own and received), with sender marked `me`, `them` or `system` |
| `shortlists`, `passes`, `blocks`, `saved_searches` | Own rows |
| `profile_views` | Own viewing history (`viewer_profile_id` is the member) |
| `photo_access` | Own requests and grants |
| `notifications`, `notification_preferences` | Own rows |
| `reports` | Reports the member filed: reason, details, status |
| `sanctions` | Sanctions on the member: type, reason, dates |

Not included: `match_recommendations`, `usage_counters`, reports about the member, moderator notes, `admin_audit_log`, and anything belonging to another member beyond what the app already shows.

### 12.2 Pause, close, delete

| Action | Where | Effect on visibility | Reversible |
|---|---|---|---|
| Pause | `SET-ACCOUNT` | Leaves discovery at once. Interest counterparts and connections still see the profile. Chat works. | Yes, any time |
| Close | `SET-ACCOUNT` | Leaves discovery. Pending interests expire. Connections keep the chat history; the member cannot send. | Yes (`reopen`) |
| Delete account | `SET-ACCOUNT`, `POST /v1/me/deletion` | Profile is hidden at once (`deletion_scheduled`). After 30 days the purge in 04 section 12 runs. | Within 30 days |

### 12.3 What others still see after a purge

| Place | After the purge |
|---|---|
| Lists, search, profile page | Nothing. `404`. |
| Chat list of a former connection | The connection is `ended` with `other = null`, shown as "Member no longer available" |
| Messages the member sent | "Message removed" (`body = null`, `is_deleted = true`) |
| Interests | `profile = null`, shown as "No longer available" |
| Shortlist entries pointing at the member | Deleted |
| Shared contact details | Gone |
| Photos | Objects deleted from storage; signed URLs stop working within their lifetime (at most 2 hours) |

## 13. Server implementation

### 13.1 One module

All visibility logic lives in one Rust module, `apps/api/src/visibility.rs`, made of pure functions with no database access. Handlers load the data, call these functions, and serialise the result. No handler builds a member-facing profile object by hand.

| Function | Purpose |
|---|---|
| `relation(viewer: &ViewerCtx, owner: &OwnerCtx, link: &PairLink) -> Option<Tier>` | Section 2 |
| `can_open(...) -> bool` | `relation(...).is_some()` |
| `photo_mode(owner, tier, access: Option<PhotoAccessStatus>) -> PhotoMode` | Section 6.1 |
| `display_name(owner, tier) -> String` | Section 4 |
| `group_visible(setting: FieldVisibility, tier) -> bool` | Section 5.1 |
| `render_card(owner, viewer, tier, link, scores) -> ProfileCard` | Applies sections 4, 5, 6, 9 |
| `render_detail(owner, viewer, tier, link, scores) -> ProfileDetail` | The same for the full profile, plus `locked` |
| `photo_access_state(owner, viewer, tier, access_row) -> RelationPhotoAccess` | Section 6.4 |
| `can_send_interest(sender, receiver, link, usage) -> Result<(), CannotSendReason>` | Section 7.2 |

`PairLink` carries everything about the pair, loaded in one query: block either way, active connection id, pending interest and its direction, photo access row, shortlist row, pass row, latest closed interest and ended connection (for cooldowns).

`render_detail` also accepts a forced tier (`member` or `connection`) with the owner as subject, which is how `GET /v1/me/profile/preview` (15 section 7) produces the "view as others" preview (08 section 4) with the same code that serves real viewers.

Rules for handlers:

1. Every list endpoint filters its rows through `can_open` at read time, even when the rows come from a cache (`match_recommendations`).
2. Photo keys are signed only after `photo_mode` has chosen clear or blurred.
3. WebSocket events and notifications are rendered per recipient with the same functions.

### 13.2 Test cases

Each row is one unit test. "F" is a female profile, "M" a male profile. Unless stated, both are `active`, unblocked, unrelated, with default privacy.

| # | Setup | Expected |
|---|---|---|
| 1 | M views M | `relation` is None |
| 2 | M views F, defaults | Tier `member` |
| 3 | F blocked M, M views F | None |
| 4 | M blocked F, M views F | None |
| 5 | F is `paused`, no relation | None |
| 6 | F is `paused`, active connection | `connection` |
| 7 | F is `closed`, active connection | `connection` |
| 8 | F is `closed`, M has a pending interest row (stale data) | None |
| 9 | F is `hidden`, no relation | None |
| 10 | F is `hidden`, F sent M a pending interest | `interest_from_owner` |
| 11 | F is `hidden`, M sent F a pending interest earlier | `interest_to_owner` |
| 12 | F is `preference_match`, religion is a must-have, M's religion differs | None |
| 13 | F is `preference_match`, M passes every must-have | `member` |
| 14 | F is `preference_match`, F has no must-have dimension | `member` |
| 15 | M is `married`, F's `marital_statuses` is empty | None |
| 16 | M is `married`, F's `marital_statuses` contains `married` | `member` |
| 17 | F's user is `suspended` | None |
| 18 | M's profile is `pending_review` | None |
| 19 | `name_display = first_name_last_initial`, tier `member`, name Ayesha Khan | "Ayesha K.", `locked` has `full_name` |
| 20 | Same, tier `connection` | "Ayesha Khan", `locked` has no `full_name` |
| 21 | `name_display = initials`, name Muhammad Ali Raza | "M. R." |
| 22 | `name_display = code_only`, tier `interest_from_owner` | The public code |
| 23 | `caste_visibility = connections`, caste set, tier `member` | `caste_label` null, `locked` has `caste` |
| 24 | `caste_visibility = connections`, caste not set, tier `member` | `caste_label` null, `locked` has no `caste` |
| 25 | `caste_visibility = nobody`, tier `connection` | `caste_label` null, `locked` has no `caste` |
| 26 | `income_visibility = connections`, tier `connection` | `income_band_code` present |
| 27 | `family_visibility = nobody`, `home_visibility = members`, tier `member` | `family` object present, family fields null, home fields present |
| 28 | `family_visibility = connections`, `home_visibility = connections`, tier `member` | `family` is null, `locked` has `family` and `home` |
| 29 | `about_me_status = pending` | `about_me` null for every other viewer |
| 30 | `photo_visibility = interests_and_connections`, tier `member` | Blurred, `large_url` null, `locked` has `photos` |
| 31 | Same, tier `interest_from_owner` | Clear |
| 32 | Same, tier `interest_to_owner` | Blurred |
| 33 | `photo_visibility = approved_only`, tier `connection`, no grant | Blurred |
| 34 | `photo_visibility = approved_only`, grant exists, tier `member` | Clear |
| 35 | `photo_visibility = connections`, pending request, tier `member` | `photo_access = requested` |
| 36 | Blurred, `allow_photo_requests = false` | `photo_access = requests_off` |
| 37 | Blurred, denied 10 days ago | `photo_access = denied` |
| 38 | Blurred, denied 31 days ago | `photo_access = can_request` |
| 39 | No approved photos | `photo = null`, `photo_access = visible`, not locked |
| 40 | `interest_permission = verified_only`, sender unverified | `not_permitted_by_member` |
| 41 | `interest_permission = verified_only`, sender `is_photo_verified` | Allowed |
| 42 | `interest_permission = preference_match`, sender fails a must-have, receiver already sent the sender an interest | Allowed (mutual interest) |
| 43 | Viewer `show_last_active = false`, owner shows it | `last_active` null |
| 44 | Owner `show_online_status = false`, owner online, both show last active | `last_active = today`, `is_online` null |
| 45 | Viewer `record_my_visits = false` | View stored with `is_private = true`; the viewer's visitors list is empty with `hidden_because_private` |
| 46 | Tier `connection` opens the profile | No `profile_views` row, no counter change |
| 47 | Same profile opened twice within 30 minutes | One row, `view_count = 1` |
| 48 | Daily view limit reached, new profile | `limit_reached`; a profile already viewed today still opens |
