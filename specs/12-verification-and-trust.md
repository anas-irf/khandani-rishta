# 12. Verification and Trust

| | |
|---|---|
| Status | Design complete, not implemented |
| Related | [03-domain-model.md](03-domain-model.md) section 4.6, [04-database-schema.md](04-database-schema.md) sections 5.4 and 6, [15-api-contract.md](15-api-contract.md) sections 7 and 9, [13-safety-and-moderation.md](13-safety-and-moderation.md), [18-admin-console.md](18-admin-console.md) section 4.4, [20-non-functional.md](20-non-functional.md) section 2 |

Fake profiles are the first complaint about every rishta platform. This document defines how a member proves they are a real, single, adult person, what each proof is worth, and how the proofs are handled safely. Every check here is free for the member and always will be.

## 1. Trust model

### 1.1 The badges

| Badge | Column | How it is earned | What it proves | What it does not prove |
|---|---|---|---|---|
| `phone_verified` | `profiles.is_phone_verified` | Clerk confirmed a phone number by SMS code (06 section 11). Not available at launch. | Someone controls that phone number | Who that person is |
| `photo_verified` | `profiles.is_photo_verified` | A moderator compared a live selfie with the profile photos (section 4) | The profile photos show the person who took the selfie | Name, age, marital status |
| `id_verified` | `profiles.is_id_verified` | A moderator checked the identity document against the profile and a live selfie (section 5) | The name, date of birth and gender on the profile match a real identity document, and the document belongs to the person in the photos | Marital status, education, income, family details, intentions |
| `new` | computed | `first_activated_at` within the last 7 days | Nothing. It is a freshness label. | |

Entering an identity number without verifying the document earns no badge. The number alone gives uniqueness (one profile per person) and a ban that sticks.

### 1.2 How badges are shown

| Place | Rule |
|---|---|
| Profile card (`ProfileCard.badges`) | By the name, as words with a tick ("ID verified", "Photo verified", "Phone verified"), never icons alone, in the order `id_verified`, `photo_verified`, `phone_verified`; `new` as a "New" label on the photo. Only earned badges appear. |
| Profile screen (`APP-PROFILE`) | A "Verification" block listing each earned badge with one line of plain text: "Identity document checked by our team", "Photos checked against a live selfie", "Phone number confirmed". Unearned checks are not listed (no red crosses on another member's profile). |
| Own profile (`ME-PROFILE`, `ME-VERIFY`) | All three checks with their state and a button to start each one. |
| Wording | Never "100% genuine" or "guaranteed". The fixed disclaimer under the block: "Verification confirms identity details only. Always take your own care and involve your family." |

### 1.3 Who the checks are about

Every check is about the **candidate**, never the manager. When a parent manages the profile, the identity number, the document and the selfie are the son's or daughter's. The screens say so in the first sentence (section 8).

## 2. The identity number: purpose, consent and protection

### 2.1 Why it is collected

| Purpose | How the number serves it |
|---|---|
| One profile per person | `profile_identity.number_hash` is unique |
| Bans that last | The hash of a banned person's number goes into `banned_identities` |
| A basic sanity check | For CNIC and NICOP the last digit must agree with the stated gender |
| The base for document verification | The moderator compares the uploaded card with the registered number |

The number is not used for anything else. It is not shown to anyone, not shared with any third party, and not sent to NADRA (the project has no access to NADRA's services).

### 2.2 Consent text

Shown on `ONB-10` and on `ME-VERIFY-ID`, directly above the number field. The member confirms by submitting the form; no extra checkbox.

> **Why we ask for the CNIC number**
>
> We ask for the candidate's CNIC (or NICOP, POC or passport) number so that each person can have only one profile, and so that anyone removed for bad behaviour cannot come back.
>
> - It is never shown on the profile or to any other member.
> - It is stored encrypted. Only the last four digits are ever displayed, and only to you.
> - We do not share it with anyone outside Khandani Rishta.
> - It is deleted when the account is deleted.

### 2.3 How it is protected

| Layer | Rule |
|---|---|
| In transit | HTTPS only. The number appears in exactly one request body: `PUT /v1/me/identity`. |
| At rest | `number_encrypted`: AES-256-GCM with the key `IDENTITY_ENCRYPTION_KEY`, a fresh random 12-byte nonce per write, stored as nonce, then ciphertext, then tag (04 section 5.4). The associated data is the 16 bytes of the `profile_id` (20 section 2.1). |
| Lookup | `number_hash`: `HMAC-SHA256` with `IDENTITY_HASH_PEPPER` over the namespaced, normalised number (section 3.4). Equality checks use the hash; nothing is ever decrypted to compare. |
| Display to the owner | `IdentitySummary.number_masked`: asterisks for every character except the last four, for example `*********1234`. |
| Display to others | Never. No member response contains any part of the number. |
| Staff access | The decrypted number is returned only by `GET /v1/admin/verifications/{request_id}`, and each such call writes a `verification.view` audit entry (18 section 8). |
| Logs and errors | The request body of `PUT /v1/me/identity` is never logged. The Rust type holding the plain number does not implement `Debug` or `Serialize`, and is zeroed on drop (`zeroize`). Sentry breadcrumbs for this route carry no body. |
| Keys | Two separate secrets, never committed, documented in 20 section 2. Losing the encryption key makes the numbers unreadable but the hashes still work. |
| Deletion | The `profile_identity` row is deleted in the account purge (04 section 12 step 1). |

## 3. Identity number validation

Rules for `PUT /v1/me/identity` with body `{ "document_type": ..., "number": ... }`.

### 3.1 Which document

| `document_type` | For whom | Offered when |
|---|---|---|
| `cnic` | Pakistani citizens living in Pakistan | Default when `nationality_code = 'PK'` and `country_code = 'PK'` |
| `nicop` | Pakistani citizens living abroad | Default when `nationality_code = 'PK'` and `country_code <> 'PK'` |
| `poc` | Foreign nationals of Pakistani origin or married to a Pakistani | Selectable by anyone |
| `passport` | Anyone without one of the above | Default when `nationality_code <> 'PK'` |

The default only preselects the picker. The member may choose any type.

### 3.2 Normalisation

Applied by the API before any check, and by the clients before sending (the clients' work is a convenience; the API never trusts it).

1. Trim.
2. Remove every space and every hyphen.
3. Convert to upper case.

`35202-1234567-1`, `35202 1234567 1` and `3520212345671` all normalise to `3520212345671`.

### 3.3 Format rules

Checked in this order. The first failure is returned as `400 validation_failed` on field `number` with the code shown.

| # | Applies to | Rule | Field code | Message |
|---|---|---|---|---|
| 1 | All | Not empty after normalisation | `required` | Enter the number. |
| 2 | `cnic`, `nicop`, `poc` | Exactly 13 characters, all digits `0-9` | `invalid` | A CNIC number has 13 digits. |
| 3 | `cnic`, `nicop` | First digit is 1 to 8 | `invalid` | This does not look like a valid CNIC number. |
| 4 | `cnic`, `nicop` | Not thirteen identical digits and not `1234567890123` | `invalid` | This does not look like a valid CNIC number. |
| 5 | `cnic`, `nicop` | The last digit agrees with `profiles.gender`: odd for `male`, even (including 0) for `female` | `mismatch` | This number does not match the gender on the profile. Please check the number and the gender. If both are correct, contact support. |
| 6 | `passport` | 6 to 12 characters, each `A-Z` or `0-9`, at least one digit | `invalid` | A passport number has 6 to 12 letters and digits. |

Notes:

- The CNIC has no checksum. Rules 2 to 5 are all that can be checked without NADRA.
- The first digit encodes the province of issue. Values 1 to 7 are certain; 8 is reported for Azad Kashmir. Accept 1 to 8.
- Rule 5 needs `profiles.gender`. If the gender is not set yet (the basics step was skipped somehow), answer `409 invalid_state`.
- Rule 5 is a typing check as much as a fraud check: most mismatches are a wrong digit or a profile created under the wrong gender. Genuine exceptions are rare and go through support, where an admin can correct the gender (18 section 5) or record the number after seeing the card.
- `poc` has no gender rule because the meaning of its digits is not confirmed.
- Nothing about age or name can be derived from the number.

### 3.4 Hash and uniqueness

```text
namespace = "pk_id"     for cnic and nicop     (a person's NICOP carries the same 13 digits as their CNIC)
            "poc"       for poc
            "passport"  for passport
hash_input  = namespace + ":" + normalised_number
number_hash = HMAC-SHA256(IDENTITY_HASH_PEPPER, hash_input)
```

Checks after the format rules, in this order:

| # | Check | On failure |
|---|---|---|
| 1 | `banned_identities` has no row `('identity_document', number_hash)` | `409 identity_already_registered` |
| 2 | No other profile has this `number_hash` | `409 identity_already_registered` |

Both failures return the same code and the same message so that nothing is revealed about bans: "This number is already registered with another profile. If you believe this is a mistake, contact support." Because `cnic` and `nicop` share a namespace, a person cannot hold one profile under each.

The unique index on `number_hash` is the final guard against two concurrent requests. Map its violation to the same `409`.

### 3.5 Saving

In one transaction, upsert `profile_identity` for the caller's profile:

| Column | Value |
|---|---|
| `document_type` | From the request |
| `number_encrypted` | Encryption of the normalised number |
| `number_hash` | As above |
| `number_last4` | The last four characters of the normalised number |
| `status` | `unverified` |
| `verified_at` | `NULL` |

Then recompute `profiles.completeness`. Return `IdentitySummary`.

### 3.6 When the number may be changed

| Current `profile_identity.status` | `PUT /v1/me/identity` |
|---|---|
| No row | Allowed |
| `unverified` | Allowed. Replaces the row. |
| `rejected` | Allowed. Replaces the row and sets `status = 'unverified'`. |
| `pending` | `409 invalid_state`. The member must cancel the pending verification request first (`DELETE /v1/me/verifications/{request_id}`), which sets the status back to `unverified`. |
| `verified` | `409 invalid_state`. A verified number can be changed only by support. |

There is no endpoint to delete the number. When `onboarding.identity_required` is false, a member who skipped the step simply has no row.

### 3.7 Input mask

For `cnic`, `nicop` and `poc` the clients show the mask `#####-#######-#`: a numeric keypad, hyphens inserted automatically after the 5th and 12th digit, and the submit button enabled only at 13 digits. For `passport` a plain text field that upper-cases as the member types. The client strips the hyphens before sending.

## 4. Photo (selfie) verification

Proves that the profile photos show the person who holds the phone.

### 4.1 Preconditions

| Condition | Otherwise |
|---|---|
| The profile has at least one `approved` photo | `409 invalid_state`; `ME-VERIFY-SELFIE` shows "Add a photo first" with a link to `ME-PHOTOS` |
| No `pending` selfie request exists | `409 already_exists` |
| The profile is not `closed` or `suspended` | `403` (03 section 5) |

### 4.2 The gesture challenge

`GET /v1/me/verifications/selfie-challenge` returns one of `peace_sign`, `thumbs_up`, `open_palm`, `hand_on_head`.

```text
gestures = [peace_sign, thumbs_up, open_palm, hand_on_head]
day      = today's date in Asia/Karachi, as YYYY-MM-DD
digest   = SHA-256(profile_id as text + ":" + day)
gesture  = gestures[digest[0] mod 4]
```

It needs no storage and is stable for the day. The gesture stops someone from submitting a selfie-style photo taken from the internet. On submission, `gesture` in the body must equal the challenge for today or for yesterday (so a selfie taken just before midnight is not refused); otherwise `400 validation_failed`, field `gesture`, code `mismatch`.

| Gesture | Instruction shown | Illustration |
|---|---|---|
| `peace_sign` | Hold up two fingers next to your face | A simple line drawing per gesture, shipped with the clients |
| `thumbs_up` | Give a thumbs up next to your face | |
| `open_palm` | Show your open palm next to your face | |
| `hand_on_head` | Place one hand flat on top of your head | |

### 4.3 Capture and upload

| Client | Capture rule |
|---|---|
| Android | Front camera only, through CameraX inside the app. No gallery picker on this screen. |
| Web on a phone | `<input type="file" accept="image/*" capture="user">`, which opens the front camera. |
| Web on a desktop | The browser camera through `getUserMedia` with a capture button. If no camera is available, show "Open Khandani Rishta on your phone to take the selfie". No file upload. |

The live-capture rule is a deterrent, not a guarantee; a determined person can bypass the web control. The moderator's eyes are the real check.

Steps:

1. `GET /v1/me/verifications/selfie-challenge` and show the instruction.
2. Capture. Show the result with "Use this photo" and "Retake". Downscale on the device to at most 1600 pixels on the long side, JPEG.
3. `POST /v1/me/verifications/uploads` with `{ "slot": "selfie", "content_type": "image/jpeg", "size_bytes": n }` (maximum 10 MB), then `PUT` the file to the returned URL.
4. `POST /v1/me/verifications` with `{ "kind": "selfie", "selfie_key": "...", "gesture": "..." }`.
5. Show "Submitted. We usually review within 24 hours."

The API verifies that `selfie_key` starts with `verification/{caller's profile_id}/` and that the object exists.

### 4.4 Review

The moderator sees the selfie beside every `approved` photo of the profile (18 section 4.4) and answers three questions:

1. Is the requested gesture clearly performed? If not: reject with `gesture_missing`.
2. Is the face clearly visible, unedited and unfiltered? If not: reject with `unreadable`.
3. Is it the same person as in the primary photo and the other approved photos? If not: reject with `face_mismatch`. If the selfie is fine but one of the other photos shows someone else, approve the selfie only after rejecting that photo (`not_the_candidate`).

### 4.5 Outcome

| Decision | Effects |
|---|---|
| Approve | `verification_requests.status = 'approved'`; `profiles.is_photo_verified = true`; `match_stale = true`; notification `verification_approved` with `data.kind = 'selfie'`; `media_purge_after = now() + verification.media_retention_days` |
| Reject | `status = 'rejected'` with `rejection_reason`; notification `verification_rejected`; same `media_purge_after`. The member may submit again at once. |

### 4.6 When the badge is cleared

`profiles.is_photo_verified` is set back to `false` when:

| Event | Reason |
|---|---|
| A different photo becomes primary (`PATCH /v1/me/photos/{photo_id}` or the automatic promotion after the primary is deleted) | The badge vouches for the face other members see first |
| The profile has no `approved` photo left | Nothing left to vouch for |

Adding or deleting non-primary photos does not clear it. In manual photo review, the moderator sees a "photo-verified profile" marker on new photos and rejects those that show a different person. When the badge is cleared, the member gets no notification; `ME-VERIFY` and a home nudge (`verify_photo`) show that it can be done again.

### 4.7 Managed profiles

When `managed_by` is not `self`, the selfie must be the candidate's, taken by or with the candidate. The screen says: "This selfie must be of {first_name}, the person this profile is for." A selfie of the parent is rejected with `face_mismatch`.

## 5. Identity document verification

Proves that the name, date of birth and gender on the profile come from a real identity document that belongs to the person in the photos.

### 5.1 Preconditions

| Condition | Otherwise |
|---|---|
| A `profile_identity` row exists with status `unverified` or `rejected` | `409 invalid_state`; the screen first asks for the number |
| No `pending` `id_document` request exists | `409 already_exists` |
| The profile has at least one `approved` photo | Not required. The selfie in the request is compared with the document. If photos exist they are compared too. |

### 5.2 What the member uploads

| Slot | Required for | Content |
|---|---|---|
| `front` | All types | Front of the card, or the photo page of the passport. All four corners visible, no glare. |
| `back` | `cnic`, `nicop`, `poc` | Back of the card |
| `selfie` | All types | A live selfie with today's gesture (section 4.2), captured as in 4.3 |

Card images may come from the camera or the gallery. Each file is at most 10 MB, JPEG, PNG or WebP. Flow:

1. Three (or two) calls to `POST /v1/me/verifications/uploads`, one per slot, each followed by the `PUT`.
2. `POST /v1/me/verifications` with `{ "kind": "id_document", "front_key": ..., "back_key": ..., "selfie_key": ..., "gesture": ... }`.
3. The API checks the keys' prefix and existence, creates the request, and sets `profile_identity.status = 'pending'`.

### 5.3 Moderator checklist

The review screen (18 section 4.4) shows the three images, the decrypted registered number, and the profile's names, date of birth, gender and approved photos. The moderator works through this list in order and stops at the first failure.

| # | Check | Pass when | Reject reason on failure |
|---|---|---|---|
| 1 | Readability | Every printed field and the photo on the card can be read | `unreadable` |
| 2 | Genuine card | No sign of editing: consistent fonts, no pasted photo, no mismatched edges, not a photo of a screen showing someone else's card from the internet | `suspected_fraud` |
| 3 | Number | The identity number printed on the card equals the registered number shown on the screen, digit for digit | `document_mismatch` |
| 4 | Name | The name on the card is the profile's `first_name` and `last_name`. Allow spelling variants of the same name (Mohammad, Muhammad, Mohd; Ayesha, Aisha), a missing or extra middle name, and different order. A different person's name fails. | `document_mismatch` |
| 5 | Date of birth | Exactly equals `profiles.date_of_birth` | `document_mismatch` (see 5.5) |
| 6 | Age | The date of birth on the card makes the person 18 or older today | `underage` |
| 7 | Gender | The card's gender matches the profile | `document_mismatch` |
| 8 | Expiry | The card is not expired on the day of review. "Lifetime" cards pass. | `expired_document` |
| 9 | Gesture | The selfie shows today's or yesterday's gesture for this profile | `gesture_missing` |
| 10 | Face | The person in the selfie is the person on the card and, where photos exist, the person in the approved profile photos | `face_mismatch` |

A married woman's card shows her husband's name in place of the father's name. A moderator who sees a husband's name on the card of a profile that states `never_married` rejects with `document_mismatch`, adds a `reviewer_note`, and files nothing further; repeated attempts are a reason for a manual report (13 section 6).

On an `underage` finding the moderator also suspends the account pending admin review (13 section 7).

### 5.4 Outcome

| Decision | Effects (one transaction) |
|---|---|
| Approve | `verification_requests.status = 'approved'`; `profile_identity.status = 'verified'`, `verified_at = now()`; `profiles.is_id_verified = true`; `match_stale = true`; `first_name`, `last_name` join the profile's locked fields (03 section 8 rule 15); audit `verification.approve`; notification `verification_approved` with `data.kind = 'id_document'`; `media_purge_after` set |
| Reject | `verification_requests.status = 'rejected'` with `rejection_reason` and optional `reviewer_note` (staff only); `profile_identity.status = 'rejected'`; audit `verification.reject`; notification `verification_rejected`; `media_purge_after` set |
| Member cancels | `status = 'cancelled'`; `profile_identity.status = 'unverified'`; `media_purge_after = now()` |

An approved identity verification also sets `is_photo_verified = true` when the profile has an approved primary photo and the moderator ticked "selfie matches the profile photos" (check 10 was done against the photos). This saves the member a second submission.

### 5.5 Date-of-birth mismatch

The date of birth is locked after onboarding, so the member cannot fix a wrong one alone.

1. The moderator rejects with `document_mismatch` and writes the card's date in `reviewer_note`.
2. The rejection message tells the member to contact support if the date on the profile was entered wrongly (section 8.3).
3. On the member's email, an admin corrects the date with `PATCH /v1/admin/profiles/{profile_id}/locked-fields` (18 section 5), provided the corrected date still makes the candidate an adult. The member then submits again.
4. If the true date makes the candidate under 18, the admin does not correct anything: the account is banned with the reason `underage`.

## 6. Storage and retention of verification images

| Topic | Rule |
|---|---|
| Location | The private media bucket of the environment, keys `verification/{profile_id}/{uuid}` |
| Upload | Presigned `PUT`, valid 10 minutes, bound to the declared content type |
| Who can read | Nobody through member APIs, not even the owner after upload. Moderators receive presigned `GET` URLs valid for 10 minutes from `GET /v1/admin/verifications/{request_id}` only. |
| Processing | None. The images are not re-encoded, not resized and not sent to any third-party service. |
| Not confirmed uploads | Objects under `verification/` not referenced by any request are deleted by `cleanup_uploads` after 24 hours |
| Retention | `media_purge_after = decision time + verification.media_retention_days` (default 30). For a cancelled request it is the cancellation time. |
| Purge | The `purge_verification_media` job (daily) selects requests with `media_purge_after <= now()` and `media_purged_at IS NULL`, deletes the objects named by `front_key`, `back_key` and `selfie_key`, sets the three key columns to `NULL` and sets `media_purged_at = now()` |
| What remains | The request row with its kind, status, reason, reviewer and dates. No image. |
| Account purge | All objects under `verification/{profile_id}/` are deleted with the account (06 section 9.4) |
| Reopening a decision | Not possible after the purge. The member submits again. |

The 30 days exist so that a disputed decision can be re-examined. They are kept short because identity images are the most dangerous data the project holds.

## 7. What verification changes in the product

| Area | Effect | Defined in |
|---|---|---|
| Daily interests | `limits.interests_per_day_verified` (20) instead of `limits.interests_per_day` (10) when `is_id_verified` or `is_photo_verified` | 03 section 7 |
| Receiving interests | A member can set `interest_permission = 'verified_only'`: only senders with `is_id_verified` or `is_photo_verified` may send | 09 section 7 |
| Search | The `verified_only` filter keeps profiles with `is_id_verified` or `is_photo_verified` | 15 section 4.8 |
| Ranking | Each badge raises the quality factor of the profile in other members' recommendations | 10 |
| Profile | Badges on the card and the verification block (section 1.2) | |
| Names | Locked after identity verification | 03 section 8 rule 15 |
| Completeness | Providing the number, and each badge, adds points | 08 section 6 |
| Nudges | `verify_identity` and `verify_photo` on `APP-HOME` until done | 15 section 10 |

"Verified" in a limit, filter or permission always means `is_id_verified OR is_photo_verified`. `is_phone_verified` alone does not count.

Verification is never required to browse, to receive interests or to chat, and is never sold.

## 8. Member-facing copy

English text for the i18n catalogue. `{name}` is the candidate's first name; when `managed_by = 'self'` use "you / your" forms.

### 8.1 `ME-VERIFY` (verification centre)

| Element | Text |
|---|---|
| Title | Verification |
| Intro | Verified profiles get more replies and can send more interests each day. It is free. |
| Row 1 title | Identity document |
| Row 1 states | Not started: "Add your CNIC number, then upload the card." / Number added: "Upload the card to get the badge." / `pending`: "Under review. We usually finish within 24 hours." / `verified`: "Verified on {date}." / `rejected`: "Not approved: {reason text}. You can try again." |
| Row 2 title | Photo check |
| Row 2 states | No approved photo: "Add a photo first." / Not started: "Take a quick selfie so members know your photos are really you." / pending: "Under review." / verified: "Verified." / rejected: "Not approved: {reason text}. You can try again." |
| Row 3 title | Phone number |
| Row 3 states | Shown only when phone verification is available (06 section 11). "Confirmed" or "Confirm your number". |
| Footer | Your documents are seen only by our review team and are deleted 30 days after the decision. |

### 8.2 `ME-VERIFY-ID`

| Step | Text |
|---|---|
| Title | Verify identity |
| Step 1 heading | Document number |
| Step 1 body | The consent text of section 2.2 |
| Managed profile note | Enter {name}'s number, not your own. |
| Step 2 heading | Photo of the card |
| Step 2 tips | Place the card on a dark, flat surface. Make sure all four corners are visible. Avoid glare. Do not cover any part of the card. |
| Step 3 heading | Selfie |
| Step 3 body | Now a quick selfie of {name} so we can match the card. {gesture instruction} |
| Submit button | Submit for review |
| Success | Thank you. We will review your documents, usually within 24 hours. You can keep using the app meanwhile. |

### 8.3 Rejection messages

Shown in the `verification_rejected` notification, on `ME-VERIFY` and by email. One text per `rejection_reason`.

| Reason | Message |
|---|---|
| `unreadable` | We could not read the image clearly. Please take a sharper photo in good light, with the whole card visible. |
| `document_mismatch` | The details on the document do not match the profile (name, date of birth, gender or number). If the profile has a mistake you cannot edit, email {support_email} and we will help. |
| `face_mismatch` | The selfie does not match the document or the profile photos. Please make sure the selfie shows {name}, and that every profile photo is of {name}. |
| `gesture_missing` | The selfie did not show the requested gesture. Please take a new selfie and follow the instruction on the screen. |
| `expired_document` | The document has expired. Please upload a valid one. |
| `underage` | The candidate must be at least 18 years old to use Khandani Rishta. |
| `suspected_fraud` | We could not accept this document. If you believe this is a mistake, email {support_email}. |
| `other` | We could not approve the request. Please try again or email {support_email}. |

Never show `reviewer_note` to the member.

### 8.4 `ME-VERIFY-SELFIE`

| Element | Text |
|---|---|
| Title | Photo check |
| Body | Take one selfie of {name} doing the gesture below. We compare it with the profile photos. The selfie is never shown on the profile and is deleted 30 days after our decision. |
| Camera permission denied | We need the camera for this check. Allow camera access in your settings and try again. |
| Submit | Submit selfie |
| Success | Thank you. We usually review within 24 hours. |

## 9. Later options (not part of the build)

These are recorded so that nobody re-investigates them from scratch. None is to be implemented now.

| Option | What it would add | Why it waits |
|---|---|---|
| OCR assist with Azure Document Intelligence | The identity card's number, name and date of birth read automatically and pre-compared for the moderator | The free tier covers 500 pages a month, which is enough, but the service's prebuilt identity-document reader does not list the Pakistani CNIC. It must be tested with sample cards first. It would only assist the moderator, never decide. |
| Automatic face comparison | Selfie against card and photos without a person | Azure Face verification is closed to this project (limited access, not on the free tier). An on-device open-source face matcher is possible later but needs its own accuracy testing. |
| A KYC vendor | Document authenticity checks and liveness | Costs money per check, sends identity images to a third party, and still has no access to NADRA's database. Reconsider only if manual review cannot keep up. |
| NADRA verification | Confirmation of the number, name and family details against the national database | Offered only to regulated and authorised organisations. Not available to this project today. Revisit if the project becomes a registered company and NADRA's onboarding opens to it. |
| Extra document checks (degree, salary slip, employment letter) | Badges for education and income | Heavy moderator workload and more sensitive documents. Not planned. |
| Marital status proof (divorce certificate, death certificate of spouse) | A check on the most commonly falsified field | Sensitive, slow, and hard to authenticate. The report reason `already_married` and moderator follow-up are used instead (13). |
