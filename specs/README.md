# Khandani Rishta: Product Specifications

| | |
|---|---|
| Status | Design complete, nothing here is implemented yet |
| Written | 2026-11-20 |
| Scope | Product behaviour, data model, API, screens and build order. Technologies and hosting are in [`docs/tech-stack.md`](../docs/tech-stack.md). |
| Audience | The implementer. Every document is written to be followed literally. |

Khandani Rishta is a matrimonial platform for Pakistani families: a web app and an Android app on one API. These documents define the whole product, from sign-up to nikah, in enough detail to be built without further design decisions.

## 1. How to use these documents

1. Read [01](01-product-overview.md) to understand the product, then [03](03-domain-model.md) for the vocabulary and the state machines. Everything else uses those words.
2. Build in the order given in [21](21-implementation-roadmap.md). Each task there lists the sections to read.
3. Treat three documents as anchors. When any other document seems to disagree with them, the anchor wins:
   - [04 Database schema](04-database-schema.md): every table, column and allowed value.
   - [03 Domain model](03-domain-model.md): every state, transition, rule and limit.
   - [15 API contract](15-api-contract.md): every endpoint, payload and error code.
4. Never invent a name. If a table, field, endpoint, setting, job, event or screen is not in these documents, ask before adding it.
5. When the product owner answers an open question ([02 section 4](02-decisions-and-feasibility.md)), update the affected documents first, then the code.

## 2. Documents

### Start here

| # | Document | What it answers |
|---|---|---|
| 01 | [Product overview](01-product-overview.md) | What the product is, who uses it, the principles, the feature map, what is out of scope |
| 02 | [Decisions and feasibility](02-decisions-and-feasibility.md) | What was decided and why, what is feasible on the current stack at zero cost, libraries to add, open questions, risks |
| 21 | [Implementation roadmap](21-implementation-roadmap.md) | The build order as small tasks, the API source layout, the launch checklist, what comes after launch |

### Anchors

| # | Document | What it answers |
|---|---|---|
| 03 | [Domain model](03-domain-model.md) | Vocabulary, entities, every lifecycle, what each profile status may do, the gate, limits and settings, invariants |
| 04 | [Database schema](04-database-schema.md) | Complete PostgreSQL DDL, conventions, migration order, deletion and retention |
| 15 | [API contract](15-api-contract.md) | Conventions, errors, access levels, shared types, every endpoint |

### Features

| # | Document | What it answers |
|---|---|---|
| 05 | [Reference data](05-reference-data.md) | Every option list and lookup seed: religions, sects, castes and sub-castes, languages, education, professions, income bands, hobbies, geography |
| 06 | [Authentication and accounts](06-auth-and-accounts.md) | Clerk configuration, sign-in on web and Android, token verification, user creation, webhooks, suspension and bans, account deletion |
| 07 | [Onboarding](07-onboarding.md) | The eleven steps field by field, validation, preference defaults, messages |
| 08 | [Profile and photos](08-profile-and-photos.md) | Own profile, editing rules, contact details, the photo pipeline, URL signing, completeness |
| 09 | [Privacy and visibility](09-privacy-and-visibility.md) | Who can see what: every privacy setting, the visibility matrix, photos, private browsing, contact sharing, blocks, data rights |
| 10 | [Matching and discovery](10-matching-and-discovery.md) | Eligibility, must-haves, the scoring formulas, ranking, reasons, the recommendations cache, search, home lists |
| 11 | [Interests, connections and chat](11-interests-connections-chat.md) | From interest to conversation to nikah: rules, limits, chat behaviour, contact sharing, stages |
| 12 | [Verification and trust](12-verification-and-trust.md) | Identity number rules, selfie and document verification, badges, storage of verification images |
| 13 | [Safety and moderation](13-safety-and-moderation.md) | Threats, text and photo rules, chat safety notices, reports, sanctions, legal duties |
| 14 | [Notifications](14-notifications.md) | Event catalogue, in-app feed, Android push, email and its budget, preferences |
| 19 | [Jobs and real-time](19-jobs-and-realtime.md) | The background job system and every job, scheduled work, the WebSocket protocol |

### Clients and staff

| # | Document | What it answers |
|---|---|---|
| 16 | [Screens and flows](16-screens-and-flows.md) | Every member screen by ID, platform-neutral: content, data, actions, states; navigation; end-to-end flows; public page outlines |
| 17 | [Web app](17-web-app.md) | URLs, route files, guards, data layer, real-time client, forms, layout, design tokens, SEO, web security |
| 22 | [Android app](22-android-app.md) | Navigation keys, start-up, networking, real-time, push, camera, screenshot protection, updates |
| 18 | [Admin console](18-admin-console.md) | Staff roles, review queues, users and sanctions, reference data, settings, audit log, dashboard numbers |

### Cross-cutting

| # | Document | What it answers |
|---|---|---|
| 20 | [Non-functional requirements](20-non-functional.md) | Security controls, secrets and encryption, personal data handling, performance, free-tier capacity, languages, accessibility, observability, testing, resilience |

## 3. Reading order by role

| If you are building | Read, in order |
|---|---|
| The database and API foundation | 03; 04; 15 sections 1 to 6; 06; 05; 19 sections 1 to 3; 20 sections 1 and 2 |
| Onboarding and profiles (API) | 07; 08; 12 section 3; 13 section 3; 15 sections 7 to 9 |
| Matching and discovery (API) | 09; 10; 15 section 10 |
| Interests and chat (API) | 11; 19 sections 4 to 6; 13 section 5; 15 sections 11 to 13 |
| The web app | 16, 17, then the feature document for the screen in hand |
| The Android app | 16; 22; 17 sections 4, 6 and 7 (shared behaviour), then the feature document |
| The staff console | 18; 13; 12; 15 section 16 |

## 4. Conventions used in every document

| Convention | Meaning |
|---|---|
| `code font` | An exact name: table, column, value, endpoint, setting key, job kind, event, screen ID |
| "NN section N" | A reference to another document, for example "09 section 5" |
| Screen IDs | `PUB-*` public pages, `AUTH-*` sign-in, `GATE-*` blocking states, `ONB-*` onboarding, `APP-*` the product, `ME-*` own profile, `SET-*` settings, `ADM-*` staff. Defined in 16 and 18. URLs are in 17, Android keys in 22. |
| Decision IDs | `D-01` and so on, in 02 section 1 |
| Open question IDs | `Q-01` and so on, in 02 section 4 |
| Task IDs | `T-001` and so on, in 21 |
| "Later" or "later phase" | Not part of the launch build. Listed in 21 section 9. |
| "The owner" | In privacy and visibility text, the profile being viewed. In 02, the product owner. Context makes it clear. |
| Day boundaries | `Asia/Karachi` |
| Money | PKR unless a currency is named |

## 5. The product in ten rules

A short version of the rules that shape everything else. Each links to its full definition.

1. A user manages one profile, for themselves or for a family member, and says which ([07](07-onboarding.md)).
2. The candidate is 18 or older. Members only see the opposite gender ([03 section 8](03-domain-model.md)).
3. Where a signed-in user may go is decided by one value from the API, the gate ([03 section 5.1](03-domain-model.md)).
4. An identity document number is collected once, encrypted, never shown, and unique per profile ([12](12-verification-and-trust.md)).
5. Members choose who sees their photos, name, caste, income, family, contact details and activity, and the server enforces it ([09](09-privacy-and-visibility.md)).
6. Matches must fit in both directions. Must-have preferences always exclude ([10](10-matching-and-discovery.md)).
7. Contact starts with an interest. Chat exists only after it is accepted. Declines are quiet ([11](11-interests-connections-chat.md)).
8. Phone numbers and other contact details are revealed only by a deliberate, revocable share ([09 section 10](09-privacy-and-visibility.md)).
9. Photos and free text are moderated before others see them; reports lead to warnings, suspensions or bans that stick ([13](13-safety-and-moderation.md)).
10. Everything is free, and verification always will be ([02](02-decisions-and-feasibility.md)).
