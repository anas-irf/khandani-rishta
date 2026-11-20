# 21. Implementation Roadmap

| | |
|---|---|
| Status | Plan, nothing implemented yet |
| Related | Every other document. [README.md](README.md) lists them. |

The order in which to build the product, as small tasks. Each task says what to read, what to build and how to know it is done. Tasks are sized so that one task is one pull request.

## 1. Working rules for the implementer

1. **Follow the order.** A task may rely on every task before it. Do not start a phase before the previous phase's tasks are merged, except where a task says it can run in parallel.
2. **Read before writing.** Open the documents listed under "Read" and follow them literally. If two documents disagree, the precedence is: 04 (schema) for names and allowed values, 03 for states and limits, 15 for endpoints and payloads, then the feature document.
3. **Never invent names.** Table, column, enum value, endpoint, error code, setting key, job kind, event name and screen ID all come from the documents. If something is missing, stop and ask; do not guess.
4. **One task, one pull request**, on a branch, with tests. Do not commit to `main` directly. Commit messages are imperative with a body that explains why.
5. **Keep the contract in step.** After changing routes, regenerate `packages/api-contract/openapi.json` and the TypeScript client (commands in the root README). CI fails otherwise.
6. **Migrations are append-only.** Never edit a merged migration.
7. **Web and Android stay in parity.** A screen is done on a platform only when it matches 16. Android tasks may trail the matching web task, never lead it.
8. **Definition of done:** 20 section 11 applies to every task.
9. **No scope creep.** Features marked "later" anywhere in the documents are not built until section 9 of this document says so.

## 2. API source layout

Create this structure in the first tasks and keep to it. Existing files stay where they are.

```text
apps/api/src/
├── main.rs, config.rs, state.rs, telemetry.rs, openapi.rs    (exist)
├── error.rs                 ApiError and its JSON response (15 section 2)
├── settings.rs              app_settings accessor with coded defaults (03 section 7)
├── reference.rs             in-memory reference data cache
├── auth/
│   ├── jwks.rs              Clerk key set cache
│   ├── token.rs             token verification (06 section 6)
│   ├── extractors.rs        access levels (15 section 3)
│   └── provisioning.rs      first-request user creation (06 section 5)
├── models/                  request and response types (serde, utoipa ToSchema), one file per area
├── routes/                  HTTP handlers, one file per row of 15 section 17
├── domain/                  pure logic, no database or network access
│   ├── gate.rs              03 section 5.1
│   ├── visibility.rs        09 section 13
│   ├── matching/            dimensions.rs, fit.rs, rank.rs, reasons.rs (10)
│   ├── text_rules.rs        13 section 3
│   ├── chat_safety.rs       13 section 5
│   ├── identity_number.rs   12 section 3
│   ├── completeness.rs      08 section 6
│   ├── preference_defaults.rs   07 section 12
│   └── display.rs           display name, age, last-active label (09 section 4; 03 section 6)
├── db/                      SQL, one file per aggregate (users, profiles, photos, interests, connections, messages, relations, notifications, reference, settings, jobs, admin)
├── services/                clerk.rs, r2.rs, content_safety.rs, resend.rs, fcm.rs, crypto.rs
├── jobs/                    worker.rs, scheduler.rs, and one file per job kind (19)
└── realtime/                hub.rs, protocol.rs, ws.rs (the socket session loop; 19 sections 4 to 6). The thin upgrade handler for GET /v1/ws is routes/ws.rs (15 section 17)
```

Rules: handlers in `routes/` are thin (extract, call `db` and `domain`, map to a model). Everything in `domain/` is pure and unit-tested. Only `db/` contains SQL. Only `services/` makes outbound HTTP calls.

## 3. Phase 0: foundations

Goal: a signed-in user reaches the first onboarding screen on both clients, with nothing behind it yet.

| Task | Read | Build | Done when |
|---|---|---|---|
| **T-001 Error format** | 15 sections 1 and 2 | `error.rs`: `ApiError` enum with every code, `IntoResponse` producing the JSON body with `request_id`; JSON extractor that rejects unknown fields and maps parse errors to `bad_request`; 64 KB body limit | Unit tests show the exact body for `validation_failed` with fields and for `not_found`. A malformed body returns `400 bad_request`. |
| **T-002 Schema migrations** | 04 sections 1 to 11 | Migrations `0001` to `0010` exactly as written, with the `updated_at` trigger on every table that has the column | Migrations apply to an empty PostgreSQL 18 database. A test inserts a `draft` profile and fails to set it `active` with required fields missing. |
| **T-003 Reference seed** | 05 | Migration `0011_seed_reference_data.sql`; the script `scripts/build-geo-seed.mjs`; migration `0012_seed_geography.sql` generated by it | Row counts match 05. Every code used in a `CHECK` constraint has a label in the option lists. |
| **T-004 Settings accessor** | 03 section 7 | `settings.rs` with a typed getter per key, defaults in code, 60-second cache; seed the defaults | Unit test: missing key returns the default; changed row is seen after cache expiry |
| **T-005 Reference API** | 15 section 5; 05 section 1 | `reference.rs` cache loaded at start; `GET /v1/reference/bootstrap` with `ETag`; regions and cities endpoints; `GET /v1/meta/app-release` | `If-None-Match` returns `304`. City search for "lah" in `PK` returns Lahore first. |
| **T-006 Token verification** | 06 sections 6 and 13 | `auth/jwks.rs`, `auth/token.rs`, config additions | Tests with a locally generated key pair: valid token accepted; expired, wrong issuer, wrong `azp`, bad signature and `sts = pending` refused |
| **T-007 Provisioning, gate and `GET /v1/me`** | 06 section 5; 03 sections 5 and 6; 15 sections 3, 4.2 and 6 | `services/clerk.rs` (get user), `auth/provisioning.rs`, `auth/extractors.rs` for every access level, `domain/gate.rs`, `GET /v1/me`, `PATCH /v1/me`, `POST /v1/me/consents` | First call creates the four rows; a second concurrent call does not duplicate. Gate unit tests cover every row of 03 section 5.1. Each access level has a refusal test. |
| **T-008 Job system** | 19 sections 1 to 3 | `jobs/worker.rs`, `jobs/scheduler.rs`, enqueue helper, started from `main.rs` | A test job runs once, retries on failure with backoff, and becomes `dead` after `max_attempts` |
| **T-009 Clerk webhook** | 06 section 7; 19 section 2 (`sync_clerk_user`) | `POST /webhooks/clerk` with signature check, deduplication, the three events, and the `sync_clerk_user` job they enqueue | Replaying the same delivery changes nothing. A bad signature returns `400`. |
| **T-010 Web foundation** | 17 sections 1 to 6, 8.4, 9, 12, 15 | Clerk provider and middleware, `/sign-in/$`, the route skeleton with placeholder screens, `AuthGate` and `lib/gate.ts`, API client middleware, `QueryClient` and error handling, reference hooks, i18n setup, design tokens, app shell | `lib/gate.ts` tests cover every row of 17 section 4.2. Signing in with a new account lands on `/onboarding/account-for`. |
| **T-011 Android foundation** | 22 sections 1 to 6, 12, 14 | Clerk setup and `AuthView`, generated API client, interceptors, `ErrorMapper`, `MeRepository`, `GateRouter`, navigation keys with placeholder screens, theme | `GateRouter` tests cover every gate. Signing in with a new account shows the first onboarding step placeholder. |

T-010 and T-011 can run in parallel with T-008 and T-009 once T-007 is merged.

## 4. Phase 1: onboarding and own profile

Goal: a member completes onboarding on both clients and manages their own profile, photos, preferences and privacy.

| Task | Read | Build | Done when |
|---|---|---|---|
| **T-101 Text rules** | 13 section 3 | `domain/text_rules.rs` (synchronous validators only) | Every test string in 13 section 3 gives the expected result |
| **T-102 Profile sections** | 15 sections 4.3 and 7; 07 sections 3 to 9 and 16; 08 sections 2 and 3; 03 section 8 rule 15 | `GET /v1/me/profile`, `PUT /v1/me/profile/sections/{section}` for all eight sections with validation, locked fields, caste suggestions upsert, `match_stale`, text status handling (set `pending`, enqueue `moderate_text` as a no-op job for now) | Each section has tests for a valid body, each validation rule, and clearing a required field after leaving `draft` |
| **T-103 Completeness** | 08 section 6 | `domain/completeness.rs`, called after every profile write | The two worked examples in 08 section 6 produce the stated numbers |
| **T-104 Preferences and privacy** | 15 sections 4.5 and 7; 07 sections 11 and 12; 09 section 3 | `domain/preference_defaults.rs`; `GET` and `PUT /v1/me/preferences`; `GET` and `PATCH /v1/me/privacy`; the female default from 09 | Defaults match 07 section 12 for a male and a female example. Invalid codes and oversized arrays are refused. |
| **T-105 Identity number** | 12 sections 2 and 3; 20 section 2; 04 section 5.4 | `services/crypto.rs`, `domain/identity_number.rs`, `GET` and `PUT /v1/me/identity` | Round-trip encryption test; gender mismatch refused; a second profile with the same number gets `identity_already_registered`; CNIC and NICOP with the same digits collide |
| **T-106 Onboarding flow** | 03 section 4.3; 15 section 7; 07 sections 2 and 14 | `POST /v1/me/onboarding/continue`, `POST /v1/me/onboarding/complete`, `POST /v1/me/profile/resubmit` | A scripted run through all steps ends `active`. Continuing with a missing required field fails and names the field. An under-18 date of birth is refused. |
| **T-107 Photo storage and processing** | 08 section 5; 15 section 8; 19 section 2 (`process_photo`, `delete_objects`, `cleanup_uploads`) | `services/r2.rs` (presign put and get, head, delete), photo endpoints, `process_photo` without the moderation call (goes to `pending_review` or `approved` by the setting), URL signing | Uploading a real JPEG produces the five variants at the documented sizes. A text file renamed `.jpg` ends `failed`. The seventh photo is refused. |
| **T-108 Web onboarding** | 07; 16 (gates and onboarding pointers); 17 sections 3, 4 and 8 | Screens `ONB-01` to `ONB-11`, `ONB-DONE`, `GATE-REVIEW`, `GATE-CHANGES`, `GATE-CONSENT`, `GATE-BLOCKED`, `GATE-DELETION`, with all field components. The gate screens are built and routed now; the server actions that lead to `GATE-BLOCKED` and `GATE-DELETION` arrive in T-504 and T-506, so test them by setting the status in the database. | A new user completes onboarding in the browser. Refreshing mid-way resumes at the same step. Server validation errors appear on the right fields. |
| **T-109 Web own profile** | 08; 16 (`ME-*`, `SET-CONTACTS`) | `ME-PROFILE`, `ME-EDIT`, `ME-PHOTOS`, `ME-PREFS`, `SET-CONTACTS`. The profile preview (08 section 4) is added in T-308, once the visibility module exists. | Every section can be edited; locked fields are read-only; photo statuses update without a reload |
| **T-110 Android onboarding** | Same as T-108; 22 | The same screens on Android | Same checks on a device |
| **T-111 Android own profile** | Same as T-109; 22 section 9 | The same screens on Android, with the Photo Picker and upload progress | Same checks on a device |

## 5. Phase 2: moderation, verification and the staff console

Goal: nothing a member writes or uploads reaches other members unreviewed, and staff can run the queues. This phase comes before discovery on purpose.

| Task | Read | Build | Done when |
|---|---|---|---|
| **T-201 Automatic moderation** | 13 sections 2 to 4 and 12; 19 section 2 (`moderate_text`) | `services/content_safety.rs`; the real `moderate_text` job; the image check inside `process_photo`; quota fallback | With the service disabled, texts stay `pending` and photos go to `pending_review`. With a stub returning high severity, a photo is rejected. |
| **T-202 Staff API, queues** | 15 section 16; 18 sections 1 to 4, 8 and 9 | `GET /v1/admin/overview`; profile, photo and text queue endpoints; audit log writes | Each action changes the documented status, notifies the member (a `notifications` row) and writes one audit row. A member gets `403`. |
| **T-203 Staff console, queues** | 18 sections 2 to 4 and 9; 17 section 16 | `ADM-HOME`, `ADM-PROFILES`, `ADM-PROFILE`, `ADM-PHOTOS`, `ADM-TEXTS` with keyboard shortcuts; the first-admin SQL in the runbook | A moderator approves and rejects photos from the queue by keyboard |
| **T-204 Verification** | 12; 15 section 9; 18 section 4 | Member endpoints (challenge, uploads, submit, cancel); staff review endpoints with decrypted number and signed image URLs; `purge_verification_media` job | Approving an identity request sets the badge and locks the names. Viewing a request writes `verification.view`. Images are gone after the retention period in a test with a shortened setting. |
| **T-205 Verification screens** | 12 section 8; 16 (`ME-VERIFY*`); 18 (`ADM-VERIFICATION*`); 22 section 9 | `ME-VERIFY`, `ME-VERIFY-ID`, `ME-VERIFY-SELFIE` on both clients; `ADM-VERIFICATIONS`, `ADM-VERIFICATION` on the web | A selfie request can be submitted from a phone browser and from the Android app, and decided in the console |

## 6. Phase 3: discovery

Goal: members see ranked, explained matches and can search, within the privacy rules.

| Task | Read | Build | Done when |
|---|---|---|---|
| **T-301 Visibility module** | 09 (all); 03 section 6 | `domain/visibility.rs`, `domain/display.rs` | Every test case in 09 section 13 passes |
| **T-302 Matching functions** | 10 sections 3 to 7 | `domain/matching/*`: must-have test, dimension scores, fit, similarity, `compat`, rank factors, reason codes | Every test case in 10 section 13 passes and the worked example in 10 section 12 reproduces its numbers |
| **T-303 Profile view** | 15 sections 4.6 and 10; 09 section 8; 10 section 11 | `GET /v1/profiles/{id}`, `GET /v1/profiles/by-code/{code}`, `GET /v1/me/profile/preview`, profile view recording and limit, `GET /v1/me/visitors`, `GET /v1/me/visited` | A same-gender profile, a blocked profile and a hidden profile all return `404`. Locked groups are null and listed in `locked`. |
| **T-304 Recommendations** | 10 sections 8 and 10; 19 section 2 (`refresh_recommendations`) | The candidate pool query, the refresh job, `GET /v1/recommendations`, `POST /v1/recommendations/refresh`, `GET /v1/home` | With seeded data, a candidate failing a must-have never appears; a `married` candidate appears only when opted in; a refresh of 600 candidates takes under 2 seconds |
| **T-305 Search** | 10 section 9; 15 sections 4.8 and 10 | `POST /v1/search` with all filters and sorts; saved searches | Each filter has a test. Pagination returns no duplicates across pages. |
| **T-306 Shortlist, pass, block** | 15 section 13; 03 sections 4.7 to 4.9; 09 section 11 | Endpoints and all block effects in one transaction | After a block, neither profile appears in any list of the other, and the connection is ended |
| **T-307 Dev seed** | 20 section 9 | `cargo run -- seed-dev` creating realistic fake profiles | Refuses to run in production. Creates at least 300 profiles of each gender. |
| **T-308 Web discovery** | 16 (`APP-HOME`, `APP-MATCHES`, `APP-SEARCH`, `APP-PROFILE`, `APP-PHOTOS`, `APP-SHORTLIST`, `APP-VISITORS`); 17 section 10 | Those screens, the shared components, and the profile preview of 08 section 4. The interest buttons on `APP-PROFILE` are wired in T-406; the "Resume" and "Reopen" buttons of the status panel in T-507. | Blurred photos, locked values, compatibility block and looking-for ticks render from real API data. The status panel appears for a profile set to `paused` or `closed` in the database. The preview shows the member and connection views. |
| **T-309 Android discovery** | The same; 22 sections 9 to 11 | The same screens, with `FLAG_SECURE` on profile and photo screens | Same checks. A screenshot of the profile screen is blocked. |

## 7. Phase 4: interests and chat

Goal: the full path from interest to conversation, in real time.

| Task | Read | Build | Done when |
|---|---|---|---|
| **T-401 Interests** | 11 (sending, receiving, withdrawal); 15 section 11; 03 sections 4.7 and 7; 09 section 7 | All interest endpoints, usage counters, cooldowns, mutual interest, `expire_interests` job | The check order in 15 section 11 is tested one check at a time. A sender never receives the value `declined`. |
| **T-402 Connections and messages** | 11 (connections, chat); 15 section 12; 13 section 5 | Connection endpoints, message history and send with idempotency, read state, delete own message, `domain/chat_safety.rs` | Sending twice with one `client_message_id` creates one message. Unread counters match the data (03 section 8 rule 14). |
| **T-403 Real-time hub** | 19 sections 4 to 6 | `realtime/*`, `GET /v1/ws`, events published from the handlers of T-401 and T-402, presence | Two test clients: a message sent over REST arrives on the other socket. A socket that does not authenticate within 10 seconds is closed. |
| **T-404 Contact sharing and stages** | 11 (contact sharing, stages); 15 section 12; 03 sections 4.8 and 4.10 | Contact share and stage proposal endpoints with system messages and effects | Confirming `nikah_done` closes both profiles. Ending a connection revokes both shares. |
| **T-405 Photo access** | 09 section 6; 15 section 13; 03 section 4.9 | Photo access endpoints | A granted viewer receives clear URLs; revoking returns them to blurred |
| **T-406 Web interests and chat** | 16 (`APP-INTERESTS`, `APP-CHATS`, `APP-CHAT`, `APP-CONNECTION`, `APP-PHOTO-REQUESTS`); 17 section 7 | Those screens and `lib/realtime.ts` | Two browsers chat in real time; killing the socket falls back to polling and recovers |
| **T-407 Android interests and chat** | The same; 22 section 7 | Those screens and `RealtimeClient` | Same checks between a browser and a device |

## 8. Phase 5: notifications, safety, account, public site

Goal: everything else needed to open to the public.

| Task | Read | Build | Done when |
|---|---|---|---|
| **T-501 Notification feed** | 14 sections 1 to 3, 6 to 8; 15 sections 6 and 14; 19 section 2 (`saved_search_alerts`, `profile_views_summary`) | Creation of `notifications` rows at each event, feed and read endpoints, preferences endpoints, counters, the `notification.new` and `counters` events, the `saved_search_alerts` and `profile_views_summary` jobs | Each row of the event catalogue in 14 section 2 has a test |
| **T-502 Push** | 14 section 4; 22 section 8; 19 section 2 (`send_push`) | `services/fcm.rs`, device endpoints, `send_push` job, Android messaging service, channels, taps | A message to an offline Android device shows a notification without message text; tapping opens the chat |
| **T-503 Email** | 14 section 5; 19 section 2 (`send_email`, `match_digest`) | `services/resend.rs`, templates, the daily budget and priority order, unsubscribe handling | With the budget set to 2 in a test, the third low-priority email is deferred and a high-priority one still sends |
| **T-504 Reports and sanctions** | 13 sections 6 to 9; 18 section 5; 06 section 8; 15 sections 13 and 16 | `POST /v1/reports` with context capture, the automatic report, staff report and user endpoints, sanctions, `revoke_clerk_sessions`, `lift_suspensions`, `banned_identities` | Suspending a user hides the profile, closes their sockets and makes their next request return `account_suspended`. A banned identity number cannot register again. |
| **T-505 Reports and users in the console** | 18 sections 4 and 5 | `ADM-REPORTS`, `ADM-REPORT`, `ADM-USERS`, `ADM-USER` | A report can be claimed, resolved with a sanction and found in the audit log |
| **T-506 Account lifecycle** | 06 sections 9 and 10; 04 section 12; 08 section 7; 09 section 12 | Pause, resume, close, reopen; deletion request and cancel; `purge_accounts` and `delete_clerk_user`; exports with `build_export`; `cleanup_old_rows` | A test with the grace period set to zero purges an account and leaves no personal data in any table (check every table in 04 section 12) |
| **T-507 Settings screens** | 16 (`SET-*`, `APP-NOTIFS`); 09 section 3 | `SET-HOME`, `SET-PRIVACY`, `SET-NOTIFS`, `SET-BLOCKED`, `SET-ACCOUNT`, `SET-HELP`, `APP-NOTIFS` on both clients | Every privacy setting changes what a second test account sees |
| **T-508 Public site** | 16 section 7; 17 sections 3.1 and 13; 11 (nikah guide outline); 13 section 11 | All `PUB-*` pages, `robots.txt`, sitemap, `assetlinks.json`, attribution | Pages render without JavaScript. Application routes send `noindex`. |
| **T-509 Remaining console** | 18 sections 6 to 8; 19 section 2 (`announcement_fanout`) | `ADM-CASTES`, `ADM-SETTINGS`, `ADM-RELEASES`, `ADM-ANNOUNCE`, `ADM-AUDIT`, and their endpoints, `announcement_fanout` | Promoting a caste suggestion updates the profiles that used it |
| **T-510 Android updates and links** | 22 sections 3.4 and 13 | Update check, `GATE-UPGRADE`, App Links, the `426` path in the API | An old build number shows the blocking update screen |

### 8.1 Launch checklist

| # | Item |
|---|---|
| 1 | Every invariant in 03 section 8 has a passing test |
| 2 | Clerk Production instance configured per the checklist in 06 section 2 |
| 3 | Production env files hold new, unique values for `IDENTITY_ENCRYPTION_KEY` and `IDENTITY_HASH_PEPPER`, copied to the password manager |
| 4 | The first admin is set (18 section 2) and can work through every queue |
| 5 | Terms, Privacy Policy and Community Guidelines are written and reviewed (02, Q-12), and `legal.*_version` settings match them |
| 6 | Support and abuse email addresses exist and are monitored |
| 7 | A database restore has been practised (tech stack section 7) |
| 8 | A test account has been created, used and fully deleted in production, and the purge verified |
| 9 | `moderation.photo_review` is `manual`, and someone is assigned to the queue daily |
| 10 | The seed command has not been run in production |
| 11 | Android release signed with the permanent key; the release record is published through `ADM-RELEASES` |
| 12 | The open questions in 02 section 4 have answers from the product owner |

## 9. After launch

In recommended order. Each is a small project with its own design note added to these documents before work starts.

| # | Feature | Notes |
|---|---|---|
| 1 | Urdu interface | Fill `name_ur` and `label_ur`, add `ur` locale files and `values-ur`, test right-to-left on every screen (20 section 6) |
| 2 | Automatic photo approval | Switch `moderation.photo_review` to `auto` once the rejection rate and the moderation quota are understood |
| 3 | Phone OTP sign-in | 06 section 11. Needs the paid Clerk plan and the price check. |
| 4 | Saved-search alerts by email | An email for the `new_matches` notification of a saved search, within the email budget. The feed and push alert from the `saved_search_alerts` job is part of launch (T-501; 14 section 2). |
| 5 | Photos and voice notes in chat | Needs moderation for images, an `attachment_key` column and storage budget (04 section 7.3) |
| 6 | Biodata sheet | 08 section 8 |
| 7 | Guardian co-access | A second login that can view a profile's matches and chats (02, Q-14) |
| 8 | Several profiles per account | Remove the unique constraint on `profiles.user_id`, add a profile switcher (02, Q-13) |
| 9 | OCR assistance for identity review | 12 section 9. Test Azure Document Intelligence with real cards first. |
| 10 | Viewer watermark on photos | 09 section 6 |
| 11 | Success stories | With both members' consent after `nikah_done` |
| 12 | Web push | Service worker and the web push protocol |
| 13 | Matching that learns from behaviour | 10 section 14 |
| 14 | Paid extras | Only after D-17's conditions; needs a payment provider available in Pakistan |
| 15 | Play Store release | Tech stack section 9 |
| 16 | Daily picks | A small daily set of top recommendations with a notification (01 section 5) |
| 17 | Audio introduction | A short recorded greeting on the profile; needs moderation |
| 18 | Behaviour ratings | Private feedback after a connection ends, feeding ranking (01 section 5) |
| 19 | Hide from phone contacts | Needs contact upload and matching by phone hash (09) |
| 20 | External verification service | A vendor identity check in place of manual review (12 section 9) |
| 21 | In-app voice and video calls | Needs relay servers that cost money (02 section 2) |
| 22 | Directory of nikah services | Listings of nikah registrars and related services (11) |
| 23 | Moderator performance reports | Queue times and decisions per moderator (18) |
