//! Contact sharing (11 section 7, 09 section 10, 15 section 12).

use axum::Json;
use axum::extract::State;
use serde_json::json;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use uuid::Uuid;

use super::{member_of, rendered};
use crate::auth::{Connected, Engage};
use crate::db::connections::{self as db, ShareItems};
use crate::domain::types::{ConnectionStatus, NotificationType, SystemEvent};
use crate::error::{ApiError, ApiResult, ErrorBody, FieldCode, FieldError, FieldErrors};
use crate::extract::{ApiJson, ApiPath};
use crate::models::connections::{Connection, ContactShareBody, publish_messages, publish_updated};
use crate::notify;
use crate::state::AppState;

pub(super) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(put_contact_share, delete_contact_share))
}

/// Share contact details with the other member, or change which items are shared.
///
/// At least one item must be selected, and each selected item must have a value in the
/// caller's contact details (`validation_failed` with field code `required` on the share flag,
/// so the client can open the contact form). The share is a reference: later edits of the
/// details are what the other member sees. Posts a `contact_shared` system message and
/// notifies the other member.
#[utoipa::path(
    put,
    path = "/connections/{connection_id}/contact-share",
    tag = "connections",
    security(("bearer" = [])),
    params(("connection_id" = Uuid, Path, description = "The connection")),
    request_body = ContactShareBody,
    responses(
        (status = 200, body = Connection),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody)
    )
)]
async fn put_contact_share(
    State(state): State<AppState>,
    account: Engage,
    ApiPath(connection_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ContactShareBody>,
) -> ApiResult<Json<Connection>> {
    let me = account.profile_id;
    let membership = member_of(&state, me, connection_id).await?;
    if membership.status != ConnectionStatus::Active {
        return Err(ApiError::ConnectionEnded);
    }
    let items = ShareItems {
        phone: body.share_phone,
        whatsapp: body.share_whatsapp,
        email: body.share_email,
        guardian: body.share_guardian,
    };
    let selected = [
        ("share_phone", items.phone),
        ("share_whatsapp", items.whatsapp),
        ("share_email", items.email),
        ("share_guardian", items.guardian),
    ];
    if items.names().is_empty() {
        return Err(ApiError::Validation(
            selected
                .iter()
                .map(|(field, _)| {
                    FieldError::with_message(
                        *field,
                        FieldCode::Invalid,
                        "Choose at least one item to share.",
                    )
                })
                .collect(),
        ));
    }
    let mut errors = FieldErrors::new();
    let filled = db::filled_contacts(&state.db, me).await?;
    for ((field, wanted), present) in
        selected
            .into_iter()
            .zip([filled.phone, filled.whatsapp, filled.email, filled.guardian])
    {
        if wanted && !present {
            errors.add(field, FieldCode::Required);
        }
    }
    errors.finish()?;

    let mut tx = state.db.begin().await?;
    let locked = db::lock_membership(&mut tx, me, connection_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    if locked.status != ConnectionStatus::Active {
        return Err(ApiError::ConnectionEnded);
    }
    db::upsert_share(&mut tx, connection_id, me, items).await?;
    let message = db::insert_system_message(
        &mut tx,
        connection_id,
        SystemEvent::ContactShared,
        json!({ "actor_profile_id": me, "items": items.names() }),
    )
    .await?;
    tx.commit().await?;
    tracing::info!(event = "contact.shared", %connection_id);

    let other = membership.other_id;
    publish_messages(&state, [me, other], &[message]);
    if let Err(error) = notify::notify(
        &state,
        membership.other_user_id,
        NotificationType::ContactShared,
        Some(me),
        json!({ "connection_id": connection_id }),
    )
    .await
    {
        tracing::warn!(error = %format!("{error:#}"), "could not notify contact_shared");
    }
    publish_updated(&state, connection_id).await;
    rendered(&state, me, connection_id).await
}

/// Stop sharing contact details. The other member no longer sees them from the next fetch;
/// anything they saved is out of reach. Posts a `contact_share_revoked` system message. Without
/// an active share nothing changes.
#[utoipa::path(
    delete,
    path = "/connections/{connection_id}/contact-share",
    tag = "connections",
    security(("bearer" = [])),
    params(("connection_id" = Uuid, Path, description = "The connection")),
    responses(
        (status = 200, body = Connection),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody)
    )
)]
async fn delete_contact_share(
    State(state): State<AppState>,
    account: Connected,
    ApiPath(connection_id): ApiPath<Uuid>,
) -> ApiResult<Json<Connection>> {
    let me = account.profile_id;
    let mut tx = state.db.begin().await?;
    let membership = db::lock_membership(&mut tx, me, connection_id)
        .await?
        .ok_or(ApiError::NotFound)?;
    let message = if db::revoke_share(&mut tx, connection_id, me).await? {
        Some(
            db::insert_system_message(
                &mut tx,
                connection_id,
                SystemEvent::ContactShareRevoked,
                json!({ "actor_profile_id": me }),
            )
            .await?,
        )
    } else {
        None
    };
    tx.commit().await?;

    if let Some(message) = message {
        publish_messages(&state, [me, membership.other_id], &[message]);
        publish_updated(&state, connection_id).await;
    }
    rendered(&state, me, connection_id).await
}
