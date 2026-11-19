# Khandani Rishta

A rishta (matchmaking) platform with a web app, an Android app and one shared API.

The technologies and where each part runs are described in [docs/tech-stack.md](docs/tech-stack.md).

## Repository layout

| Path | Contents |
|---|---|
| `apps/api` | Rust (Axum) API |
| `apps/web` | TanStack Start web app, deployed to Cloudflare Workers |
| `apps/android` | Kotlin and Jetpack Compose Android app |
| `packages/api-contract` | OpenAPI spec exported from the API, plus generated TypeScript types |
| `infra/local` | Local PostgreSQL (Docker Compose) |
| `infra/azure` | VM setup, systemd units, deploy and backup scripts ([runbook](infra/azure/README.md)) |
| `docs` | Project documentation |

## Prerequisites

- Git and Docker Desktop
- Rust through [rustup](https://rustup.rs) (on Windows, also the Visual Studio C++ Build Tools). The pinned version in `apps/api/rust-toolchain.toml` installs automatically.
- Node.js 26 LTS and [pnpm](https://pnpm.io/installation)
- Android Studio (latest stable)

## Getting started

1. Start the local database:

   ```sh
   docker compose -f infra/local/docker-compose.yml up -d
   ```

2. Run the API (it applies migrations on startup). Copy `apps/api/.env.example` to `apps/api/.env`, then:

   ```sh
   cd apps/api
   cargo run
   ```

   Check it at <http://localhost:8080/healthz>.

3. Run the web app. Copy `apps/web/.env.example` to `apps/web/.env.local`, then from the repository root:

   ```sh
   pnpm install
   pnpm dev:web
   ```

   Open <http://localhost:3000>.

4. Open `apps/android` in Android Studio and run the `app` configuration on an emulator.

## Common tasks

| Task | Command |
|---|---|
| Check and format the web code | `pnpm check` and `pnpm format` (repository root) |
| Check the API | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (in `apps/api`) |
| Check the Android app | `./gradlew lintDebug testDebugUnitTest assembleDebug` (in `apps/android`; `gradlew.bat` on Windows) |
| Update the API contract after changing routes | `cargo run -- openapi > ../../packages/api-contract/openapi.json` (in `apps/api`), then `pnpm generate:api-client` (repository root) |

## Deployment

GitHub Actions deploy every merge to `main` to staging. Production deploys are started by hand from the Actions tab. Deploys stay switched off until the repository variable `DEPLOY_ENABLED` is `true`; the steps to get there are in the [Azure runbook](infra/azure/README.md).
