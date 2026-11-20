//! The development seed: `cargo run -- seed-dev` (20 section 9, T-307). Not implemented yet.

use sqlx::PgPool;

use crate::config::Config;

#[allow(clippy::unused_async)] // Stub until the seed is built.
pub async fn run(_config: &Config, _db: &PgPool) -> anyhow::Result<()> {
    anyhow::bail!("seed-dev is not implemented yet")
}
