# 02. Decisions and Feasibility

| | |
|---|---|
| Status | Design complete, not implemented |
| Checked on | 2026-11-20. Prices, plan limits and laws change: re-check before relying on them. |
| Related | [01-product-overview.md](01-product-overview.md), `docs/tech-stack.md` |

This document records what was decided and why, what was checked for feasibility on the current stack and budget, what must be added to the stack, and which questions are still the product owner's to answer. Where a question is open, a default is given so that implementation is never blocked.

## 1. Decision log

| ID | Decision | Why | Rejected alternative | Specified in |
|---|---|---|---|---|
| D-01 | One profile per user at launch. All interaction tables reference `profile_id`, not `user_id`. | Simple for members and for the first build. Keying interactions by profile means a parent managing two children later needs no change to those tables. | Several profiles per account from day one | 03, 04 section 5 |
| D-02 | Two genders, and members only ever see the opposite gender. | Matches the purpose (nikah) and stops browsing of one's own gender's profiles for gossip or scraping. | Free browsing | 03 section 8 |
| D-03 | The candidate must be 18 or older, both genders, everywhere. | Sindh, Islamabad, Balochistan and Punjab set 18 for both; a CNIC is issued at 18. One rule is simpler and safer than per-province rules. | 16 for women where the old federal act still applies | 07 |
| D-04 | Sign-in with Google and with an email code at launch. Phone OTP later. | Clerk SMS needs a paid plan in production, Pakistan is not enabled by default and its per-SMS price is not published. Every Android user has a Google account. | Phone-first sign-up | 06 |
| D-05 | The API database is the authority for onboarding state and account status. Clients route on the `gate` from `GET /v1/me`. Clerk metadata is not used. User rows are created on the first authenticated request, not by webhook. | One source of truth, no stale token claims, no dependence on webhook timing. | Mirroring `onboardingComplete` into Clerk `publicMetadata` | 03 section 5.1; 06 |
| D-06 | The identity document number (CNIC, NICOP, POC or passport) is asked during onboarding and is required by default (`onboarding.identity_required`). It is stored encrypted, with a keyed hash for uniqueness. One profile per document. | The owner asked for CNIC at sign-up. It deters duplicates and lets a ban stick. Encryption plus a hash keeps the risk low. | Optional identity; storing the number in plain text | 04 section 5.4; 12 |
| D-07 | Verification (selfie and identity document) is a manual moderator review, free, and optional for members. | NADRA verification is open only to regulated institutions. Azure face matching is gated and not on the free tier. Charging for verification is a top complaint about reference apps. | Paid vendor KYC at launch | 12 |
| D-08 | Enumerations are `text` with `CHECK` constraints. Small lookups use a text `code` key. | Far simpler with `sqlx` than PostgreSQL enum types, readable API payloads, one-line changes. | PostgreSQL `ENUM` types, integer lookup ids | 04 section 1 |
| D-09 | Privacy is enforced on the server. Hidden values are never sent. Blurred photos are separate files. | A client-side blur or hidden field can be bypassed. | CSS blur, client-side hiding | 09 |
| D-10 | New female profiles default to photos visible only to people they send an interest to and to connections. Male profiles default to visible to members. Both are asked explicitly during onboarding. | Matches expectations in the reference apps and protects against photo misuse, while keeping the choice with the member. | Everyone public by default | 09 |
| D-11 | Chat exists only inside an accepted interest. Declines are quiet. | Prevents unsolicited messages and spares feelings. | Open messaging; paid "compliments" before a match | 11 |
| D-12 | Contact details are revealed only by an explicit, per-connection, revocable share, and may be the guardian's instead of the candidate's. | The most abused data in rishta apps is the phone number. | Showing the number to all connections or to paying members | 09, 11 |
| D-13 | Matching uses must-haves as hard filters in both directions, a symmetric compatibility score, and a ranking that spreads attention. | A recommendation is useful only if both sides could say yes. Popular profiles must not be flooded. | One-directional preference match; popularity ranking | 10 |
| D-14 | Caste and sub-caste are optional, privacy-controlled, selectable from a list or typed, and usable as a preference with the lowest default importance ("nice to have"). Complexion is an optional display field and is never a filter or a matching input. | The owner asked for caste with "other" support, and families do ask for it. Complexion filtering is widely criticised and adds nothing to honest matching. | Hiding caste entirely; complexion filters | 05, 07, 10 |
| D-15 | A man who is currently married may register only with the status `married` and is shown only to women whose preferences include it. | Honesty is better than concealment, and nobody is shown such a profile without asking for it. | Banning such profiles (drives concealment); showing them to everyone | 03 section 8; 10 |
| D-16 | Marriage bureaus and paid agents may not operate profiles. | The largest complaint about the main local competitor. | Labelled bureau accounts | 13 |
| D-17 | Everything is free at launch. If payments come later, safety, verification, privacy controls and must-have filters stay free. | Trust first. Payment providers are also limited in Pakistan (section 2). | Subscription tiers at launch | 01 |
| D-18 | English at launch, Urdu with right-to-left layout as the second phase. All strings go through i18n keys from day one, and reference rows have `name_ur` columns. | Halves the first build without blocking Urdu. | Both languages at launch | 20 |
| D-19 | Chat is text-only at launch. | Images and voice need moderation and storage. Text covers the need. | Media messages at launch | 11 |
| D-20 | Push notifications on Android through FCM. The web app has the in-app feed and email, no web push at launch. | FCM is already in the stack. Web push adds service-worker work for little gain at launch. | Web push at launch | 14 |
| D-21 | Photos are reviewed by a moderator at launch (`moderation.photo_review = 'manual'`), profiles are approved automatically when the automatic checks pass. Both are settings. | Photo misuse is the highest risk and volume is low at launch. Profile data is validated field by field already. | Fully automatic; fully manual | 13 |
| D-22 | The admin console is part of the web app under a role-gated area. | One deployment, one codebase, reuses the API client. | A separate admin application | 18 |
| D-23 | Deleting an account has a 30-day grace period, then the account is scrubbed and kept as a tombstone. | Members change their minds; other members' chat history needs valid references; moderation records must survive. | Immediate hard delete | 04 section 12; 06 |
| D-24 | The Ahmadi community is not listed as a sect of Islam; such members choose the religion "Other". | Pakistani law (PPC 298-B and 298-C) forbids presenting it as a Muslim sect, which would put members and the operator at risk. | Listing it under Islam | 05 |
| D-25 | A connection has stages (`chatting`, `families_talking`, `engaged`, `nikah_done`) that move forward only when both sides confirm. `nikah_done` closes both profiles. The platform does not conduct or register marriages. | The owner asked that members can "later do nikah". Mutual confirmation gives real success data without legal involvement. | An online nikah service | 11 |
| D-26 | "House" in the owner's brief is implemented as home details: ownership, type, size and unit, under the family section, with its own privacy setting. | The common meaning on local rishta forms (own or rented, 5 marla, 1 kanal). | A street address (never collected) | 04 section 5.2 |
| D-27 | No member data is public. Profile pages need sign-in, and search engines are told not to index application routes. | Privacy and scraping protection. | Public teaser profiles for SEO | 17 |
| D-28 | Real-time delivery uses one in-process WebSocket hub. Messages are always sent over REST. | Matches the single-instance API in the tech stack; REST gives idempotency and simple retries. | A message broker; sending over the socket | 19 |
| D-29 | Option labels for closed lists are served by the API with the reference data. | One place for labels instead of three (API, web, Android). | Duplicating labels in each client | 05, 15 section 5 |
| D-30 | Numeric product limits live in `app_settings` with coded defaults. | Tuning without a deploy. | Constants in code | 03 section 7 |
| D-31 | Gender and date of birth are locked after onboarding; names are locked after identity verification. | Stops bait-and-switch after verification. Mistakes are fixed through support. | Free editing | 03 section 8 |
| D-32 | Screens are specified once, platform-neutral, by screen ID. Web paths and Android navigation keys map to those IDs. | Guarantees the two clients stay in step. | Separate screen specifications per platform | 16, 17, 22 |

## 2. Feasibility on the current stack and a zero budget

| Need | Feasible now? | Approach | Limit to watch |
|---|---|---|---|
| Email and Google sign-in | Yes | Clerk, free | 50,000 monthly retained users on the free plan |
| Phone OTP sign-in | Not on the free plan | Needs Clerk Pro in production, Pakistan enabled in the SMS settings, and a per-SMS fee. Pro is currently covered by the Student Pack; the SMS fee is not. Decide after seeing the price in the Clerk dashboard. | Per-SMS cost for +92 |
| Banning a user in Clerk | Only on a paid plan | The API refuses the user by itself and revokes their Clerk sessions, which works on every plan | Existing tokens live up to 60 seconds |
| CNIC check against NADRA | No | Not available to unregulated private apps. Format validation, uniqueness and manual document review instead | |
| Automatic face match (selfie to ID or photos) | No | Azure Face verification is limited-access and not on the free tier. Moderators compare by eye | Moderator time |
| Reading the CNIC from an image | Possible later | Azure Document Intelligence free tier, 500 pages a month. Whether its ID model reads a Pakistani CNIC well must be tested first | 500 pages a month |
| Photo moderation | Yes | Azure AI Content Safety free tier plus the manual queue | 5,000 images a month, hard stop |
| Text moderation of bios | Yes | Local rules first, then Azure AI Content Safety | 5,000 text records a month, hard stop; Urdu quality is unproven |
| Photo storage and delivery | Yes | Cloudflare R2, private bucket, presigned URLs. About 0.4 MB per photo across all variants | 10 GB free holds roughly 25,000 photos |
| Image processing on a 1 GiB host | Yes | `image` crate, one photo at a time, clients downscale before upload | Memory; JPEG output only (the pure-Rust WebP encoder is lossless only) |
| Real-time chat | Yes | Axum WebSockets with an in-process hub, as planned in the tech stack | One API instance; Cloudflare closes idle sockets, so ping every 30 seconds |
| Android push | Yes | Firebase Cloud Messaging, free | Devices without Google Play services get no push |
| Email | Yes, tightly | Resend free tier, used only for essential events and one weekly digest | 100 emails a day, 3,000 a month |
| Search and matching | Yes | PostgreSQL indexes for filters; scoring in Rust over at most 600 candidates per refresh; results cached in a table | 1 vCore database shared with staging |
| Distance-based "nearby" | Yes, simply | Same city, then same region. No PostGIS needed | |
| City and region data | Yes | GeoNames, licence CC BY 4.0, attribution in the footer of the public pages and on `SET-HELP` | About 30,000 city rows |
| Screenshot protection | Android only | `FLAG_SECURE`. Browsers cannot prevent screenshots | |
| Payments | Not now | Stripe does not onboard Pakistani businesses. Local options (JazzCash, Easypaisa, bank transfer, PayFast) need a registered business | Not in scope |
| Voice and video calls | Not now | WebRTC needs TURN relays, which cost money at any real volume | Not in scope |
| Urdu interface | Yes, second phase | i18n keys and logical CSS properties from day one | Translation effort |
| Server-rendered public pages | Yes | Already in the tech stack; application screens render in the browser | Workers 10 ms CPU limit on the free plan |

## 3. Stack additions

Libraries the specifications need that are not yet listed in `docs/tech-stack.md`. When implementation starts, add them to that document (it is the source of truth for the stack). None is a new hosted service and none costs money.

### 3.1 API (Rust)

| Crate | Used for |
|---|---|
| `aes-gcm` | Encrypting identity document numbers (04 section 5.4) |
| `hmac`, `sha2` | Keyed hashes of identity numbers, emails and phones |
| `base64`, `rand` | Key handling, nonces, public codes |
| `regex` | Text rules and chat safety patterns (13) |
| `time` (or `chrono`) with the matching `sqlx` feature, plus a time-zone crate (`time-tz` or `chrono-tz`) | Dates, ages, day boundaries in `Asia/Karachi` |
| `dashmap` | The WebSocket hub's concurrent map (19) |
| `blurhash` is not needed | Blurred variants are real image files |

Crates already listed in the tech stack and now given a concrete job: `jsonwebtoken` (Clerk tokens), `svix` (webhooks), `reqwest` (Clerk Backend API, Resend, FCM, Azure), `aws-sdk-s3` (R2 presigning), `image` (photo variants), `moka` (caches), `tower_governor` (rate limits), `garde` (validation), `uuid` (UUIDv7), `gcp_auth` (FCM).

### 3.2 Web

| Package | Used for |
|---|---|
| `i18next`, `react-i18next` | Translations and right-to-left support |
| `@tanstack/react-virtual` | Long chat histories and result lists |

Already in the tech stack: `@clerk/tanstack-react-start`, TanStack Query, TanStack Form, Zod, Tailwind CSS, shadcn/ui, `openapi-fetch`.

### 3.3 Android

| Library | Used for |
|---|---|
| CameraX (`androidx.camera`) | Live selfie capture for verification |
| Paging 3 (`androidx.paging`) | Paginated lists and chat history |
| Photo Picker (`ActivityResultContracts.PickVisualMedia`) | Choosing photos without a storage permission |

Already in the tech stack: Clerk Android SDK, Retrofit, OkHttp (also used for the WebSocket), Coil, DataStore, Firebase Messaging, Hilt, Navigation 3.

### 3.4 Changes this design implies for `docs/tech-stack.md`

| Section there | Change |
|---|---|
| 10 Authentication | Sign-in methods are Google and email code; SMS and MFA are not used at launch; Clerk user bans are not relied on; user rows are created lazily by the API |
| 23 Open decisions, item 3 (languages) | Decided: English first, Urdu second (D-18) |
| 23 Open decisions, item 4 (phone sign-in) | Deferred (D-04) |
| 23 Open decisions, item 5 (payments) | None at launch (D-17) |
| 6 Backend libraries | Add the crates in 3.1 |

## 4. Open questions for the product owner

Each has a default that the specifications already follow. Changing an answer later is a setting or a small change unless the last column says otherwise.

| # | Question | Default used | Cost of changing later |
|---|---|---|---|
| Q-01 | Is the identity number mandatory to finish onboarding? | Yes (`onboarding.identity_required = true`) | A setting |
| Q-02 | Does "house" mean home details (ownership, type, size), as assumed in D-26? | Yes | Small |
| Q-03 | When should phone OTP be switched on, given it needs a paid Clerk plan and a per-SMS fee? | After launch, once the price for Pakistan is known | Configuration plus one screen |
| Q-04 | Should complexion ever be a search filter or preference? | No (D-14) | Small |
| Q-05 | Should caste be available as a must-have preference? | Yes, with the lowest default importance ("nice to have") | A validation rule |
| Q-06 | Are currently married men allowed to register (D-15)? | Yes, visible only to women who opt in | A validation rule |
| Q-07 | Are members of other religions welcome? | Yes: Islam, Christianity, Hinduism, Sikhism, Zoroastrianism, Other | Seed data |
| Q-08 | How is the Ahmadi community handled (D-24)? | Religion "Other", not a sect of Islam | Seed data. Needs the owner's and a lawyer's confirmation |
| Q-09 | Should new profiles wait for a moderator before going live? | No for profile data, yes for photos (D-21) | Two settings |
| Q-10 | Who moderates, and how quickly must a photo or a report be handled? | The owner at launch; photos within 24 hours, urgent reports within 12 hours | Staffing |
| Q-11 | What are the domain name and the support email address? | **Answered 2026-11-21:** `khandanirishta.app`, with `support@khandanirishta.app`. The specifications use it throughout | Configuration |
| Q-12 | Who writes and reviews the Terms, Privacy Policy and Community Guidelines? | Outlines are in 16; a lawyer in Pakistan should review before launch | Content |
| Q-13 | Should parents be able to manage several children's profiles under one login? | Not at launch (D-01) | Medium: remove one unique constraint, add a profile switcher |
| Q-14 | Should a guardian be able to read the candidate's chats (chaperone mode)? | Not at launch; guardian contact sharing only | Medium |
| Q-15 | Which city or community is the launch focus? | Not decided. A matrimonial product needs local density, so launching in one or two cities first is recommended | Marketing only |
| Q-16 | Will there be paid features later, and which? | None planned (D-17) | New work |
| Q-17 | Android application id, pending in the tech stack | `com.khandanirishta.app` | Cannot change after the first public APK |
| Q-18 | Who reviews the caste and sub-caste list? Clan-to-caste assignments are contested (05 section 5). | The seed in 05 as written; members can always type their own | Seed data |
| Q-19 | Must the platform register with a regulator, and how long must access logs be kept (13 section 10)? | Not registered; logs kept as long as the host retains them | Needs a lawyer in Pakistan; may need a log store |
| Q-20 | Who is the second admin, so that one person is never the only one able to moderate or recover access (18)? | Only the owner at launch | Staffing |
| Q-21 | Should a profile with the status `married` always wait for a moderator before going live? | No, same rules as other profiles | A rule in onboarding completion |
| Q-22 | Should emails have a one-click unsubscribe link that works without signing in (14 section 5)? | No: links open the notification settings screen | One small endpoint |

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fake or misleading profiles | High | High | Identity number, one profile per document, manual photo review, free verification with badges, reports, bans that stick |
| Photo misuse and blackmail | Medium | Very high | Photo privacy modes, blur as separate files, private signed URLs, Android screenshot blocking, fast takedown |
| Scams that move to WhatsApp and ask for money | High | High | Contact hidden until shared, chat safety notices, automatic reports for repeated money requests, safety education |
| Holding identity numbers attracts legal or security exposure | Medium | High | Explicit consent, encryption with a key outside the database, masked display, access audit, short retention of images, lawyer review (Q-12) |
| Moderation workload exceeds one person | Medium | Medium | Automatic profile approval, quotas and settings to switch photos to automatic review, keyboard-driven queues |
| Too few members for good matches at launch | High | High | Launch focus on one or two cities (Q-15), honest "pool exhausted" state with relaxation hints, new-member boost |
| Gender imbalance and women flooded with interests | High | Medium | Daily interest limits, exposure dampener in ranking, `interest_permission` controls, quiet declines |
| Free-tier limits are hit (email 100 a day, moderation 5,000 a month, R2 10 GB) | Medium | Medium | Priority order for email, manual fallback for moderation, photo size budget, capacity table in 20 |
| The Azure free year ends | Certain | Medium | Already planned in the tech stack (section 22) |
| Regulation changes (data protection bill, social media rules) | Medium | Medium | Report and takedown flow, audit log, data export and deletion already in the design; legal review before launch |
| A single API instance fails | Low | Medium | Stateless API, automatic restart, clients reconnect and resync |
