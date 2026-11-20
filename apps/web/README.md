# Web app (`apps/web`)

TanStack Start (React 19, TypeScript strict), TanStack Router file routes, TanStack Query, TanStack Form with Zod, Tailwind CSS 4 with shadcn/ui primitives, Clerk, i18next. Deployed to Cloudflare Workers.

The product is specified in [`specs/`](../../specs/README.md). This app follows [17 Web app](../../specs/17-web-app.md) for structure and [16 Screens and flows](../../specs/16-screens-and-flows.md) for every screen, by screen ID.

## Running it

| Command (from the repository root) | What it does |
|---|---|
| `pnpm dev:web` | Dev server on <http://localhost:3000> against the real API (`VITE_API_BASE_URL`) and Clerk |
| `pnpm --filter @khandani/web dev:mock` | Dev server on <http://localhost:3100> in **mock mode**: no API and no Clerk needed. See below. |
| `pnpm --filter @khandani/web test` | Unit and component tests (Vitest) |
| `pnpm --filter @khandani/web typecheck` | TypeScript |
| `pnpm lint` | Biome |
| `pnpm test:e2e` | Playwright smoke tests against a production build, plus mocked journeys against mock mode |

### Environment

Copy `.env.example` to `.env.local` and `.dev.vars.example` to `.dev.vars`, then fill in the Clerk keys of the development instance (`npx clerk env pull` prints them, or copy them from the Clerk dashboard under API keys).

Without a Clerk publishable key the app still builds and serves its public pages, and treats every visitor as signed out (`clerkEnabled` in `src/lib/env.ts`). The CI build for the public smoke tests relies on that.

### Mock mode

`vite --mode mock` sets `VITE_MOCK_MODE=true`. Then:

- [Mock Service Worker](https://mswjs.io) answers every API call from `src/mocks/handlers/*`, backed by the in-memory database in `src/mocks/db.ts`.
- A fake session replaces Clerk. `/sign-in` shows a "Continue as test member" button.
- Add `?mock_scenario=<name>` to any URL to switch the signed-in member's situation: `active` (default), `new`, `onboarding_midway`, `onboarding_review`, `pending_review`, `changes_requested`, `consent_required`, `paused`, `closed`, `suspended`, `banned`, `deletion_scheduled`, `admin`.

Mock mode is never part of a production build.

## Source layout

```text
src/
├── routes/              file routes: wiring only (path, guard options, search schema, one component)
├── features/<area>/     screens, components, queries.ts (API hooks), schemas.ts (Zod), tests
├── components/ui/       shadcn/ui primitives (button, dialog, ...)
├── components/layout/   PublicShell, AppShell, OnboardingShell, navigation
├── components/common/   shared building blocks (17 section 10) and form fields (fields/)
├── lib/                 api, api-types, query, gate, me, reference, form, i18n, format, image, realtime, track
├── locales/en/          one JSON file per i18n namespace
├── mocks/               mock API: db.ts, factories.ts, fixtures/, handlers/
└── test/                Vitest setup and render helpers
```

## Rules

1. **Screens come from 16.** Use the exact copy, actions, states and error handling given for the screen ID. Put the screen ID in a comment at the top of the screen component.
2. **Names come from the specs.** API paths, fields, enum codes, setting keys, events: never invent one. API types are in `src/lib/api-types.ts`: aliases of the schemas generated from `packages/api-contract/openapi.json`, which the API exports. Run `pnpm generate:api-client` after the contract changes.
3. **Data access.** Components never call `fetch` or `http` directly. Each feature has `queries.ts` with `useQuery`/`useMutation` hooks built on `http` from `~/lib/api` and keys from `qk` in `~/lib/query` (17 section 6.2). Cache effects of every mutation follow 17 section 6.3 exactly. Optimistic updates only where 16 rule G7 allows.
4. **Errors.** The global handler (`handleApiError` in `lib/query.ts`) covers gate codes, `limit_reached` (dialog; pass `meta: { limitText: '<ns>:<key>' }` on the mutation for the action's text), `rate_limited`, `cooldown_active` and unexpected errors. A mutation that handles a code itself lists it in `meta: { handles: ['not_permitted_by_member'] }`. Forms map `validation_failed` with `applyServerErrors` from `lib/form-context.ts`. Screen loads use `ErrorState` (16 rule G3).
5. **The gate.** Routing by `Me.gate` lives only in `lib/gate.ts` and `features/auth/AuthGate.tsx`. Inside the app, screens that need a profile status use `ScreenAccess` (`components/common/ScreenAccess.tsx`) with their screen ID; never write per-screen status checks.
6. **Text.** Every user-facing string comes from `src/locales/en/<namespace>.json` through `useTranslation('<namespace>')`. Keys are descriptive paths. Option labels come from the API through `useOptions` / `useLabelOf` in `lib/reference.ts`. Member-written text is rendered as plain text with `dir="auto"`, never as HTML, and links in it are not made clickable.
7. **Layout.** Logical CSS only (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`). Touch targets at least 44 px. Body text 16 px, never below 14 px. Colours only through the tokens in `styles/app.css`. Mobile first; wide layout from `md:` (768 px).
8. **Accessibility.** Every control has a text label; icon buttons have `aria-label`. Dialogs come from `components/ui`. Status changes are announced (toasts are live regions). Colour is never the only signal.
9. **Member photos** use `MemberPhoto` (no drag, no context menu, lock overlay when blurred). Variant by size: `thumb_url` compact, `medium_url` full size, `large_url` viewer only.
10. **Tests.** Every feature ships Vitest + Testing Library tests next to its files: screen states (loading skeleton, empty, error), main actions against the mock API, and error codes. Use `renderWithProviders` from `~/test/render` and factories from `~/mocks/factories`. Override handlers per test with `server.use(...)`.

## Mock API conventions

- One handler file per area in `src/mocks/handlers/<area>.ts`, exporting `handlers`. `index.ts` collects every file automatically.
- Handlers read and change `db` from `src/mocks/db.ts`; it is reset after each test and per scenario.
- Respect access levels with `gateErrorFor(level)` from `handlers/account.ts`, and answer errors with `apiError()` from `src/mocks/http.ts` exactly as 15 section 2 defines them. Paginate with `paginate()`.

## Decisions worth knowing

| Topic | Decision | Why |
|---|---|---|
| API types | `src/lib/api-types.ts` re-exports `components['schemas']` of the generated contract under the names the app uses; `src/lib/api-enums.ts` holds run-time lists of the contract enums. Calls go through `http` in `src/lib/api.ts`, which uses the `openapi-fetch` client and its middleware | The compiler checks every screen and every mock handler against what the API sends. `features/admin/types.ts` and the `http` facade's paths are not on the generated types yet |
| Where Clerk loads | `SessionBoundary` (Clerk plus toasts) wraps only `/sign-in` and the signed-in layout, not the root as 17 section 5 shows | Public pages then never download Clerk or load clerk-js from Clerk's CDN, which the 100 KB landing-page budget of 17 section 17 cannot absorb. Clerk works client-side there because those routes render in the browser only. The public header reads Clerk's `__client_uat` cookie to choose between "Sign in" and "Open the app" |
| Redirects in `AuthGate` | A redirect component that navigates once per target, not TanStack's `<Navigate>` | `<Navigate>` navigates again whenever its props object changes; while the next route's chunk loads, the layout re-renders and the navigation restarts forever (seen in the production build only) |
| Which path `AuthGate` checks | The path of what is rendered (`resolvedLocation`), not `useLocation()`; it waits when a navigation to an allowed screen is already under way | During a navigation `useLocation()` is the next path while the previous screen is still rendered, which let a refused screen render for a frame and call the API |
| Token getter | Registered during render and only ever replaced, never cleared on unmount | React runs every effect cleanup before the children's effects, and route layouts remount while a screen's code loads; clearing it let the first request go out without a token (regression test in `features/auth/session.test.tsx`) |
| Route code warming | Once the shell is up, the code of the main screens is fetched in idle time (`components/layout/useWarmRoutes.ts`) | Code stays split by route (17 section 17), but TanStack shows a layout as pending, and remounts it, while a route's code downloads |
| Content Security Policy | Worker-rendered pages get a per-response nonce (`src/router.tsx`, `src/lib/csp.ts`); the 8 prerendered pages get a hash-based policy written to `dist/client/_headers` at build time (`vite.config.ts`) | Prerendered pages are static files that Cloudflare serves without running the Worker. Development and mock mode run without a policy (Vite injects inline scripts) |
| Prerendering | Only the pages 17 section 3.1 marks as prerendered; `/` and `/download` stay server-rendered | `/` redirects signed-in visitors and `/download` reads the latest release |
| `robots.txt` | `Disallow: /p/` rather than `/p` | `/p` is a prefix match and would also hide `/privacy` |
| Error reporting | One `VITE_SENTRY_DSN` for the browser and the Worker. `src/server.ts` wraps TanStack Start's handler with `@sentry/cloudflare`; the browser SDK loads lazily from `src/lib/monitoring.ts`. Both use the same `dataCollection` settings and scrubbers | Spec 17 section 15 defines one DSN for the web app. Nothing personal leaves the Worker or the browser (17 section 14) |
| Photo polling | Every 3 s for the first minute after an upload, then every 15 s, only while a photo is `processing` and the socket is down (08 section 5.2 step 6) | Moderation can take a day; `photo.updated` covers it |

## Not done yet

- **Urdu.** Every string is in `src/locales/en`; adding `src/locales/ur` switches it on (17 section 12).
- **Before launch:** the Android signing fingerprint in `public/.well-known/assetlinks.json` (from the release key), a PNG export of `public/og-image.svg` for social previews, and the custom-domain routes in `wrangler.jsonc` once `khandanirishta.app` is a Cloudflare zone.
- **Landing page weight.** About 240 KB of gzipped JavaScript against the 100 KB budget of 17 section 17, measured on the production build. Clerk and the toast library are no longer loaded on public pages; what remains is React, TanStack Router and Start, TanStack Query, i18next with the English public copy (14 KB) and Zod for route search params (about 12 KB). The budget is not reachable on this stack without server components or a lighter router.
