//! Staff routes under `/v1/admin` (15 section 16, 18). Every state-changing route writes
//! `admin_audit_log` in the same transaction (03 section 8 rule 13).

mod announcements;
mod audit;
mod castes;
mod overview;
mod photos;
mod profiles;
mod releases;
mod reports;
mod settings;
mod texts;
mod users;
mod verifications;

use utoipa_axum::router::OpenApiRouter;

use crate::state::AppState;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .merge(overview::router())
        .merge(profiles::router())
        .merge(photos::router())
        .merge(texts::router())
        .merge(verifications::router())
        .merge(reports::router())
        .merge(users::router())
        .merge(castes::router())
        .merge(settings::router())
        .merge(releases::router())
        .merge(announcements::router())
        .merge(audit::router())
}
