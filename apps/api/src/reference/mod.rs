//! Reference data: closed option lists and the in-memory cache of lookup tables (05).
//!
//! All lookup tables except `regions` and `cities` are loaded into memory at startup, reloaded
//! every 10 minutes and right after an admin changes castes (05 section 1.4). Handlers read
//! labels and validate codes from here and never join reference tables in SQL.

pub mod options;

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use utoipa::ToSchema;

/// How often the cache is reloaded in the background.
pub const RELOAD_INTERVAL: Duration = Duration::from_mins(10);

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Religion {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Sect {
    pub code: String,
    pub religion_code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Caste {
    pub code: String,
    pub parent_code: Option<String>,
    pub name: String,
    pub name_ur: Option<String>,
    pub aliases: Vec<String>,
    pub sort_order: i32,
    pub is_active: bool,
}

/// A row of a simple lookup (languages, education fields, profession categories).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Lookup {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EducationLevel {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub rank: i16,
    pub is_active: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IncomeBand {
    pub code: String,
    pub currency_code: String,
    pub label: String,
    pub label_ur: Option<String>,
    pub min_amount: i64,
    pub max_amount: Option<i64>,
    pub rank: i16,
    pub is_active: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Hobby {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub category: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Country {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub dial_code: Option<String>,
    pub is_active: bool,
}

/// Lookup tables indexed by code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Table {
    Religions,
    Sects,
    Castes,
    Languages,
    EducationLevels,
    EducationFields,
    Professions,
    IncomeBands,
    Hobbies,
    Countries,
}

/// One loaded copy of every small lookup table, with indexes by code and the serialised
/// bootstrap body.
#[derive(Debug, Default)]
pub struct ReferenceData {
    pub religions: Vec<Religion>,
    pub sects: Vec<Sect>,
    pub castes: Vec<Caste>,
    pub languages: Vec<Lookup>,
    pub education_levels: Vec<EducationLevel>,
    pub education_fields: Vec<Lookup>,
    pub profession_categories: Vec<Lookup>,
    pub income_bands: Vec<IncomeBand>,
    pub hobbies: Vec<Hobby>,
    pub countries: Vec<Country>,
    index: HashMap<(Table, String), usize>,
    /// `ReferenceBootstrap` as JSON bytes.
    pub bootstrap_json: Vec<u8>,
    /// First 16 hex characters of the SHA-256 of the body; also the `ETag`.
    pub version: String,
}

impl ReferenceData {
    /// Loads every table. Rows are ordered by `sort_order`, then name.
    pub async fn load(db: &PgPool) -> Result<Self, sqlx::Error> {
        let religions = sqlx::query_as(
            "SELECT code, name, name_ur, is_active FROM religions ORDER BY sort_order, name",
        )
        .fetch_all(db)
        .await?;
        let sects = sqlx::query_as(
            "SELECT code, religion_code, name, name_ur, is_active
             FROM sects ORDER BY sort_order, name",
        )
        .fetch_all(db)
        .await?;
        let castes = sqlx::query_as(
            "SELECT code, parent_code, name, name_ur, aliases, sort_order, is_active
             FROM castes ORDER BY sort_order, name",
        )
        .fetch_all(db)
        .await?;
        let languages = sqlx::query_as(
            "SELECT code, name, name_ur, is_active FROM languages ORDER BY sort_order, name",
        )
        .fetch_all(db)
        .await?;
        let education_fields = sqlx::query_as(
            "SELECT code, name, name_ur, is_active FROM education_fields ORDER BY sort_order, name",
        )
        .fetch_all(db)
        .await?;
        let profession_categories = sqlx::query_as(
            "SELECT code, name, name_ur, is_active
             FROM profession_categories ORDER BY sort_order, name",
        )
        .fetch_all(db)
        .await?;
        let education_levels = sqlx::query_as(
            "SELECT code, name, name_ur, rank, is_active
             FROM education_levels ORDER BY sort_order, rank",
        )
        .fetch_all(db)
        .await?;
        let income_bands = sqlx::query_as(
            "SELECT code, currency_code, label, label_ur, min_amount, max_amount, rank, is_active
             FROM income_bands ORDER BY currency_code, sort_order, rank",
        )
        .fetch_all(db)
        .await?;
        let hobbies = sqlx::query_as(
            "SELECT code, name, name_ur, category, is_active FROM hobbies ORDER BY sort_order, name",
        )
        .fetch_all(db)
        .await?;
        let countries = sqlx::query_as(
            "SELECT code, name, name_ur, dial_code, is_active
             FROM countries ORDER BY sort_order, name",
        )
        .fetch_all(db)
        .await?;

        let mut data = Self {
            religions,
            sects,
            castes,
            languages,
            education_levels,
            education_fields,
            profession_categories,
            income_bands,
            hobbies,
            countries,
            ..Self::default()
        };
        data.build_index();
        data.build_bootstrap();
        Ok(data)
    }

    fn build_index(&mut self) {
        let mut index = HashMap::new();
        let mut add = |table: Table, codes: Vec<&String>| {
            for (position, code) in codes.into_iter().enumerate() {
                index.insert((table, code.clone()), position);
            }
        };
        add(
            Table::Religions,
            self.religions.iter().map(|r| &r.code).collect(),
        );
        add(Table::Sects, self.sects.iter().map(|r| &r.code).collect());
        add(Table::Castes, self.castes.iter().map(|r| &r.code).collect());
        add(
            Table::Languages,
            self.languages.iter().map(|r| &r.code).collect(),
        );
        add(
            Table::EducationLevels,
            self.education_levels.iter().map(|r| &r.code).collect(),
        );
        add(
            Table::EducationFields,
            self.education_fields.iter().map(|r| &r.code).collect(),
        );
        add(
            Table::Professions,
            self.profession_categories.iter().map(|r| &r.code).collect(),
        );
        add(
            Table::IncomeBands,
            self.income_bands.iter().map(|r| &r.code).collect(),
        );
        add(
            Table::Hobbies,
            self.hobbies.iter().map(|r| &r.code).collect(),
        );
        add(
            Table::Countries,
            self.countries.iter().map(|r| &r.code).collect(),
        );
        self.index = index;
    }

    fn position(&self, table: Table, code: &str) -> Option<usize> {
        self.index.get(&(table, code.to_owned())).copied()
    }

    /// Any religion row, active or retired (05 section 1.4 rule 4: retired codes still resolve).
    pub fn religion(&self, code: &str) -> Option<&Religion> {
        self.position(Table::Religions, code)
            .map(|i| &self.religions[i])
    }

    pub fn sect(&self, code: &str) -> Option<&Sect> {
        self.position(Table::Sects, code).map(|i| &self.sects[i])
    }

    pub fn caste(&self, code: &str) -> Option<&Caste> {
        self.position(Table::Castes, code).map(|i| &self.castes[i])
    }

    pub fn language(&self, code: &str) -> Option<&Lookup> {
        self.position(Table::Languages, code)
            .map(|i| &self.languages[i])
    }

    pub fn education_level(&self, code: &str) -> Option<&EducationLevel> {
        self.position(Table::EducationLevels, code)
            .map(|i| &self.education_levels[i])
    }

    pub fn education_field(&self, code: &str) -> Option<&Lookup> {
        self.position(Table::EducationFields, code)
            .map(|i| &self.education_fields[i])
    }

    pub fn profession(&self, code: &str) -> Option<&Lookup> {
        self.position(Table::Professions, code)
            .map(|i| &self.profession_categories[i])
    }

    pub fn income_band(&self, code: &str) -> Option<&IncomeBand> {
        self.position(Table::IncomeBands, code)
            .map(|i| &self.income_bands[i])
    }

    pub fn hobby(&self, code: &str) -> Option<&Hobby> {
        self.position(Table::Hobbies, code)
            .map(|i| &self.hobbies[i])
    }

    pub fn country(&self, code: &str) -> Option<&Country> {
        self.position(Table::Countries, code)
            .map(|i| &self.countries[i])
    }

    /// True when the religion has at least one active sect (07: the sect is then required).
    pub fn religion_has_sects(&self, religion_code: &str) -> bool {
        self.sects
            .iter()
            .any(|sect| sect.is_active && sect.religion_code == religion_code)
    }

    /// The top-level caste code of a caste or sub-caste code.
    pub fn top_level_caste<'a>(&'a self, code: &'a str) -> Option<&'a str> {
        let caste = self.caste(code)?;
        Some(caste.parent_code.as_deref().unwrap_or(&caste.code))
    }

    /// An active caste row under `parent_code` (`None`: top level) whose name or one of whose
    /// aliases normalises to `normalized_name` (05 section 13, "Record a typed caste").
    pub fn caste_by_normalized_name(
        &self,
        parent_code: Option<&str>,
        normalized_name: &str,
    ) -> Option<&Caste> {
        self.castes.iter().find(|caste| {
            caste.is_active
                && caste.parent_code.as_deref() == parent_code
                && (normalize_name(&caste.name) == normalized_name
                    || caste
                        .aliases
                        .iter()
                        .any(|alias| normalize_name(alias) == normalized_name))
        })
    }

    #[allow(clippy::too_many_lines)] // One literal per list of the bootstrap body.
    fn build_bootstrap(&mut self) {
        let mut body = ReferenceBootstrap {
            version: String::new(),
            options: options::OPTION_LISTS
                .iter()
                .map(|list| {
                    let rows = list
                        .rows
                        .iter()
                        .map(|row| OptionItem {
                            code: row.code.to_owned(),
                            label: row.label.to_owned(),
                            label_ur: row.label_ur.map(str::to_owned),
                        })
                        .collect();
                    (list.name.to_owned(), rows)
                })
                .collect(),
            religions: self
                .religions
                .iter()
                .filter(|r| r.is_active)
                .map(|r| BootstrapReligion {
                    code: r.code.clone(),
                    name: r.name.clone(),
                    name_ur: r.name_ur.clone(),
                    sects: self
                        .sects
                        .iter()
                        .filter(|s| s.is_active && s.religion_code == r.code)
                        .map(|s| NamedItem {
                            code: s.code.clone(),
                            name: s.name.clone(),
                            name_ur: s.name_ur.clone(),
                        })
                        .collect(),
                })
                .collect(),
            castes: self
                .castes
                .iter()
                .filter(|c| c.is_active && c.parent_code.is_none())
                .map(|c| BootstrapCaste {
                    code: c.code.clone(),
                    name: c.name.clone(),
                    name_ur: c.name_ur.clone(),
                    aliases: c.aliases.clone(),
                    sub_castes: self
                        .castes
                        .iter()
                        .filter(|s| s.is_active && s.parent_code.as_deref() == Some(&c.code))
                        .map(|s| NamedItem {
                            code: s.code.clone(),
                            name: s.name.clone(),
                            name_ur: s.name_ur.clone(),
                        })
                        .collect(),
                })
                .collect(),
            languages: named(&self.languages),
            education_levels: self
                .education_levels
                .iter()
                .filter(|e| e.is_active)
                .map(|e| BootstrapEducationLevel {
                    code: e.code.clone(),
                    name: e.name.clone(),
                    name_ur: e.name_ur.clone(),
                    rank: e.rank,
                })
                .collect(),
            education_fields: named(&self.education_fields),
            profession_categories: named(&self.profession_categories),
            income_bands: self
                .income_bands
                .iter()
                .filter(|b| b.is_active)
                .map(|b| BootstrapIncomeBand {
                    code: b.code.clone(),
                    currency_code: b.currency_code.clone(),
                    label: b.label.clone(),
                    label_ur: b.label_ur.clone(),
                    rank: b.rank,
                })
                .collect(),
            hobbies: self
                .hobbies
                .iter()
                .filter(|h| h.is_active)
                .map(|h| BootstrapHobby {
                    code: h.code.clone(),
                    name: h.name.clone(),
                    name_ur: h.name_ur.clone(),
                    category: h.category.clone(),
                })
                .collect(),
            countries: self
                .countries
                .iter()
                .filter(|c| c.is_active)
                .map(|c| BootstrapCountry {
                    code: c.code.clone(),
                    name: c.name.clone(),
                    name_ur: c.name_ur.clone(),
                    dial_code: c.dial_code.clone(),
                })
                .collect(),
        };
        let unversioned = serde_json::to_vec(&body).unwrap_or_default();
        let digest = Sha256::digest(&unversioned);
        let mut version = String::with_capacity(16);
        for byte in digest.iter().take(8) {
            let _ = write!(version, "{byte:02x}");
        }
        body.version.clone_from(&version);
        self.bootstrap_json = serde_json::to_vec(&body).unwrap_or_default();
        self.version = version;
    }
}

fn named(rows: &[Lookup]) -> Vec<NamedItem> {
    rows.iter()
        .filter(|row| row.is_active)
        .map(|row| NamedItem {
            code: row.code.clone(),
            name: row.name.clone(),
            name_ur: row.name_ur.clone(),
        })
        .collect()
}

/// Trimmed, lowercase, runs of whitespace collapsed to one space (05 section 13).
pub fn normalize_name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// The cache shared by all requests.
pub struct Reference {
    db: PgPool,
    current: RwLock<Arc<ReferenceData>>,
}

impl Reference {
    /// Loads the tables once. Fails when the database is unreachable.
    pub async fn load(db: PgPool) -> Result<Self, sqlx::Error> {
        let data = ReferenceData::load(&db).await?;
        Ok(Self {
            db,
            current: RwLock::new(Arc::new(data)),
        })
    }

    /// The current copy.
    pub fn get(&self) -> Arc<ReferenceData> {
        self.current.read().map_or_default(|guard| guard.clone())
    }

    /// Loads the tables again and swaps the copy (after an admin change and every 10 minutes).
    pub async fn reload(&self) -> Result<(), sqlx::Error> {
        let data = Arc::new(ReferenceData::load(&self.db).await?);
        if let Ok(mut guard) = self.current.write() {
            *guard = data;
        }
        Ok(())
    }
}

/// Starts the background reload every 10 minutes.
pub fn spawn_reloader(reference: Arc<Reference>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(RELOAD_INTERVAL);
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(error) = reference.reload().await {
                tracing::warn!(%error, "reference data reload failed");
            }
        }
    });
}

// ---- The bootstrap body (15 section 5) ----

/// Everything a client needs to render pickers.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReferenceBootstrap {
    /// Changes whenever any list changes; equals the `ETag`.
    pub version: String,
    /// One entry per closed list, keyed by list name (05 section 2).
    pub options: BTreeMap<String, Vec<OptionItem>>,
    pub religions: Vec<BootstrapReligion>,
    pub castes: Vec<BootstrapCaste>,
    pub languages: Vec<NamedItem>,
    pub education_levels: Vec<BootstrapEducationLevel>,
    pub education_fields: Vec<NamedItem>,
    pub profession_categories: Vec<NamedItem>,
    pub income_bands: Vec<BootstrapIncomeBand>,
    pub hobbies: Vec<BootstrapHobby>,
    pub countries: Vec<BootstrapCountry>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OptionItem {
    pub code: String,
    pub label: String,
    pub label_ur: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NamedItem {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BootstrapReligion {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub sects: Vec<NamedItem>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BootstrapCaste {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub aliases: Vec<String>,
    pub sub_castes: Vec<NamedItem>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BootstrapEducationLevel {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub rank: i16,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BootstrapIncomeBand {
    pub code: String,
    pub currency_code: String,
    pub label: String,
    pub label_ur: Option<String>,
    pub rank: i16,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BootstrapHobby {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub category: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BootstrapCountry {
    pub code: String,
    pub name: String,
    pub name_ur: Option<String>,
    pub dial_code: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_normalise_for_comparison() {
        assert_eq!(normalize_name("  Rajput   Bhatti "), "rajput bhatti");
        assert_eq!(normalize_name("ARAIN"), "arain");
    }

    #[sqlx::test]
    async fn loads_and_versions_the_bootstrap(db: PgPool) {
        let data = ReferenceData::load(&db).await.unwrap();
        assert_eq!(data.version.len(), 16);
        let body: serde_json::Value = serde_json::from_slice(&data.bootstrap_json).unwrap();
        assert_eq!(body["version"], data.version);
        assert!(body["options"]["marital_status"].is_array());

        let again = ReferenceData::load(&db).await.unwrap();
        assert_eq!(again.version, data.version, "the version is stable");
    }
}
