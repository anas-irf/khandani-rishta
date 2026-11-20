# 14. Notifications

| | |
|---|---|
| Status | Design complete, not implemented |
| Related | [04-database-schema.md](04-database-schema.md) section 10, [11-interests-connections-chat.md](11-interests-connections-chat.md), [15-api-contract.md](15-api-contract.md) section 14, [19-jobs-and-realtime.md](19-jobs-and-realtime.md) for the `send_push` and `send_email` jobs and the WebSocket events |

This document defines every notification the product sends, through which channel, with what content, and how members control it.

## 1. Channels and principles

### 1.1 Channels

| Channel | Platforms | What it is | Stored |
|---|---|---|---|
| In-app feed | Web, Android | Rows of `notifications`, listed on `APP-NOTIFS` through `GET /v1/notifications` | 90 days |
| Live events | Web, Android while the app is open | WebSocket events (19 section 4) that update the open screens and badges at once | No |
| Push | Android only | Firebase Cloud Messaging data messages, for members who are not in the app | No |
| Email | Everyone with an email address | Sent through Resend | No |

There is no web push and no SMS at launch. A member who uses only the web app is reached by the in-app feed and by email.

### 1.2 Principles

1. **The feed is the record.** Push and email are pointers that bring the member back. Anything a push says can also be found in the app.
2. **Chat is separate.** New chat messages never create feed rows. They are tracked by unread counts and shown as a badge on the Chats tab.
3. **Text is rendered on the client.** The API sends `type` and `data`; the client builds the sentence from its i18n catalogue. This keeps Urdu possible later without server changes. The only server-rendered text is email.
4. **Nothing private on a lock screen.** A push never contains a message body, a name or a photo. Phones are often shared within a family.
5. **Rejections are silent.** Declining an interest, withdrawing one, an expiry, a denied photo request, a pass, a block and an ended connection never notify the other member.
6. **Members are in control.** Each kind of push and email has a preference (section 6). Account notices (moderation results, warnings) are always delivered.
7. **Stay inside the free tier.** Email is limited to 100 a day, with a strict priority order (section 5.2).
8. **One helper.** All notifications are created by one function, `notify(...)` (section 7.1), so the rules below are applied in one place.

## 2. Event catalogue

"Pref" names the `notification_preferences` column that switches the push or the email off. "Always" means no preference applies.

| # | Event | Notified | `notifications.type` | WebSocket events | Push | Email | Pref (push / email) |
|---|---|---|---|---|---|---|---|
| 1 | Interest received | Receiver | `interest_received` | `interest.received`, `notification.new`, `counters` | Yes | Daily digest | `push_interests` / `email_interests` |
| 2 | Pending interest expires in 3 days | Receiver | `interest_received` with `reminder: true` | `notification.new` | Yes | No | `push_interests` |
| 3 | Interest accepted (including mutual interest) | Sender | `interest_accepted` | `interest.accepted`, `connection.updated`, `notification.new`, `counters` | Yes | Yes | `push_interests` / `email_interests` |
| 4 | Interest declined | Nobody | None | None | No | No | |
| 5 | Interest withdrawn or expired | Nobody | None (the receiver's `interest_received` row is deleted on withdrawal) | `counters` to the receiver | No | No | |
| 6 | New chat message | Other member | None | `message.new`, `counters` | Yes, when the member has no open socket and has not muted the chat | Delayed "unread messages" email | `push_messages` / `email_messages` |
| 7 | Photo access requested | Owner | `photo_request_received` | `notification.new`, `counters` | Yes | No | `push_photo_requests` |
| 8 | Photo access granted | Viewer | `photo_request_granted` | `notification.new` | Yes | No | `push_photo_requests` |
| 9 | Photo access denied or revoked | Nobody | None | None | No | No | |
| 10 | Contact details shared | Other member | `contact_shared` | `connection.updated`, `notification.new` | Yes | No | `push_messages` |
| 11 | Contact share revoked | Nobody | None | `connection.updated` | No | No | |
| 12 | Stage proposed | Other member | `stage_proposed` | `connection.updated`, `notification.new` | Yes | No | `push_messages` |
| 13 | Stage confirmed | Proposer | `stage_confirmed` | `connection.updated`, `notification.new` | Yes | No | `push_messages` |
| 14 | Stage declined or proposal cancelled | Nobody | None | `connection.updated` | No | No | |
| 15 | Connection ended | Nobody | None | `connection.updated`, `counters` | No | No | |
| 16 | Profile approved by a moderator | Owner | `profile_approved` | `gate.changed`, `notification.new` | Yes | Yes (`welcome`) | Always |
| 17 | Profile activated automatically at the end of onboarding | Owner | None | None | No | Yes (`welcome`) | Always |
| 18 | Profile changes requested | Owner | `profile_changes_requested` | `gate.changed`, `notification.new` | Yes | Yes | Always |
| 19 | Photo approved after manual review | Owner | `photo_approved` | `photo.updated`, `notification.new` | No | No | |
| 20 | Photo approved automatically | Owner | None | `photo.updated` | No | No | |
| 21 | Photo rejected | Owner | `photo_rejected` | `photo.updated`, `notification.new` | Yes | No | Always |
| 22 | Profile text rejected | Owner | `text_rejected` | `notification.new` | Yes | No | Always |
| 23 | Verification approved | Owner | `verification_approved` | `notification.new` | Yes | Yes | Always |
| 24 | Verification rejected | Owner | `verification_rejected` | `notification.new` | Yes | Yes | Always |
| 25 | New matches after the nightly refresh | Member | `new_matches` with `source: "recommendations"` | `notification.new` | Yes | Match digest (separate schedule) | `push_matches` / `email_match_digest` |
| 26 | Saved search has new profiles | Member | `new_matches` with `source: "saved_search"` | `notification.new` | Yes | No | `push_matches` |
| 27 | Daily profile views | Member | `profile_views_summary` | `notification.new` | Yes | No | `push_profile_views` |
| 28 | Warning issued | User | `account_warning` | `notification.new` | Yes | Yes | Always |
| 29 | Suspended or banned | User | None (the gate screen explains) | `gate.changed`, then the socket is closed | No | Yes | Always |
| 30 | Suspension lifted | User | None | None | No | Yes | Always |
| 31 | Announcement | Every `active` user with an `active` or `paused` profile | `announcement` | `notification.new` | Yes | Only while the daily budget allows | Always / `email_announcements` |
| 32 | Account deletion scheduled or cancelled | User | None | `gate.changed` | No | Yes | Always |
| 33 | Data export ready | User | None | None | No | Yes | Always |

Every row that creates a feed row also sends `counters` when the unread total changes.

## 3. Data shapes per type

`GET /v1/notifications` returns each row as `{ id, type, actor, data, is_read, created_at }` (15 section 14). `actor` is `{ profile_id, display_name, photo }` rendered for the recipient under 09 sections 4 and 6, or `null` for system notifications.

In the texts below, `{actor}` is `actor.display_name`. "Target" is the screen opened when the member taps the notification.

| `type` | `actor` | `data` | English text | Target |
|---|---|---|---|---|
| `interest_received` | The sender | `{ "interest_id": "<uuid>", "reminder": false, "count": 1 }` | {actor} sent you an interest. | `APP-PROFILE` of the actor (shows Accept and Decline) |
| `interest_received` (reminder) | The sender of the earliest expiring interest | `{ "interest_id": "<uuid>", "reminder": true, "count": 3 }` | `count = 1`: An interest from {actor} expires in 3 days. `count > 1`: {count} interests expire in 3 days. | `APP-INTERESTS`, Received, New |
| `interest_accepted` | The member who accepted | `{ "interest_id": "<uuid>", "connection_id": "<uuid>" }` | {actor} accepted your interest. You can chat now. | `APP-CHAT` for `connection_id` |
| `photo_request_received` | The requester | `{ "photo_access_id": "<uuid>" }` | {actor} asked to see your photos. | `APP-PHOTO-REQUESTS` |
| `photo_request_granted` | The owner | `{ "photo_access_id": "<uuid>" }` | {actor} shared their photos with you. | `APP-PROFILE` of the actor |
| `contact_shared` | The sharer | `{ "connection_id": "<uuid>" }` | {actor} shared contact details with you. | `APP-CONNECTION` for `connection_id` |
| `stage_proposed` | The proposer | `{ "connection_id": "<uuid>", "proposal_id": "<uuid>", "stage": "families_talking" }` | {actor} suggests the next step: {stage text}. | `APP-CONNECTION` |
| `stage_confirmed` | The confirmer | `{ "connection_id": "<uuid>", "stage": "engaged" }` | {actor} confirmed: {stage text}. | `APP-CONNECTION` |
| `profile_approved` | `null` | `{}` | Your profile is live. Members can now find you. | `APP-HOME` |
| `profile_changes_requested` | `null` | `{ "reason": "<moderator text>" }` | Your profile needs a few changes before it can go live. | `GATE-CHANGES` |
| `photo_approved` | `null` | `{ "photo_id": "<uuid>" }` | Your photo was approved. | `ME-PHOTOS` |
| `photo_rejected` | `null` | `{ "photo_id": "<uuid>", "rejection_reason": "face_not_visible" }` | A photo was not approved: {reason text}. | `ME-PHOTOS` |
| `text_rejected` | `null` | `{ "field": "about_me", "note": null }` (`field` is `about_me`, `about_family` or `partner_notes`; `note` is the moderator's optional note, shown under the text when set) | Part of your profile text was not approved. Please edit it. | `ME-EDIT` for the section (`ME-PREFS` for `partner_notes`) |
| `verification_approved` | `null` | `{ "request_id": "<uuid>", "kind": "id_document" }` | `id_document`: Your ID is verified. `selfie`: Your photo is verified. | `ME-VERIFY` |
| `verification_rejected` | `null` | `{ "request_id": "<uuid>", "kind": "selfie", "rejection_reason": "face_mismatch" }` | Your verification could not be approved: {reason text}. | `ME-VERIFY` |
| `new_matches` | `null` | `{ "source": "recommendations", "count": 4, "saved_search_id": null }` | You have {count} new matches. | `APP-MATCHES` |
| `new_matches` (saved search) | `null` | `{ "source": "saved_search", "count": 2, "saved_search_id": "<uuid>", "saved_search_name": "Lahore doctors" }` | {count} new profiles match your saved search "{saved_search_name}". | `APP-SEARCH` with that saved search applied |
| `profile_views_summary` | `null` | `{ "count": 7 }` | {count} people viewed your profile today. | `APP-VISITORS` |
| `account_warning` | `null` | `{ "sanction_id": "<uuid>", "reason": "<moderator text>" }` | A notice about your account: {reason}. | `PUB-GUIDELINES` |
| `announcement` | `null` | `{ "text_en": "...", "text_ur": null, "url": null }` (the body of `POST /v1/admin/announcements`, 18 section 7) | {text}, in the member's language with English as fallback | `url` when set, otherwise none |

Rules:

1. Stage texts are those of 11 section 9.1. Rejection reason texts come from the option lists `photo_rejection_reason` and `verification_rejection_reason` (05 section 2).
2. Every `data` object may gain keys later. Clients ignore unknown keys and render an unknown `type` as "You have a new notification" with no target.
3. All ids in `data` are strings. `count` is a number.

## 4. Android push

### 4.1 What is sent

Pushes are FCM **data messages** (no `notification` block), so the app always builds the visible notification itself, in the device language, and can decide not to show one. They are sent by the `send_push` job (19 section 2) through the FCM HTTP v1 API using the service account token from `gcp_auth`.

```json
{
  "message": {
    "token": "<user_devices.push_token>",
    "android": { "priority": "high", "collapse_key": "msg_0193a2c4", "ttl": "86400s" },
    "data": {
      "type": "message",
      "target": "APP-CHAT",
      "connection_id": "0193a2c4-...",
      "notification_id": "",
      "count": "1",
      "sent_at": "2026-11-20T10:15:00Z"
    }
  }
}
```

Rules for `data`:

1. All values are strings (an FCM requirement). Empty string means "not applicable".
2. Allowed keys: `type`, `target`, `notification_id`, `connection_id`, `interest_id`, `profile_id`, `saved_search_id`, `field`, `count`, `stage`, `sent_at`. Nothing else. (`saved_search_id` lets a saved-search alert open that search; `field` lets `text_rejected` open the right edit section.)
3. **Never** a message body, a display name, a photo URL, a moderator reason, or an announcement text. The app fetches details after it is opened.
4. `type` is a `notifications.type` value, or `message` for chat.

### 4.2 Channels, texts and collapsing

Android notification channels are created at first start. The title is always the app name. The body is a fixed string from the app's resources.

| Push `type` | Channel id | Body (English) | Collapse key and Android tag | TTL |
|---|---|---|---|---|
| `message` | `messages` (high importance) | You have a new message | `msg_<connection_id>` | 1 day |
| `interest_received` | `interests` (high) | You have received a new interest | `interest` | 3 days |
| `interest_received` with reminder | `interests` | An interest is waiting for your answer | `interest_reminder` | 1 day |
| `interest_accepted` | `interests` | Your interest was accepted | `accepted_<connection_id>` | 3 days |
| `photo_request_received` | `activity` (default importance) | A member asked to see your photos | `photo_request` | 3 days |
| `photo_request_granted` | `activity` | A member shared their photos with you | `photo_granted` | 3 days |
| `contact_shared` | `activity` | A connection shared contact details with you | `contact_<connection_id>` | 3 days |
| `stage_proposed` | `activity` | A connection suggested the next step | `stage_<connection_id>` | 3 days |
| `stage_confirmed` | `activity` | Your suggestion was confirmed | `stage_<connection_id>` | 3 days |
| `new_matches` | `activity` | You have new matches | `matches` | 1 day |
| `profile_views_summary` | `activity` | People viewed your profile today | `views` | 1 day |
| `profile_approved` | `account` (high) | Your profile is live | `account` | 3 days |
| `profile_changes_requested` | `account` | Your profile needs a few changes | `account` | 3 days |
| `photo_rejected` | `account` | A photo was not approved | `account_photo` | 3 days |
| `text_rejected` | `account` | Part of your profile text was not approved | `account_text` | 3 days |
| `verification_approved` | `account` | Your verification was approved | `account_verify` | 3 days |
| `verification_rejected` | `account` | Your verification was not approved | `account_verify` | 3 days |
| `account_warning` | `account` | Important notice about your account | `account_warning` | 3 days |
| `announcement` | `account` | News from Khandani Rishta | `announcement` | 1 day |

A newer push with the same collapse key replaces the older one, both in FCM's queue and on the device (same tag). So ten messages in one chat show as one notification.

### 4.3 Chat pushes

1. When a message is created and the recipient has no open socket, enqueue `send_push` with `dedupe_key = "msg:<connection_id>:<recipient user_id>"` and `run_at = now() + 10 seconds`. While a job with that key is queued, further messages add nothing.
2. When the job runs it sends only if: `push_messages` is true, the connection is `active` and not muted for the recipient, the recipient's `unread_count` for it is greater than 0, and the recipient still has no open socket.
3. The app, on receiving a `message` push while a socket is open (a race), shows nothing.

### 4.4 Token lifecycle

| Moment | Action |
|---|---|
| After sign-in and on every app start with a session | Get the FCM token and call `POST /v1/me/devices` |
| `onNewToken` callback | Call `POST /v1/me/devices` with the new token |
| Sign-out | Call `DELETE /v1/me/devices/{push_token}` before clearing the session |
| Same phone, another account signs in | `POST /v1/me/devices` moves the token to the new user (upsert on `push_token`) |
| FCM answers `404 UNREGISTERED` or `400 INVALID_ARGUMENT` for a token | The job deletes that `user_devices` row |
| FCM answers `429` or `5xx` | The job fails and is retried with backoff |
| Token not seen for 90 days (`last_seen_at`) | Deleted by `cleanup_old_rows` |
| Account purged | All device rows of the user are deleted (04 section 12). A suspended or banned user keeps the rows: `send_push` skips users who are not `active` (19 section 2.6), and the device signal of 13 section 9 needs them. |

A user may have several devices. The job sends to each. Devices without Google Play services get no push; the in-app feed and email still work.

### 4.5 Tapping a push

The app opens the screen named in `target`, passing `connection_id`, `interest_id` or `profile_id`. If the session has expired, it opens `AUTH-SIGNIN` first and continues to the target afterwards. Opening the app clears its system notifications for the screen being shown. The mapping from screen IDs to Android destinations is in 22.

## 5. Email

### 5.1 Sending

Emails are sent by the `send_email` job through the Resend API. Sender: `Khandani Rishta <no-reply@khandanirishta.app>`, with `Reply-To` set to `support.email`. Emails are plain, mobile-friendly HTML with a text alternative, in English at launch. They contain no photos and no chat content. Names are display names rendered for the recipient (09 section 4). Every email ends with the support address and, for the optional kinds, a "Change email preferences" link to `SET-NOTIFS`.

An email is sent only when `users.email` is set. Emails to an address that hard-bounces twice stop: the job records the bounce and skips that user until the address changes.

### 5.2 Daily budget and priority

Resend's free tier allows 100 emails a day and 3,000 a month. Keeping to at most 95 a day also keeps the month under 3,000.

Each `send_email` job has a `priority` from 1 (most important) to 6. Before sending, the job counts emails already sent in the current UTC day:

```sql
SELECT count(*) FROM jobs
WHERE kind = 'send_email' AND status = 'succeeded' AND last_error IS NULL
  AND finished_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
```

It sends only if the count is below the ceiling for its priority:

| Priority | Kinds | Ceiling | When over the ceiling |
|---|---|---|---|
| 1 | Account and moderation: suspension, ban, warning, deletion, export ready, changes requested, verification result | 95 | Rescheduled to the next UTC midnight plus a random 0 to 30 minutes |
| 2 | `welcome`, `interest_accepted` | 85 | Rescheduled the same way, once; dropped the second time |
| 3 | `interest_digest` | 70 | Dropped |
| 4 | `unread_messages` | 55 | Dropped |
| 5 | `match_digest` | 45 | Dropped |
| 6 | `announcement` | 25 | Dropped |

"Dropped" means the job finishes as `succeeded` with `last_error = 'skipped:budget'`, so it is not counted as sent. The in-app notification is unaffected. What is dropped first, in order: announcements, match digests, unread-message emails, interest digests.

If Resend itself answers with a rate-limit error, the job is retried under the normal backoff.

### 5.3 Templates

| Template | Priority | Trigger | Subject | Content outline |
|---|---|---|---|---|
| `account_suspended` | 1 | Suspension, ban, or suspension lifted | "Your Khandani Rishta account has been suspended" / "...has been closed" / "...is active again" | The reason shown to the user, the end date for a suspension, how to contact support |
| `account_warning` | 1 | Warning sanction | "A notice about your Khandani Rishta account" | The reason, a link to the community guidelines |
| `account_deletion` | 1 | Deletion scheduled or cancelled | "Your account will be deleted on {date}" / "Your account deletion was cancelled" | The purge date, how to cancel by signing in |
| `export_ready` | 1 | Export becomes `ready` | "Your data export is ready" | Link to `SET-ACCOUNT`; available for 7 days |
| `profile_changes_requested` | 1 | Moderator requests changes | "Your profile needs a few changes" | The moderator's reason, link to fix |
| `verification_result` | 1 | Verification approved or rejected | "Your verification was approved" / "We could not approve your verification" | What was checked, the rejection reason, link to try again |
| `welcome` | 2 | Profile becomes `active` for the first time | "Your profile is live" | Three next steps: add photos, verify, review preferences; the safety tips |
| `interest_accepted` | 2 | Interest accepted, when `email_interests` is true | "{name} accepted your interest" | One line and a button to the chat |
| `interest_digest` | 3 | Daily, when new interests arrived and `email_interests` is true | "You have {count} new interests" | Up to 5 senders (display name, age, city), a button to `APP-INTERESTS` |
| `unread_messages` | 4 | Unread chat older than 3 hours, when `email_messages` is true | "You have unread messages" | The number of chats with unread messages. No names, no content. |
| `match_digest` | 5 | Per `email_match_digest` (`daily` or `weekly`) | "New matches for you" | Up to 5 matches (display name, age, city, match percentage), a button to `APP-MATCHES` |
| `announcement` | 6 | Admin announcement, when `email_announcements` is true | "News from Khandani Rishta" | The announcement text and its link |

### 5.4 Batching rules

| Email | How it is batched |
|---|---|
| `interest_digest` | When an interest is received, enqueue `send_email` with `dedupe_key = "interest_digest:<user_id>"` and `run_at` = the next 18:00 `Asia/Karachi`. At run time, count the user's pending received interests created in the last 24 hours whose sender can still be opened. Skip when the count is 0 or `email_interests` is false. At most one a day per user. |
| `unread_messages` | When a message is created for an offline recipient, enqueue with `dedupe_key = "unread:<user_id>"` and `run_at = now() + 3 hours`. At run time skip when: `email_messages` is false; the user's `last_seen_at` is later than the job's `created_at`; no active, unmuted connection has unread messages; or an `unread_messages` email was sent to the user in the last 24 hours. |
| `match_digest` | The scheduled `match_digest` job (daily 09:00, and Sundays 10:00 `Asia/Karachi` for weekly) enqueues one email per user who chose that frequency, has an `active` profile, and has at least 3 cached recommendations with `shown_count = 0`. The email lists the top 5 of those by `rank_score`. |
| `announcement` | `announcement_fanout` enqueues emails in user id order until the priority 6 ceiling stops them. It does not resume the next day. |

### 5.5 Unsubscribing

Optional emails (priorities 3 to 6 and `interest_accepted`) link to `SET-NOTIFS`, where each kind has its own switch (section 6). Account emails cannot be switched off.

Open point: a one-click unsubscribe link that works without signing in needs a public endpoint with a signed token, which 15 does not define yet. Until it exists, the link opens `SET-NOTIFS` after sign-in.

## 6. Preferences and quiet hours

### 6.1 Preference columns

`SET-NOTIFS` edits `notification_preferences` through `PUT /v1/me/notification-preferences`. One row is created with defaults when the user is created.

| Column | Default | Label on `SET-NOTIFS` | Controls |
|---|---|---|---|
| `push_interests` | true | Interests | Push for events 1, 2, 3 |
| `push_messages` | true | Messages and connection updates | Push for events 6, 10, 12, 13 |
| `push_photo_requests` | true | Photo requests | Push for events 7, 8 |
| `push_profile_views` | false | Profile views | Push for event 27 |
| `push_matches` | true | New matches | Push for events 25, 26 |
| `email_interests` | true | Interests | `interest_digest`, `interest_accepted` |
| `email_messages` | false | Unread messages | `unread_messages` |
| `email_match_digest` | `weekly` | Match digest: Off, Daily, Weekly | `match_digest` |
| `email_announcements` | true | News and announcements | `announcement` email |
| `quiet_hours_start`, `quiet_hours_end` | null | Quiet hours | Section 6.2 |

Preferences never stop the in-app feed row or the WebSocket events. They only stop the push or the email. On the web app the push switches are shown with the note "Push notifications are available in the Android app."

On Android the member can also mute each system channel (`messages`, `interests`, `activity`, `account`) in the phone's settings; the app respects that automatically.

### 6.2 Quiet hours

1. `quiet_hours_start` and `quiet_hours_end` are local times in `users.timezone`. Both are set or both are null. When `start > end` the window crosses midnight (for example 23:00 to 07:00).
2. When `send_push` runs inside the window, it does not send. It reschedules itself to the end of the window (`run_at` = next occurrence of `quiet_hours_end`). Pushes of the same kind that were held this way collapse into one on the device through the FCM collapse key (section 4.2).
3. Quiet hours apply to every push type, including account notices.
4. Email, the in-app feed and WebSocket events are not affected.

## 7. Delivery rules

### 7.1 The `notify` helper

All feed notifications go through one function:

```text
notify(recipient_user_id, type, actor_profile_id: Option, data: Json)
```

Called after the transaction that caused the event has committed. Steps:

1. If `actor_profile_id` is set and the actor cannot be opened by the recipient (09 section 2: a block, a hidden or suspended profile), stop. Nothing is created.
2. Apply the duplicate rule for the type (7.2). Stop if a duplicate exists.
3. Insert the `notifications` row.
4. Send `notification.new` and `counters` to the recipient's sockets.
5. If the catalogue (section 2) has push for this event and the preference allows it, enqueue `send_push`.
6. If the catalogue has an email for this event, enqueue `send_email` with the template, priority and dedupe key of section 5.

### 7.2 Duplicates and collapsing

| Type | Rule |
|---|---|
| `interest_received` | One row per interest. Reminder: one row per recipient per day, carrying the count. |
| `interest_accepted` | One per interest |
| `photo_request_received` | One per request. A new request after the retry period creates a new row. |
| `photo_request_granted` | One per grant; a re-grant within 24 hours creates nothing |
| `contact_shared` | One per connection and sharer per 24 hours |
| `stage_proposed`, `stage_confirmed` | One per proposal |
| `new_matches` | At most one per `source` (and per saved search) every 20 hours |
| `profile_views_summary` | At most one per day |
| `photo_approved`, `photo_rejected`, `text_rejected`, `verification_*`, `profile_*`, `account_warning` | One per decision |
| `announcement` | One per user per announcement |

### 7.3 Other rules

1. **Never notify the actor.** A member is not notified about their own action.
2. **Blocks clean up.** When a block is created, delete `notifications` rows of each of the two users whose `actor_profile_id` is the other profile.
3. **Read-time filter.** `GET /v1/notifications` leaves out rows whose actor can no longer be opened by the caller.
4. **Withdrawal cleans up.** Withdrawing an interest deletes the receiver's `interest_received` row for it.
5. **Profile status.** A `paused` profile receives everything. A `closed` profile receives account notices and events on its existing connections. A suspended or banned user receives only email.
6. **Read state.** `APP-NOTIFS` calls `POST /v1/notifications/read` with the ids that became visible. Tapping a row marks it read first, then navigates. "Mark all as read" sends `{ "all": true }`.
7. **Retention.** Rows older than 90 days are deleted by `cleanup_old_rows`.
8. **Order.** The feed is ordered by `created_at` descending. Ids are UUIDv7, so id order is the same.
9. **Failure isolation.** A failing push or email never rolls back the event that caused it; it is retried by the job system or dropped.

## 8. Badges and counters

### 8.1 Definitions

`Me.counters` (15 section 4.2):

| Counter | Definition | Shown on |
|---|---|---|
| `unread_chats` | Number of the member's `active` connections that are not muted and have `unread_count > 0` | Chats tab badge |
| `pending_interests` | Received interests with `status = 'pending'` whose sender can still be opened | Interests tab badge |
| `pending_photo_requests` | `photo_access` rows with the member as owner and `status = 'pending'` | Entry to `APP-PHOTO-REQUESTS` |
| `unread_notifications` | `notifications` rows of the user with `read_at IS NULL` | Bell icon |

`unread_chats` counts conversations, not messages. The number of unread messages in one conversation is `Connection.unread_count` on its row.

One query computes all four:

```sql
SELECT
  (SELECT count(*)
     FROM connection_members m
     JOIN connections k ON k.id = m.connection_id
    WHERE m.profile_id = $1 AND k.status = 'active' AND NOT m.is_muted AND m.unread_count > 0) AS unread_chats,
  (SELECT count(*)
     FROM interests i
     JOIN profiles s ON s.id = i.sender_profile_id
     JOIN users su ON su.id = s.user_id
    WHERE i.receiver_profile_id = $1 AND i.status = 'pending'
      AND s.status IN ('active', 'paused') AND su.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM blocks b
                       WHERE (b.blocker_profile_id = $1 AND b.blocked_profile_id = s.id)
                          OR (b.blocker_profile_id = s.id AND b.blocked_profile_id = $1))) AS pending_interests,
  (SELECT count(*) FROM photo_access a
    WHERE a.owner_profile_id = $1 AND a.status = 'pending') AS pending_photo_requests,
  (SELECT count(*) FROM notifications n
    WHERE n.user_id = $2 AND n.read_at IS NULL) AS unread_notifications;
```

`$1` is the profile id, `$2` the user id.

### 8.2 When they are recomputed

Counters are never stored. They are computed on demand for `GET /v1/me` and for the WebSocket `ready` frame, and pushed with a `counters` event to the affected user after each of these:

| Event | Counter affected | Sent to |
|---|---|---|
| Message created | `unread_chats` | Recipient |
| `POST /v1/connections/{id}/read` | `unread_chats` | The reader (all their sockets) |
| Mute or unmute | `unread_chats` | The member |
| Connection ended | `unread_chats` | Both |
| Interest received, accepted, declined, withdrawn, expired | `pending_interests` | Receiver |
| Photo request created, granted, denied | `pending_photo_requests` | Owner |
| Block created | All | Both |
| Notification created | `unread_notifications` | Recipient |
| `POST /v1/notifications/read` | `unread_notifications` | The reader |

The `counters` event carries the full object, so clients replace their copy and never add or subtract locally.

### 8.3 Client behaviour

1. Keep `Me` in one cache entry. Replace `counters` when a `counters` event or a fresh `GET /v1/me` arrives.
2. Without a socket, refetch `GET /v1/me` every 60 seconds while the app is visible, and when it returns to the foreground.
3. Android launcher badge: `unread_chats + pending_interests`.
4. Show "99+" above 99.
