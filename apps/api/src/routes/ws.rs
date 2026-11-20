//! The WebSocket upgrade, `GET /v1/ws` (15 section 12, 19 section 4).

use utoipa_axum::router::OpenApiRouter;

use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
}
