# Product

## Platform

web

## Users

Khandani Rishta serves Pakistani families looking for a marriage match, at home and abroad. A profile is run by the candidate or by someone acting for them (parent, sibling, relative or friend), and every profile says which.

**Tie-breaker: Mr Tariq, 58, Faisalabad.** A parent managing a profile for his son or daughter, on a mid-range Android phone, often with a larger system font. When the needs of different users pull apart, design for him. If he can read a screen and act on it, everyone else can.

The other member personas are also primary users (specs/01 section 2):

| Persona | Situation | What they need most |
|---|---|---|
| Hira, 26, Lahore, software engineer | Looking for herself, with her parents' knowledge | Control over who sees her photos and details, relevant matches, no harassment |
| Bilal, 31, Manchester | Overseas Pakistani looking in Pakistan or the diaspora | Location and relocation filters, residency status, trust signals on both sides |
| Sana, 34, Karachi, divorced, one child | Second marriage | Honest status fields, respectful filters, not being shown to people who would refuse |

Staff moderators use the admin console and need fast review queues, clear rules and an audit trail.

## Product Purpose

A member creates a profile, is shown compatible profiles of the opposite gender, sends an interest (a rishta request), and once the other side accepts, the two can chat, share contact details, involve their families and move towards nikah. It is a marriage platform, not a dating app: everything assumes serious intent, family involvement and a need for privacy.

Success is measured by onboarding completion, profile quality, interest acceptance rate, time to first connection, conversations that continue, connections that reach "families talking", "engaged" and "nikah done", safety, and a fair balance of attention (specs/01 section 8).

## Positioning

- **Mutual fit, explained.** A match must fit in both directions, and must-have preferences always exclude. Every match card carries a compatibility percentage and up to three plain reasons. When nobody is left to show, the product says so and suggests which preference to relax, instead of padding the list.
- **Free and fair.** Everything is free at launch, and safety and verification are never sold. No fake counters, no invented urgency, no hidden renewals.
- **Family first.** Who manages a profile is shown openly. Family background, home and guardian contact are first-class.
- **Privacy is the member's choice.** Photos, name, caste, income, family details, contact numbers and activity each have their own control, enforced on the server. Nothing is public without signing in.

## Operating Context

- Members mostly use phones. Many are parents acting for a son or daughter, often with family members reading over their shoulder.
- The journey: sign up with Google or an email code, onboarding (five mandatory steps, then skippable ones, about five minutes), identity number on file, home with recommended matches, new members and nearby, open a profile, send an interest with an optional note, the receiver accepts or quietly declines, chat, deliberate contact sharing, then stages confirmed by both sides.
- Day boundaries follow `Asia/Karachi`. Money is in PKR unless a currency is named.
- Current design work happens on the Mehfil Heritage canvas (private, with Landing, Discover and Profile boards at desktop and phone size) before it is built into the apps.

## Capabilities and Constraints

- **Specs are the source of truth.** `specs/` defines the whole product; documents 03 (domain model), 04 (database schema) and 15 (API contract) win any disagreement. Never invent a table, field, endpoint, setting or screen name; screen IDs come from specs/16. Technologies and hosting are in `docs/tech-stack.md`.
- **Two clients, one behaviour.** `apps/web` and `apps/android` (Jetpack Compose) implement the same screens and rules on one API. This record is shared; an Android override with Platform `android` is planned for when the Android screens are reviewed.
- **Visual system.** `DESIGN.md` at the repo root is the hand-made Mehfil Heritage token sheet, chosen on 2026-11-21. Never regenerate or replace it with `document`. It is not applied to the apps yet.
- **Rules that shape screens:** members see only the opposite gender, and the candidate is 18 or older. Contact starts with an interest; chat exists only after it is accepted; declines are quiet; daily limits apply. Phone numbers are revealed only by a deliberate, revocable share. Up to 6 photos, moderated, with four visibility modes and blur. Complexion is never a filter; caste is optional and privacy-controlled. The Android app blocks screenshots on profile, photo and chat screens.
- **Languages.** English at launch; Urdu with right-to-left layout in a later phase. Every string is a translation key, layouts use logical start and end, member-written text uses automatic direction, digits are Western in both languages.
- **Non-goals.** No swiping deck, no "nearby right now", no public or indexed profiles, no astrology, no marriage bureaus or matchmakers, no in-app payments, calls or iOS app at launch.
- **Terminology.** Interest (rishta request), connection, shortlist, "Not interested", managed by, stages ("families talking", "engaged", "nikah done").

## Brand Commitments

- Name: Khandani Rishta. Domain: khandanirishta.app.
- Voice: modest, respectful and family-appropriate, in plain English.
- The visual identity is Mehfil Heritage, recorded in `DESIGN.md`.

## Evidence on Hand

- Product specifications: `specs/01` to `specs/22`, indexed in `specs/README.md`.
- Design tokens: `DESIGN.md`. Mockups: the Mehfil Heritage canvas. The profiles on it (Ayesha K., Zainab M. and others) are illustrative samples, not real members.
- Absent, and not to be fabricated: real member counts, testimonials, success stories (a later feature), user research, analytics and press.

## Product Principles

1. **Family first.** Design for a family deciding together, not an individual browsing alone.
2. **Privacy is the member's choice.** Never show more than the member allowed, and make the controls easy to find.
3. **Honest and respectful.** Quiet declines, modest wording, no manufactured urgency or popularity.
4. **Mutual fit, explained.** Every recommendation says why, in plain words.
5. **Lists decide, profiles explain.** On match lists, a card shows only what helps a family decide whether to open the profile; the details live on the profile page. When a card grows too big, cut content before shrinking text.

## Accessibility & Inclusion

- Baseline is WCAG 2.1 AA (specs/20 section 7), raised for Mr Tariq in `DESIGN.md` section 1: body text 17, nothing that carries meaning below 15 (14 only for footer legal text), text contrast 7:1 where the palette allows and never below 4.5:1, touch targets at least 48 by 48 and 8 apart, primary phone actions 56 tall.
- Layouts survive 200% text scaling: rows wrap, names wrap, nothing that matters is cut.
- Colour is never the only signal; every status pairs colour with an icon and words.
- Every action is reachable by keyboard with a visible focus ring; reduced motion is respected; date of birth and height use simple selects.
- Inclusion: divorced and widowed members are treated with respect, and a declared married status is shown only to women who opt in (specs/03 section 8).
