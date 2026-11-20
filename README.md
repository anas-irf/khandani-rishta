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
| `e2e` | Playwright end-to-end tests for the web app |
| `infra/local` | Local PostgreSQL (Docker Compose) |
| `infra/azure` | VM setup, systemd units, deploy and backup scripts ([runbook](infra/azure/README.md)) |
| `docs` | Project documentation, including the [CI/CD guide](docs/ci-cd.md) |

## Prerequisites

- Git and Docker Desktop
- Node.js 26 LTS (the version in `.nvmrc`) and [pnpm](https://pnpm.io/installation)
- Rust through [rustup](https://rustup.rs) (on Windows, also the Visual Studio C++ Build Tools). The pinned version in `apps/api/rust-toolchain.toml` installs automatically. Optional for running the project: without it, `pnpm bootstrap` builds the API in Docker.
- Android Studio (latest stable)

## Getting started

From the repository root:

```sh
pnpm bootstrap
```

The first run creates `apps/api/.env` and `apps/web/.env.local` from their templates and installs the JavaScript dependencies. Every run then:

- starts PostgreSQL in Docker. It keeps running afterwards; stop it with `pnpm db:stop`.
- runs the API at <http://localhost:8787/healthz>, and restarts it when you save a change in `apps/api` (code, migrations or `.env`). The API applies migrations on startup.
- runs the web app at <http://localhost:3000>, which reloads in the browser as you edit.

Press Ctrl+C to stop the API and the web app. If Rust isn't installed (or, on Windows, the Visual Studio C++ Build Tools aren't), the API runs inside the `rust` Docker image instead; that works, but builds are slower than with a local Rust install.

Locally the API listens on port 8787, not 8080, because 8080 is often taken by other software (Oracle XE, Tomcat).

For the Android app, open `apps/android` in Android Studio and run the `app` configuration on an emulator.

## Common tasks

| Task | Command |
|---|---|
| Start or stop only the database | `pnpm db:start`, `pnpm db:stop` (repository root) |
| Run only the API | `cargo run` (in `apps/api`, with the database running) |
| Run only the web app | `pnpm dev:web` (repository root) |
| Check the JavaScript code (Biome, types, Knip, unit tests) | `pnpm check`; fix formatting with `pnpm format` (repository root) |
| Run the end-to-end tests | `pnpm test:e2e` (repository root; first time: `pnpm --filter @khandani/e2e exec playwright install chromium`) |
| Check the API | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo deny check` (in `apps/api`, database running) |
| Check the Android app | `./gradlew spotlessCheck lintDebug testDebugUnitTest assembleDebug` (in `apps/android`; `gradlew.bat` on Windows); fix formatting with `./gradlew spotlessApply` |
| Update the API contract after changing routes | `cargo run -- openapi > ../../packages/api-contract/openapi.json` (in `apps/api`), then `pnpm generate:api-client` (repository root) |

## Contributing

Work on a branch and open a pull request; `main` only changes through merged pull requests. Commit messages and pull request titles follow Conventional Commits, for example `feat(web): add the sign-in page`. Git hooks (installed by `pnpm install`) format staged files and check commit messages, and CI checks every pull request. Details: [docs/ci-cd.md](docs/ci-cd.md).

## Deployment

GitHub Actions deploy every merge to `main` to staging, then smoke-test it. Production deploys are started by hand from the Actions tab (CD > Run workflow). Deploys stay switched off until the repository variable `DEPLOY_ENABLED` is `true`; the steps to get there are in the [Azure runbook](infra/azure/README.md).
