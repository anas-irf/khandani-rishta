# 22. Android App

| | |
|---|---|
| Status | Design complete, not implemented |
| Applies to | `apps/android` (Kotlin, Jetpack Compose, Material 3, Hilt, Navigation 3, Retrofit, OkHttp) |
| Related | [16-screens-and-flows.md](16-screens-and-flows.md) for what each screen contains, [17-web-app.md](17-web-app.md) for the web counterpart, [15-api-contract.md](15-api-contract.md), [06-auth-and-accounts.md](06-auth-and-accounts.md), [14-notifications.md](14-notifications.md), `docs/tech-stack.md` section 9 |

Document 16 says what every screen shows and does, by screen ID. This document says how the Android app is built around those screens. The Android app implements every member screen. It does not implement the public pages (`PUB-*`) or the admin console (`ADM-*`).

## 1. Principles

1. **Same behaviour as the web app.** Same screens, same rules, same wording. When this document and 17 differ, it is only where the platform differs.
2. **Thin client.** No business rules on the device. The API decides; the app displays and sends.
3. **The gate decides where the user is.** `Me.gate` from `GET /v1/me` (03 section 5.1) selects the root of the navigation.
4. **Nothing sensitive at rest.** No member data is written to disk except the image cache and reference data. Tokens are held by the Clerk SDK.
5. **Privacy on the device.** Screenshots are blocked on profile, photo, chat and verification screens.
6. **Right-to-left ready.** `start` and `end` everywhere, never `left` and `right`.

## 2. Package layout

```text
apps/android/app/src/main/java/com/khandanirishta/app/
├── KhandaniApplication.kt        Hilt entry, Clerk and Sentry setup, notification channels
├── MainActivity.kt               single activity, handles notification and link intents
├── core/
│   ├── network/                  generated API client, interceptors, ApiError, ErrorMapper
│   ├── realtime/                 RealtimeClient (OkHttp WebSocket), event models
│   ├── data/                     repositories, one per product area
│   ├── datastore/                AppPreferences (DataStore)
│   ├── push/                     KhandaniMessagingService, NotificationFactory, DeepLinkResolver
│   ├── media/                    photo picking, downscaling, upload with progress
│   └── util/                     formatters (age, height, relative time)
└── ui/
    ├── KhandaniApp.kt            root composable: start-up, gate routing, navigation host
    ├── navigation/               NavKeys.kt, GateRouter.kt, TopLevelBackStacks.kt
    ├── theme/                    colours, typography, shapes
    ├── components/               shared composables (section 11)
    └── feature/
        ├── auth/                 AUTH-SIGNIN
        ├── gates/                GATE-*
        ├── onboarding/           ONB-*
        ├── home/                 APP-HOME, APP-MATCHES
        ├── search/               APP-SEARCH
        ├── profile/              APP-PROFILE, APP-PHOTOS
        ├── interests/            APP-INTERESTS, APP-PHOTO-REQUESTS
        ├── chat/                 APP-CHATS, APP-CHAT, APP-CONNECTION
        ├── lists/                APP-SHORTLIST, APP-VISITORS
        ├── notifications/        APP-NOTIFS
        ├── me/                   ME-*
        └── settings/             SET-*
```

Each feature folder holds, per screen: `XxxScreen.kt` (stateless composable taking state and callbacks), `XxxViewModel.kt` (Hilt, exposes one `StateFlow<XxxUiState>`), and `XxxUiState.kt`.

## 3. Navigation

### 3.1 Keys

Navigation 3 with serializable keys, extending the existing `KhandaniApp.kt`. Every screen ID has exactly one key.

| Screen | Key | Arguments |
|---|---|---|
| `AUTH-SIGNIN` | `SignIn` | |
| `GATE-BLOCKED` | `GateBlocked` | |
| `GATE-DELETION` | `GateDeletion` | |
| `GATE-CONSENT` | `GateConsent` | |
| `GATE-REVIEW` | `GateReview` | |
| `GATE-CHANGES` | `GateChanges` | |
| `GATE-UPGRADE` | `GateUpgrade` | `downloadUrl: String` |
| `ONB-01` to `ONB-11` | `OnboardingStep` | `step: String` (the API step key, for example `education_career`), `edit: Boolean` (true when opened from the review step, 07 section 2) |
| `ONB-DONE` | `OnboardingDone` | |
| `APP-HOME` | `Home` (exists today, repurposed) | |
| `APP-MATCHES` | `Matches` | |
| `APP-SEARCH` | `Search` | `savedSearchId: String?` |
| `APP-PROFILE` | `Profile` | `profileId: String` |
| `APP-PHOTOS` | `PhotoViewer` | `profileId: String`, `index: Int` |
| `APP-INTERESTS` | `Interests` | `box: String` (`received` or `sent`), `interestId: String?` (row to scroll to) |
| `APP-CHATS` | `Chats` | |
| `APP-CHAT` | `Chat` | `connectionId: String` |
| `APP-CONNECTION` | `ConnectionDetails` | `connectionId: String` |
| `APP-SHORTLIST` | `Shortlist` | |
| `APP-VISITORS` | `Visitors` | |
| `APP-NOTIFS` | `Notifications` | |
| `APP-PHOTO-REQUESTS` | `PhotoRequests` | `box: String` |
| `ME-PROFILE` | `MyProfile` | |
| `ME-EDIT` | `EditSection` | `section: String` |
| `ME-PHOTOS` | `MyPhotos` | |
| `ME-PREFS` | `MyPreferences` | |
| `ME-VERIFY` | `Verification` | |
| `ME-VERIFY-ID` | `VerifyIdentity` | |
| `ME-VERIFY-SELFIE` | `VerifySelfie` | |
| `SET-HOME` | `Settings` | |
| `SET-PRIVACY` | `PrivacySettings` | |
| `SET-NOTIFS` | `NotificationSettings` | |
| `SET-CONTACTS` | `ContactDetails` | `focus: String?`, `returnConnectionId: String?` (08 section 3) |
| `SET-BLOCKED` | `BlockedMembers` | |
| `SET-ACCOUNT` | `AccountSettings` | |
| `SET-HELP` | `Help` | |

Legal and help content (`PUB-TERMS`, `PUB-PRIVACY`, `PUB-GUIDELINES`, `PUB-SAFETY`, `PUB-NIKAH`, `PUB-FAQ`) opens the web page in a Chrome Custom Tab.

### 3.2 Start-up and gate routing

```mermaid
flowchart TD
    A[App start: splash] --> B{Clerk initialised?}
    B -- wait --> B
    B -- yes --> U[Check GET /v1/meta/app-release]
    U -- build too old --> GU[GateUpgrade]
    U -- ok --> C{Clerk has an active user?}
    C -- no --> D[SignIn]
    D -- auth complete --> E
    C -- yes --> E[GET /v1/me]
    E -- network error --> X[Error screen with Retry]
    E -- ok --> F[GateRouter picks the root]
```

`GateRouter` (`ui/navigation/GateRouter.kt`) is a pure function, unit-tested for every row:

| `gate` | Root of the back stack |
|---|---|
| `banned`, `suspended` | `GateBlocked` |
| `deletion_scheduled` | `GateDeletion` |
| `consent_required` | `GateConsent` |
| `onboarding` | `OnboardingStep(me.profile.onboarding_step)` |
| `changes_requested` | `GateChanges` (with access to `MyProfile` and `Settings` stacks from its buttons) |
| `pending_review` | `GateReview` (same access) |
| `ok` | The tabbed application, starting on `Home` |

Rules:

- Which other screens each gate may open is defined once, in 16 section 3.2 (for example `Help` from the blocked and onboarding screens, and the own-profile, settings and notification screens while under review). `GateRouter` also exposes `isAllowed(gate, key)`, tested against every row of that table; a key that is not allowed is never pushed.
- Whenever `Me.gate` changes (after any refresh), replace the whole back stack with the new root. Do not animate this as a normal push.
- Refresh `Me` as 16 section 3.3 says: at start, after sign-in, when the app returns to the foreground after 60 seconds or more, after any API error with a gate code (17 section 4.4 lists them), and on the `gate.changed` WebSocket event. The `counters` WebSocket event only replaces `Me.counters` in memory; it causes no fetch.
- `gate = 'ok'` with `profile.status` `paused` or `closed` uses the same status panels as the web app (17 section 4.3).

### 3.3 Tabs and back behaviour

- Five top-level destinations in a `NavigationBar`: `Home`, `Search`, `Interests`, `Chats`, `MyProfile`. Badges on Interests and Chats from `Me.counters`, and the dot on Me, as defined in 16 section 2.1.
- `TopLevelBackStacks` keeps one back stack per tab so that switching tabs preserves where the user was. Selecting the current tab again pops that tab to its root.
- The bar is shown only on the screens 16 section 2.1 names: the five destinations and the list screens reached from them (`Matches`, `Shortlist`, `Visitors`, `Notifications`, `PhotoRequests`, `Settings`). Every other screen (the detail screens, `OnboardingStep`, the gate screens) shows a back arrow and its title instead.
- System Back pops the current tab's stack. At a tab root that is not `Home`, Back goes to `Home`. At `Home`, Back leaves the app.
- In onboarding, Back goes to the previous step screen and never signs the user out. On `ONB-01`, Back leaves the app.

### 3.4 Links and notification taps

`DeepLinkResolver` turns an incoming target into a list of keys to place on the stack (root first), then applies the gate (16 section 4.2): if `isAllowed(gate, key)` is false for the target, the target is dropped and the gate root is shown. A target the gate allows is opened, for example `MyPhotos` while the gate is `pending_review`.

| Source | Form | Resolves to |
|---|---|---|
| Push notification tap | Intent extras `target` and parameters, copied from the push `data` keys defined in 14 section 4 | The screen ID's key with its arguments, on top of the matching tab root |
| App Link | `https://khandanirishta.app/profiles/{profileId}` | `Profile(profileId)` |
| App Link | `https://khandanirishta.app/p/{publicCode}` | Call `GET /v1/profiles/by-code/{publicCode}`, then `Profile(profileId)` |
| App Link | `https://khandanirishta.app/chats/{connectionId}` | `Chat(connectionId)` on the Chats tab |
| App Link | `https://khandanirishta.app/interests` | `Interests("received")` |

App Links need `android:autoVerify="true"` intent filters for the production and staging hosts, and a `/.well-known/assetlinks.json` file served by the web app listing the package name and the release certificate's SHA-256 fingerprint. Other URLs of the site open in the browser. A push whose `target` this build does not know opens `Notifications` (16 section 4.2).

## 4. Authentication

| Piece | Implementation |
|---|---|
| SDK | `com.clerk:clerk-android-ui` (includes the API artefact), configured in `KhandaniApplication` with the publishable key from `BuildConfig` |
| Sign-in screen | Clerk's `AuthView` composable, full screen under a small header with the logo. `onAuthComplete` triggers the `Me` refresh. |
| Methods shown | Whatever is enabled in the Clerk dashboard: Google and email code at launch (06 section 2) |
| Token for API calls | `AuthInterceptor` (section 5.2) calls `Clerk.auth.getToken()` |
| Sign-out | From `AccountSettings`, in the order of 06 section 10.1: close the WebSocket, `DELETE /v1/me/devices/{push_token}` (ignore a failure), `Clerk.auth.signOut()`, clear repositories and the image cache, show `SignIn` |
| Sign-in and security | The "Sign-in and security" row on `SET-ACCOUNT` opens Clerk's `UserProfileView` for the email address, connected Google account and devices (06 section 12). `UserButton` is not used. |
| Account deletion | Always through our own flow (`SET-ACCOUNT`, 06 section 9). The delete row inside `UserProfileView` is hidden because self-deletion is switched off in the Clerk dashboard. |

Google sign-in on Android needs the OAuth clients and fingerprints described in 06 section 4.

## 5. Networking

### 5.1 Client

- Retrofit service interfaces generated from `packages/api-contract/openapi.json` with OpenAPI Generator (tech stack section 9). Never hand-write request or response models.
- One `OkHttpClient` for the API (and a second one, without the auth interceptor, for uploads to presigned R2 URLs).
- Timeouts: connect 10 s, read 30 s, write 30 s.

### 5.2 Interceptors, in order

| Interceptor | Behaviour |
|---|---|
| `AppHeadersInterceptor` | Adds `x-app-platform: android`, `x-app-version-code: <BuildConfig.VERSION_CODE>`, `Accept-Language: <current locale>` |
| `AuthInterceptor` | For every request except `/v1/meta*`, `/v1/reference/*`, `/healthz`: obtains a token with `Clerk.auth.getToken()` (blocking on the OkHttp thread) and adds `Authorization: Bearer`. On a `401` response, fetches a token with the cache skipped and retries once. A second `401` signs the user out. |
| Sentry OkHttp integration | Breadcrumbs without bodies or query strings |

### 5.3 Errors

`ErrorMapper` converts a failed response into `ApiError(status, code, message, fields, details, requestId)` by parsing the body from 15 section 2. Repositories return `Result<T>` with this error. The handling table is the same as the web app's (17 section 6.4), with these Android specifics:

| `code` | Android behaviour |
|---|---|
| `upgrade_required` | Navigate to `GateUpgrade(details.download_url)` |
| Gate codes | Refresh `Me`; the gate router replaces the stack |
| `limit_reached` | A dialog composable shared by all screens |
| Network failure (`IOException`) | Inline "No connection" state with Retry; a snackbar for actions |

## 6. State and data

| Topic | Rule |
|---|---|
| Screen state | One immutable `UiState` data class per screen, exposed as `StateFlow` from the ViewModel, collected with `collectAsStateWithLifecycle()` |
| Repositories | `MeRepository`, `ReferenceRepository`, `ProfileRepository` (own profile, photos, preferences, privacy, identity, verification), `DiscoveryRepository`, `InterestRepository`, `ConnectionRepository`, `RelationRepository` (shortlist, pass, block, photo access, reports), `NotificationRepository`. Singletons provided by Hilt. |
| Shared state | `MeRepository.me: StateFlow<Me?>` is the single holder of `Me`, counters included. `ConnectionRepository` holds the chat list and open conversations in memory. |
| Lists | Paging 3 with a `PagingSource` per cursor endpoint. Pull to refresh on every list. |
| Refresh rules | Mirror the web invalidation table (17 section 6.3): after a mutation, refresh the same data the web app invalidates. |
| Optimistic updates | Only for the cases of 16 section 1.2 rule G7: the "sending" state of a chat message, shortlist on and off, pass and its undo, marking notifications or messages read, mute and archive |
| Persistence | No Room database. Nothing from the member APIs is written to disk. |
| Reference data | `ReferenceRepository` stores the bootstrap JSON and its `version` in a file in the app's private storage and revalidates with `If-None-Match` at start. Label lookup falls back to the code with underscores replaced by spaces. |
| Process death | Screen arguments survive through the serializable keys. Form input in onboarding survives through `rememberSaveable` and, more importantly, through the server: each step is saved when the user continues. |
| Client events | `Tracker.track(name, properties)` as specified in 20 section 8.3: an in-memory buffer flushed to `POST /v1/events` at 20 events, every 30 seconds, and when the app goes to the background. The only events at launch are the onboarding funnel events in 07 section 17. |

`AppPreferences` (DataStore) holds only: `locale`, `lastUpdatePromptAt`, `notificationPermissionAsked`, `pushToken`.

## 7. Real-time

`RealtimeClient` wraps an OkHttp `WebSocket`. Protocol: 19 section 4. Behaviour mirrors 17 section 7.

| Topic | Rule |
|---|---|
| When connected | While the app is in the foreground (`ProcessLifecycleOwner` started) and `Me.gate` is not `banned`, `suspended` or `deletion_scheduled` (the server refuses those sockets with close code 4403). Members in onboarding or under review are connected too, so that they receive `photo.updated` and `gate.changed` (19 section 4.2). Disconnect 30 seconds after the app goes to the background. Push notifications cover the background. |
| Handshake | On open, send the `auth` frame with a fresh token; wait for `ready` |
| Keep-alive | `ping` every 30 seconds; treat 45 seconds without a `pong` as a dead connection and reconnect (19 section 4.3) |
| Reconnect | Backoff 1 s, 2 s, 4 s, up to 30 s, with jitter (19 section 4.8). Reconnect at once when connectivity returns (`ConnectivityManager` callback). |
| After reconnect | The resync steps of 19 section 4.8: take the counters from `ready`; refresh `Me` only when it was last fetched more than 60 seconds ago; refresh the chat list, the interests list or the notification feed when that screen is visible; for an open conversation fetch messages with `after=<newest known id>` while `has_more`, then refetch the connection |
| Fallback | While disconnected with a conversation open, poll that conversation every 15 seconds and `GET /v1/connections/{id}` every 60 seconds. Elsewhere in the app, refresh `Me` every 60 seconds for the counters (11 section 6.4). |
| Events | Exposed as a `SharedFlow<RealtimeEvent>`; repositories subscribe and update their in-memory state exactly as the web table in 17 section 7.2 describes |
| Sending | Messages go through `POST /v1/connections/{id}/messages` with a `client_message_id` (`UUID.randomUUID()`), optimistic entry, replace on success, "Retry" on failure with the same id |
| Suppressing push | When a `message.new` event arrives for the conversation currently on screen, no notification is shown |

## 8. Push notifications

Payload shapes, notification types and channels are defined in 14 section 4. This section covers the device side.

| Topic | Rule |
|---|---|
| Service | `KhandaniMessagingService : FirebaseMessagingService` |
| Token registration | In `onNewToken`, after every successful sign-in, and on every app start with a session (14 section 4.4), call `POST /v1/me/devices` with `platform = "android"`, the token, `app_version` and `device_model`. Store the token in `AppPreferences`. |
| Token removal | On sign-out, `DELETE /v1/me/devices/{push_token}` |
| Message type | Data messages only. `onMessageReceived` builds the notification locally from `type` and `data`, with text from string resources in the device language. |
| Privacy of content | Never show message text or a display name: the payload carries neither (14 section 4.1). The title is the app name and the body is the fixed string for the push `type` (14 section 4.2). Set `VISIBILITY_PRIVATE` with a generic public version ("New activity on Khandani Rishta") for the lock screen. |
| Channels | Created at start with the ids and importance from 14 section 4 |
| Tap | A `PendingIntent` to `MainActivity` carrying `target` and its parameters; `DeepLinkResolver` handles it (section 3.4) |
| Grouping | Every push uses the collapse key of 14 section 4.2 as its Android tag, so chat notifications are one notification per connection (tag `msg_<connection_id>`), updated in place |
| Foreground | If the target screen is already visible, do not show a notification. A `message` push that arrives while the socket is open shows nothing (14 section 4.3). |
| Permission (Android 13 and later) | Ask for `POST_NOTIFICATIONS` on `ONB-DONE`, after a short explanation screen. If refused, show a one-line reminder on `SET-NOTIFS` with a button to system settings. Ask at most once automatically (`notificationPermissionAsked`). |
| Devices without Google Play services | Push is unavailable. The app works; counters update while it is open. |

`google-services.json` is not committed. It is provided by CI from a secret and placed locally by each developer (add it to `.gitignore`).

## 9. Photos and camera

| Task | Implementation |
|---|---|
| Choosing profile photos | The system Photo Picker (`PickVisualMedia`, images only). No storage permission. |
| Preparing a photo | Exactly as 08 section 5.1 describes: decode with sampling, rotate according to the EXIF orientation, reject below 400 by 400 pixels, scale so the long side is at most 2,048 pixels, compress to JPEG quality 90 into the app cache directory. If preparation fails on the device, upload the original file when it is within the limits. |
| Uploading | `POST /v1/me/photos/uploads`, then `PUT` to the presigned URL with a progress-reporting `RequestBody` and the headers from the response, then `POST /v1/me/photos`. Delete the temporary file. Rules: 08 section 5. |
| Selfie for verification | CameraX with the front camera, an on-screen frame and the day's gesture illustrated. Capture only: no gallery option. Needs the `CAMERA` permission, requested on `ME-VERIFY-SELFIE` with an explanation. |
| Identity document photos | CameraX with the back camera and a card-shaped guide, or the Photo Picker |
| Displaying member photos | Coil. Use the URL without its query string as the memory and disk cache key, because the signature in the query string changes every hour while the object path (which contains the photo id and the variant name) does not (08 section 5.4). |
| Image cache | Coil's disk cache in the app's private cache directory, capped at 100 MB, cleared on sign-out |

## 10. Privacy protections on the device

| Protection | Where |
|---|---|
| `WindowManager.LayoutParams.FLAG_SECURE` (blocks screenshots and screen recording, and hides the screen in the recent-apps view) | Applied while the screens of 16 section 1.2 rule G17 are on screen: `Profile`, `PhotoViewer`, `Chat`, `ConnectionDetails`, `VerifyIdentity`, `VerifySelfie`. Implemented as a `SecureScreen` composable effect that sets the flag on entry and clears it on exit. |
| No copy of shared contact details to logs | Never log response bodies |
| Clipboard | Copying a shared phone number is allowed (the member chose to share it). Chat text can be copied by long-press. |
| Backups | Keep the existing backup rules: exclude DataStore and caches from cloud backup and device transfer |
| Biometric app lock | Not at launch |

## 11. Shared composables (`ui/components/`)

The Android equivalents of the web components in 17 section 10, with the same names where possible: `ProfileCard`, `MemberPhoto` (blur overlay with a lock and "Photo is private"; silhouette when there is no photo), `CompatBadge`, `BadgeRow`, `ReasonChips`, `LockedValue`, `SectionCard`, `StatusBanner`, `EmptyState`, `ErrorState`, list and card skeletons, `ConfirmDialog`, `LimitDialog`, `ReportDialog`, `BlockDialog`, `RelativeTime`.

Form fields mirror 17 section 8.2: `TextField`, `SelectField` (a modal bottom sheet list), `SearchSelectField` (full-screen search list), `MultiSelectField` (chips), `CityPickerField`, `DateOfBirthField` (three pickers, not the Material calendar, because scrolling decades in a calendar is slow), `HeightField`, `PhoneField`, `IdentityNumberField` (with a visual transformation for the mask), `RangeField`, `ImportanceField`, `RadioCardsField`, `ConsentCheckbox`.

Server validation errors map onto fields exactly as on the web (17 section 8.3).

## 12. Theme, language, accessibility

| Topic | Rule |
|---|---|
| Colours | Material 3 colour scheme built from the tokens in 17 section 9.3 (primary `#0F766E`, tertiary `#B45309`, error `#B91C1C`, background `#FAFAF9`). Dynamic colour is off so the brand is consistent. Light theme only at launch. |
| Typography | Material 3 type scale; body text at least 16 sp. Honour the system font scale up to 200% without clipping. |
| Shapes | 12 dp cards, 8 dp inputs |
| Touch targets | At least 48 dp |
| Language | Per-app language with `AppCompatDelegate.setApplicationLocales`. The choice on `SET-ACCOUNT` calls `PATCH /v1/me` and switches the app. `android:supportsRtl="true"` stays on. Urdu strings (`values-ur`) are added in the Urdu phase. |
| Strings | Everything in `strings.xml`. Enumeration labels come from the reference data, not from resources. |
| Content descriptions | Every icon button and every member photo ("Photo of <display name>" or "Private photo") |
| TalkBack | Profile cards are one focusable item with a combined description; actions are custom accessibility actions |
| Numbers and dates | Western digits; dates with `java.time` and the active locale |

## 13. Updates

The app is distributed as an APK outside the Play Store (tech stack section 9).

| Check | Behaviour |
|---|---|
| At start and once every 24 hours in the foreground | `GET /v1/meta/app-release?platform=android` |
| `min_supported_version_code > BuildConfig.VERSION_CODE` | `GateUpgrade`: a blocking screen with the release notes and a "Download update" button that opens `download_url` in the browser. No way past it. |
| `version_code > BuildConfig.VERSION_CODE` otherwise | A dismissible banner on `APP-HOME`, "A new version is available" with "Update", at most once a day (`lastUpdatePromptAt`; 16 section 6.2) |
| Any API response `426 upgrade_required` | `GateUpgrade` with `details.download_url` |

`GATE-UPGRADE` explains in one sentence that Android will ask for permission to install from the browser.

## 14. Build configuration

| Item | Value |
|---|---|
| `BuildConfig.API_BASE_URL` | From `local.properties` (key `API_BASE_URL`), default `http://10.0.2.2:8787` for the emulator |
| `BuildConfig.CLERK_PUBLISHABLE_KEY` | From `local.properties` (key `CLERK_PUBLISHABLE_KEY`), see 06 section 13 |
| `BuildConfig.WEB_BASE_URL` | From `local.properties` (key `WEB_BASE_URL`), used for legal pages and share links |
| `BuildConfig.SENTRY_DSN` | From `local.properties` (key `SENTRY_DSN`), optional |
| Build types | `debug` (staging or local API, cleartext allowed to `10.0.2.2` only), `release` (production API, minified, signed in CI) |
| Network security config | Cleartext traffic off, except the emulator host in debug |
| Permissions | `INTERNET`, `POST_NOTIFICATIONS`, `CAMERA`. No location, contacts or storage permissions. |

## 15. Tests

| Level | What |
|---|---|
| Unit (JUnit) | `GateRouter` for every gate, `DeepLinkResolver` for every row of 3.4, `ErrorMapper`, formatters (age, height in feet and inches, relative time), the identity number visual transformation, message deduplication in `ConnectionRepository` |
| ViewModel | Each onboarding step ViewModel: valid save, validation error mapping, continue. Chat ViewModel: send, fail, retry, incoming event. |
| Compose UI | `ProfileCard` with blurred and missing photos and locked values; the interest action bar for each `Relation` state; onboarding step forms |
| Manual release checklist | Sign-in with Google and with email; onboarding end to end; photo upload; push received in background and tap opens the right screen; screenshot blocked on profile and chat; forced update screen; language switch |
