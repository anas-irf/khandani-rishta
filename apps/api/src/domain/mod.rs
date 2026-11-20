//! Pure product logic: no database, no network. Everything here is unit-tested.

// Temporary while handlers are being built: modules land before their callers.
// Removed once every function has a caller.
#![allow(dead_code)]

pub mod chat_safety;
pub mod completeness;
pub mod display;
pub mod gate;
pub mod identity_number;
pub mod matching;
pub mod options;
pub mod preference_defaults;
pub mod preferences;
pub mod privacy;
pub mod text_rules;
pub mod time;
pub mod types;
pub mod visibility;

/// Declares an enumeration stored as `text` with a `CHECK` constraint (04 section 1).
///
/// The generated type serialises to and from its code in JSON, binds and decodes as `text` in
/// PostgreSQL (also inside `text[]`), and appears in the OpenAPI document as a string enum.
macro_rules! text_enum {
    (
        $(#[$meta:meta])*
        $name:ident { $($variant:ident = $code:literal),+ $(,)? }
    ) => {
        $(#[$meta])*
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord,
            serde::Serialize, serde::Deserialize, utoipa::ToSchema,
        )]
        pub enum $name {
            $(
                #[serde(rename = $code)]
                $variant,
            )+
        }

        #[allow(dead_code)]
        impl $name {
            /// Every value, in display order.
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            /// The stored code.
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $code,)+
                }
            }

            /// Parses a stored code.
            pub fn parse(code: &str) -> Option<Self> {
                match code {
                    $($code => Some(Self::$variant),)+
                    _ => None,
                }
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl std::str::FromStr for $name {
            type Err = String;

            fn from_str(code: &str) -> Result<Self, Self::Err> {
                Self::parse(code).ok_or_else(|| {
                    format!("unknown {} value {code:?}", stringify!($name))
                })
            }
        }

        impl sqlx::Type<sqlx::Postgres> for $name {
            fn type_info() -> sqlx::postgres::PgTypeInfo {
                <&str as sqlx::Type<sqlx::Postgres>>::type_info()
            }

            fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
                <&str as sqlx::Type<sqlx::Postgres>>::compatible(ty)
            }
        }

        impl sqlx::postgres::PgHasArrayType for $name {
            fn array_type_info() -> sqlx::postgres::PgTypeInfo {
                <&str as sqlx::postgres::PgHasArrayType>::array_type_info()
            }
        }

        impl<'r> sqlx::Decode<'r, sqlx::Postgres> for $name {
            fn decode(
                value: sqlx::postgres::PgValueRef<'r>,
            ) -> Result<Self, sqlx::error::BoxDynError> {
                let code = <&str as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
                Self::parse(code).ok_or_else(|| {
                    format!("unknown {} value {code:?}", stringify!($name)).into()
                })
            }
        }

        impl sqlx::Encode<'_, sqlx::Postgres> for $name {
            fn encode_by_ref(
                &self,
                buf: &mut sqlx::postgres::PgArgumentBuffer,
            ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
                <&str as sqlx::Encode<sqlx::Postgres>>::encode_by_ref(&self.as_str(), buf)
            }
        }
    };
}

pub(crate) use text_enum;
