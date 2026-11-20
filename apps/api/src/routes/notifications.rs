//! Notification feed, notification preferences and push devices (15 sections 6 and 14).

use utoipa_axum::router::OpenApiRouter;

use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
}
