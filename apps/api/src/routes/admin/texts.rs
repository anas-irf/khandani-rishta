//! Staff routes: texts (15 section 16, 18).

use utoipa_axum::router::OpenApiRouter;

use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
}
