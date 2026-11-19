# API contract

The OpenAPI description of the API and the TypeScript types generated from it. The web app imports the types; the Android app generates its client from the same `openapi.json`.

Both files are generated. Don't edit them by hand.

| File | Produced by |
|---|---|
| `openapi.json` | The API itself: `cargo run -- openapi > ../../packages/api-contract/openapi.json` (run in `apps/api`) |
| `src/schema.d.ts` | `pnpm generate:api-client` (run in the repository root) |

CI fails if the committed `openapi.json` doesn't match the API code, so regenerate both files whenever routes change.
