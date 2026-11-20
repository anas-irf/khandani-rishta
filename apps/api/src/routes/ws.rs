//! The WebSocket upgrade, `GET /v1/ws` (15 section 12, 19 section 4.2). The upgrade itself
//! carries no token: the client authenticates with its first frame.

use axum::extract::State;
use axum::extract::ws::WebSocketUpgrade;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::realtime::ws::MAX_CLIENT_FRAME;
use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(upgrade))
}

/// Opens the realtime socket. An `Origin` header, when present, must be an allowed web origin
/// (Android sends none). Then send `{"type":"auth","token":"<Clerk token>"}` within 10 seconds.
#[utoipa::path(
    get,
    path = "/ws",
    tag = "connections",
    responses(
        (status = 101, description = "Switching protocols"),
        (status = 403, description = "The origin is not allowed")
    )
)]
async fn upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if let Some(origin) = headers.get(header::ORIGIN) {
        let allowed = origin.to_str().is_ok_and(|origin| {
            let origin = origin.trim_end_matches('/');
            state
                .config
                .allowed_origins()
                .any(|allowed| allowed == origin)
        });
        if !allowed {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    // Frames above 4 KiB close with 1009; the transport limit is set a little higher so the
    // session loop can answer with that code itself.
    ws.max_message_size(MAX_CLIENT_FRAME * 4)
        .on_upgrade(move |socket| crate::realtime::ws::run(state, socket))
}
