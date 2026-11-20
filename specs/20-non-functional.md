# 20. Non-functional Requirements

| | |
|---|---|
| Status | Design complete, not implemented |
| Related | `docs/tech-stack.md` sections 18 (security baseline) and 21 (limits), [13-safety-and-moderation.md](13-safety-and-moderation.md), [09-privacy-and-visibility.md](09-privacy-and-visibility.md), [06-auth-and-accounts.md](06-auth-and-accounts.md) |

Security, secrets, personal data handling, performance, capacity on the free tiers, languages, accessibility, observability, testing and resilience. These apply to every feature.

## 1. Security controls

The infrastructure baseline (TLS, no inbound ports, database firewall, secrets handling, dependency checks) is in the tech stack document, section 18. The controls below are the application's own.

| # | Control | Where |
|---|---|---|
| S-01 | Every `/v1` route except those marked `public` in 15 requires a valid Clerk token, verified locally | 06 section 6 |
| S-02 | Account and profile status are checked on every request (access levels in 15 section 3) | API extractors |
| S-03 | Authorisation is by ownership: a handler only ever loads rows through the caller's `profile_id`. An id from the URL is always combined with the caller's id in the query (`WHERE id = $1 AND profile_id = $2`), never fetched first and checked afterwards. | Every handler |
| S-04 | A resource the caller may not see answers `404 not_found`, never `403`, so that existence is not revealed | Profiles, connections, interests, photos |
| S-05 | Other members' data passes through the single visibility module before it is serialised | 09 section 13 |
| S-06 | Identity numbers are encrypted at rest and never returned | Section 2 |
| S-07 | Photo and verification objects are private; access is by short-lived presigned URLs signed only for objects the caller may see | 08 section 5.4 |
| S-08 | Request bodies reject unknown fields and are size-limited to 64 KB (uploads go to R2 directly) | Axum body limit |
| S-09 | All SQL uses bound parameters through `sqlx`. No string concatenation of user input. Sort orders and filters are chosen from fixed lists. | Every query |
| S-10 | Rate limits per user and per IP, plus product limits | 15 section 3.1; 03 section 7 |
| S-11 | Member-written text is stored as plain text and rendered as plain text. Links are not made clickable. | Clients |
| S-12 | Webhooks are accepted only with a valid Svix signature and a fresh timestamp | 06 section 7 |
| S-13 | Staff routes require a role and every state change writes the audit log in the same transaction | 18 |
| S-14 | Viewing a decrypted identity number or verification images is itself audited (`verification.view`) | 18 section 8 |
| S-15 | Uploaded images are re-encoded, which removes metadata such as GPS position, and are checked for type by decoding, not by file extension | 08 section 5.3 |
| S-16 | CORS allows only the web origins of the environment; the WebSocket handshake checks the `Origin` header against the same list when it is present | API |
| S-17 | No secrets, tokens, identity numbers, contact details or message bodies in logs or error reports | Section 8 |
| S-18 | The Android app blocks screenshots on sensitive screens and stores no member data at rest | 22 section 10 |
| S-19 | The web app sends a Content Security Policy and never stores tokens | 17 section 14 |
| S-20 | Enumeration of members is impractical: ids are UUIDs, profile codes are 8 random base32 characters, lookups by code are rate-limited and obey visibility | 15 section 10 |

## 2. Secrets and encryption

### 2.1 Identity number protection

| Item | Specification |
|---|---|
| Encryption | AES-256-GCM (`aes-gcm` crate) |
| Key | Env `IDENTITY_ENCRYPTION_KEY`: 32 random bytes, base64. Generate with `openssl rand -base64 32`. |
| Nonce | 12 random bytes, new for every encryption |
| Associated data | The 16 bytes of the `profile_id`, so a ciphertext cannot be moved to another row |
| Stored form (`profile_identity.number_encrypted`) | `nonce (12 bytes) || ciphertext || tag (16 bytes)` |
| Plain text | The normalised number as UTF-8 (12 section 3 defines normalisation) |
| Hash for uniqueness and bans | HMAC-SHA256 (`hmac`, `sha2`) with env `IDENTITY_HASH_PEPPER` (32 random bytes, base64) over the UTF-8 string `<namespace>:<normalised value>` |
| Namespaces | `pk_id` (CNIC and NICOP), `poc`, `passport` for identity numbers (12 section 3); `email` (lower-cased address) and `phone` (E.164) for `banned_identities` |
| Display | Only `number_last4`, rendered as a mask |
| Decryption | In the running product it happens in exactly one place: the staff verification review endpoint (`GET /v1/admin/verifications/{request_id}`). The data export for the owner contains only `number_last4` (09 section 12). |

Rules:

- The two secrets are different values, are different in every environment, and exist only in the environment's env file and in the password manager (tech stack section 15). Losing `IDENTITY_ENCRYPTION_KEY` makes stored numbers unreadable. Losing `IDENTITY_HASH_PEPPER` breaks duplicate and ban detection.
- The API refuses to start in `staging` or `production` when either is missing or not 32 bytes after decoding. In `local`, missing values fall back to fixed development values with a warning in the log.
- The configuration struct holding them does not derive `Debug` (as today).
- **Rotation.** Optional env `IDENTITY_ENCRYPTION_KEY_PREVIOUS`: decryption tries the current key, then the previous one. A one-off admin command re-encrypts every row with the current key, after which the previous key is removed. The pepper is not rotated in normal operation; if it must be, re-hash `profile_identity` by decrypting each number, and keep the old pepper as `IDENTITY_HASH_PEPPER_PREVIOUS` for checks against `banned_identities`, whose plain values are not kept.

### 2.2 API environment variables

Existing variables (`APP_ENV`, `BIND_ADDR`, `DATABASE_URL`, `DATABASE_MAX_CONNECTIONS`, `CORS_ALLOWED_ORIGINS`, `LOG_FORMAT`, `RUST_LOG`, `SENTRY_DSN`) stay as they are. Clerk variables are defined in 06 section 13. The remaining ones:

| Variable | Secret | Meaning |
|---|---|---|
| `IDENTITY_ENCRYPTION_KEY` | Yes | Section 2.1 |
| `IDENTITY_HASH_PEPPER` | Yes | Section 2.1 |
| `R2_ENDPOINT` | No | S3 endpoint, `https://<account id>.r2.cloudflarestorage.com` |
| `R2_BUCKET_MEDIA` | No | `kr-dev-media`, `kr-staging-media` or `kr-prod-media` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Yes | An R2 API token limited to that bucket |
| `AZURE_CONTENT_SAFETY_ENDPOINT`, `AZURE_CONTENT_SAFETY_KEY` | Key: yes | Empty disables automatic moderation; everything then goes to the manual queue |
| `RESEND_API_KEY` | Yes | Empty disables email (jobs succeed without sending and log a warning) |
| `EMAIL_FROM` | No | For example `Khandani Rishta <no-reply@<domain>>` |
| `FCM_PROJECT_ID` | No | Firebase project |
| `FCM_SERVICE_ACCOUNT_JSON` | Yes | The service account key as one line of JSON. Empty disables push. |
| `WEB_BASE_URL` | No | Origin of the web app, used in emails and share links |

Add every variable to `apps/api/.env.example` and `infra/azure/env/api.env.example` with a placeholder and a comment. A feature whose variables are empty must degrade as described above, never crash, so that local development needs only the database.

## 3. Personal data handling

### 3.1 Classification

| Class | Data | Rules |
|---|---|---|
| A, critical | Identity numbers, verification images | Encrypted or in a private bucket; never leave the API except to the reviewing moderator; images deleted 30 days after the decision; access audited |
| B, private | Email, phone, contact details, guardian contact, date of birth, messages, clear photos, IP addresses in consent records | Only to the owner, to members the owner explicitly allowed (09), and to staff with a reason; never in logs |
| C, member-visible | Profile fields, blurred photos, preferences summary | Shown to eligible members according to the owner's privacy settings |
| D, public | Reference data, public pages, app releases | No restriction |

### 3.2 Member rights implemented in the product

| Right | How |
|---|---|
| See my data | Own profile screens; `POST /v1/me/exports` produces a JSON archive (09 section 12) |
| Correct my data | Edit screens; locked fields through support |
| Limit who sees it | Privacy settings (09) |
| Stop being shown | Pause or close the profile |
| Delete | `POST /v1/me/deletion`, 30-day grace, then the purge in 04 section 12 |
| Withdraw consent | Deleting the account; the consent record itself is kept as evidence |

### 3.3 Consent

- Consent to the Terms, Privacy Policy and Community Guidelines, the age declaration and (for managed profiles) the candidate's consent are recorded in `user_consents` with version, time, IP address and user agent at the first onboarding step.
- When a document version changes (`legal.*_version`), the gate becomes `consent_required` until the member accepts again.
- The identity step shows its own explanation of why the number is collected and how it is protected (12 section 2). Saving the number is the consent for that use.

Legal texts and the obligations summarised in 13 section 10 need review by a lawyer in Pakistan before launch (02, Q-12).

## 4. Performance targets

Measured at the API host, excluding the client's network.

| Operation | Target (95th percentile) |
|---|---|
| `GET /v1/me` | 50 ms |
| Reads of one object or one page of a list | 200 ms |
| Writes | 300 ms |
| `POST /v1/search` | 300 ms (`best_match` first page: 1 s) |
| Recommendations refresh for one profile | 2 s for 600 candidates |
| Message send to delivery on the other device | 500 ms |
| Photo processing (`process_photo`) | 5 s per photo |
| WebSocket memory | Under 20 KB per open socket |

Database rules that make these achievable:

1. Every query has a `LIMIT` or is by primary key.
2. Every list endpoint is served by an index listed in 04. Check new queries with `EXPLAIN` against a database seeded with at least 20,000 profiles.
3. `statement_timeout` is 5 s for the API role.
4. No N+1 queries: list endpoints fetch photos, relations and reference lookups for the whole page in a fixed number of queries. Reference data is read from memory, never joined.
5. Transactions are short and never span a network call to another service.
6. Connection pool: 10 in production, 5 in staging (tech stack section 7). The job worker and the HTTP handlers share it.

## 5. Capacity on the free tiers

What each free allowance holds, and what to do when it is reached.

| Resource | Allowance | Roughly equals | First sign of trouble | Action |
|---|---|---|---|---|
| Clerk free plan | 50,000 monthly retained users | Far beyond launch | | |
| R2 storage | 10 GB | About 25,000 photos (0.4 MB each with all variants) | Storage graph near 8 GB | Lower JPEG quality or the `large` size; pay $0.015 per GB-month |
| R2 reads | 10 million a month | About 300,000 photo views a day | | Longer cache lifetime |
| Azure Content Safety images | 5,000 a month | 5,000 uploaded photos | `process_photo` logs a quota error | Automatic fallback to the manual queue (13 section 12) |
| Azure Content Safety text | 5,000 records a month | About 5,000 edits of moderated texts | Same | Same |
| Resend | 100 emails a day, 3,000 a month | Essential emails for a few thousand members | `send_email` jobs deferred by the daily budget | Priority order in 14 section 5; Resend paid plan |
| PostgreSQL storage | 32 GiB shared with staging | Millions of messages; about 2 KB per profile across tables, about 0.3 KB per message | 80% alert from the tech stack | Retention jobs (04 section 12) already limit growth |
| PostgreSQL CPU | 1 vCore | Depends on query discipline | Slow-query entries in `pg_stat_statements` | Section 4 rules; larger tier |
| API host memory | 1 GiB | A few thousand open sockets plus caches | Swap in use | Cap `moka` caches; one photo processed at a time; larger host |
| Azure outbound data | 15 GB a month, both hosts | About 3 million compressed API responses | Cost alert | Photos never pass through the API; keep compression on |
| Workers requests | 100,000 a day | Page loads only (API calls go straight to the API host) | Error 1102 or the daily cap | Workers Paid ($5 a month) |
| FCM | No practical limit | | | |

## 6. Languages

| Rule | Detail |
|---|---|
| Launch language | English |
| Second phase | Urdu, right-to-left, on both clients |
| Strings | Every user-facing string is a translation key in the clients from day one. No hard-coded text in components. |
| Server-provided text | Enumeration and lookup labels (`label`, `label_ur`, `name`, `name_ur`) come from the API. Notifications and system messages are rendered by the clients from `type` and `data`. API error `message` values are English fallbacks; clients translate by `code`. |
| Emails | Sent in `users.locale`. English templates at launch. |
| Layout | Logical directions only (start and end). Icons that imply direction (arrows, chevrons) mirror in right-to-left. |
| Member-written text | Any script is allowed in free text. Names may be written in Latin or Arabic script. Text is displayed with automatic direction (`dir="auto"` on the web, default bidi handling on Android). |
| Digits | Western digits in both languages |
| Search | City and caste search match the English name and listed aliases at launch; Urdu names are added with the Urdu phase |

## 7. Accessibility

Many members are parents using a phone. The baseline is WCAG 2.1 level AA.

| Requirement | Detail |
|---|---|
| Text size | Body at least 16 px or 16 sp. Layouts survive 200% text scaling without loss of content. |
| Contrast | At least 4.5 to 1 for text, 3 to 1 for large text and icons. The tokens in 17 section 9.3 meet this on their intended backgrounds. |
| Touch targets | At least 44 px on the web, 48 dp on Android |
| Forms | Every input has a visible label (not only a placeholder), errors are text next to the field and announced to screen readers, required fields are marked in text |
| Keyboard (web) | Every action reachable by keyboard, visible focus ring, dialogs trap focus and close with Escape |
| Screen readers | Meaningful labels on icon buttons and photos; status changes (message sent, saved) announced through a live region |
| Colour | Never the only carrier of meaning: statuses also have a text label or icon |
| Motion | No essential animation; respect the reduced-motion setting |
| Pickers | Date of birth and height use simple selects rather than calendars or sliders |

## 8. Observability

### 8.1 Logs

- Structured `tracing` logs, one JSON object per line in staging and production (as today), each carrying the request id and, once authenticated, `user_id` and `profile_id`.
- Never log: tokens, identity numbers, contact details, message bodies, free-text profile content, email addresses, phone numbers, presigned URLs, request or response bodies. Log ids and codes instead.
- Log levels: `error` for failures needing attention, `warn` for degraded behaviour (quota reached, a disabled integration), `info` for one line per request and for domain events, `debug` for development.

### 8.2 Domain events

The API emits one `info` log line with the field `event` for each of the following. They are the product's analytics: there is no client-side analytics SDK and no extra service. Dashboards read the database (18 section 9); these lines give the timeline when it is needed.

| `event` | Extra fields |
|---|---|
| `user.created` | |
| `onboarding.step_completed` | `step`, `skipped` (true when no data was saved for a skippable step) |
| `onboarding.completed` | `result` (`active` or `pending_review`), `seconds_since_signup` |
| `profile.status_changed` | `from`, `to` |
| `photo.uploaded`, `photo.approved`, `photo.rejected` | `reason` |
| `verification.submitted`, `verification.decided` | `kind`, `result` |
| `interest.sent`, `interest.accepted`, `interest.declined`, `interest.withdrawn`, `interest.expired` | `compat_score` |
| `connection.created`, `connection.ended`, `connection.stage_changed` | `stage`, `reason` |
| `message.sent` | `safety_flag` (never the text) |
| `contact.shared` | |
| `report.filed`, `report.resolved` | `reason`, `outcome` |
| `sanction.applied` | `type` |
| `account.deletion_requested`, `account.deletion_cancelled`, `account.purged` | |
| `limit.reached` | `limit` |

Onboarding drop-off is read from the database: the distribution of `profiles.onboarding_step` among `draft` profiles older than 24 hours.

### 8.3 Client events

Some things only a client can observe (a screen was viewed, how long a step took, a helper button was used). For these, both clients have one small helper, `track(name, properties)`:

| Rule | Detail |
|---|---|
| Transport | `POST /v1/events` (15 section 6). Events are buffered in memory and sent when 20 have collected, every 30 seconds, and when the app goes to the background. |
| Failure | A failed send is dropped. Never retried, never shown to the user, never blocks anything. |
| Storage | None. The API writes each event as a log line named `client.<name>`. If product analytics are ever needed in a table, this endpoint is the single place to add it. |
| Privacy | No names, dates of birth, identity numbers, contact details, free text, photo URLs, profile ids or profile codes. Only step names, option codes, counts, durations and field keys. |
| Allowed events | Only events named in these documents. At launch that is the onboarding funnel list in 07 section 17. A new event is added to a document first, then to the code. |

### 8.4 Errors and metrics

- Sentry on the API, the web app and the Android app (tech stack section 17), with personal data scrubbing on and request bodies off.
- Azure Monitor for host and database metrics. `pg_stat_statements` for slow queries.
- The job table is its own monitor: `ADM-HOME` shows the number of `dead` jobs (`jobs_dead`, 18 section 9).

## 9. Testing strategy

| Layer | Tooling | What must be covered |
|---|---|---|
| Pure domain logic (API) | `cargo test` | Matching functions (10 section 13), visibility functions (09 section 13), text rules and chat patterns (13 sections 3 and 5), identity number validation (12 section 3), completeness (08 section 6), gate computation (03 section 5.1), preference defaults (07 section 12) |
| Database-backed logic (API) | `#[sqlx::test]` | Every state machine in 03 section 4: each allowed transition and at least one refused transition. Every invariant in 03 section 8. Limits and cooldowns. The purge procedure. Webhook idempotency. Block effects. |
| HTTP (API) | Axum test client | Each access level refuses the wrong caller. Error bodies match 15 section 2. Unknown fields are rejected. A member cannot read or change another member's resources (one test per resource type). |
| Contract | CI | `openapi.json` is regenerated and compared with the committed file (already in `.github/workflows/_api.yml`) |
| Web | Vitest, Testing Library, Playwright | 17 section 18 |
| Android | JUnit, Compose UI tests | 22 section 15 |
| Migrations | CI | Migrations apply to an empty PostgreSQL 18 database, and the seed migrations load |

Test data: a seed command (`cargo run -- seed-dev`) creates a few hundred realistic fake profiles of both genders with photos from a placeholder set, for local and staging use only. It refuses to run when `APP_ENV=production`.

## 10. Resilience and degraded modes

| Dependency failing | Behaviour |
|---|---|
| PostgreSQL | `503 service_unavailable`. `/readyz` fails. Clients show a retry state. |
| Clerk key set unreachable | Tokens are verified with the cached keys. A token signed by an unknown key is refused. |
| Clerk Backend API unreachable during first-request provisioning | `503 service_unavailable` for that request; the client retries; nothing is half-created |
| Clerk webhooks delayed or lost | No effect on sign-up (06 section 5). Email or phone changes arrive late. |
| R2 | Upload URL requests fail with `503`; existing photo URLs fail to load and clients show the placeholder. No data loss. |
| Azure Content Safety down or over quota | Photos and texts go to the manual queue (`pending_review`, `pending`) |
| Resend | `send_email` retries with backoff, then is dropped as `dead`. Nothing else depends on email. |
| FCM | `send_push` retries, then is dropped. The in-app feed and counters are unaffected. |
| WebSocket hub restart (deploy) | Clients reconnect with backoff and resync (17 section 7.1; 22 section 7) |
| Job worker behind | Interests expire late and digests go out late. Nothing user-facing blocks on a job except photo processing, whose state is visible as "Processing". |

General rules: every outbound HTTP call has a timeout (5 s connect, 15 s total), at most 2 retries inside one request, and failures of optional integrations never fail the member's request. Writes that members repeat by accident (double taps, retries) are idempotent: `PUT` endpoints by nature, message sending by `client_message_id`, interest sending by the unique pending index.

## 11. Definition of done for a feature

A feature is complete when all of these hold:

1. The endpoints match 15 and the committed `openapi.json` is regenerated.
2. The tables and constraints match 04, in a new migration.
3. The tests named in section 9 for the touched areas exist and pass.
4. Both clients implement the screens in 16 with loading, empty and error states, using translation keys.
5. Privacy rules are applied through the visibility module, not ad hoc.
6. No personal data appears in logs produced by the feature.
7. Limits and settings come from `app_settings` with the defaults in 03 section 7.
8. The staff-side counterpart (queue, audit entry) exists where the feature creates something to review.
