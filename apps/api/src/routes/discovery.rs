//! Discovery: home, recommendations, search, profiles, visitors, saved searches (15 section 10).

use utoipa_axum::router::OpenApiRouter;

use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
}
