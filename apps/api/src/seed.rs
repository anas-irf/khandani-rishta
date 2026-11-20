//! The development seed: `cargo run -- seed-dev` (20 section 9, T-307).
//!
//! Creates [`PER_GENDER`] realistic fake `active` profiles of each gender: Pakistani names,
//! the largest Pakistani cities of the geography seed, varied ages, education, careers,
//! families, preferences and privacy settings. Data comes from a fixed random seed and every
//! fake user has a fixed `clerk_user_id` (`seed_dev_<gender>_<n>`), so running the command
//! again adds nothing: it is idempotent. Rows are written with multi-row inserts in one
//! transaction, so a run takes a few seconds.
//!
//! No photos are created: photos live in R2, which local development does not have.
//! Refuses to run when `APP_ENV=production`.
//!
//! [`insert`] is also used by tests that need hundreds of candidates.

use std::collections::HashSet;

use anyhow::Context;
use rand::rngs::StdRng;
use rand::seq::IndexedRandom;
use rand::{RngExt, SeedableRng};
use sqlx::{PgPool, Postgres, QueryBuilder};
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::auth::provisioning::generate_public_code;
use crate::config::{AppEnv, Config};
use crate::domain::options::{
    Beard, BodyType, ChildrenAcceptance, ChildrenStatus, Complexion, DiscoveryVisibility,
    EmploymentType, FamilyClass, FamilyType, FamilyValues, FieldVisibility, Gender, Hijab,
    Importance, InterestPermission, JahezStance, LivingArrangement, ManagedBy, MaritalStatus,
    MarriageTimeline, NameDisplay, ParentStatus, PhotoVisibility, PrayerFrequency, Religiosity,
    Smoking, WorkAfterMarriage,
};
use crate::domain::preference_defaults::{DefaultsInput, default_preferences};
use crate::domain::preferences::Preferences;
use crate::domain::privacy::Privacy;
use crate::domain::time::{age_on, karachi_date};

/// Profiles created per gender.
pub const PER_GENDER: usize = 300;

/// Rows per `INSERT` statement.
const CHUNK: usize = 200;

/// The prefix of every fake `clerk_user_id`; no real Clerk id starts with it.
pub const CLERK_PREFIX: &str = "seed_dev_";

pub async fn run(config: &Config, db: &PgPool) -> anyhow::Result<()> {
    if config.app_env == AppEnv::Production {
        anyhow::bail!("seed-dev refuses to run when APP_ENV=production");
    }
    let cities = pakistani_cities(db).await?;
    anyhow::ensure!(
        !cities.is_empty(),
        "the geography seed is missing: run the migrations first"
    );
    let mut rng = StdRng::seed_from_u64(20_261_120);
    let now = OffsetDateTime::now_utc();
    let mut profiles = Vec::with_capacity(PER_GENDER * 2);
    for index in 0..PER_GENDER {
        for gender in [Gender::Male, Gender::Female] {
            profiles.push(FakeProfile::random(&mut rng, gender, index, &cities, now));
        }
    }
    let created = insert(db, &profiles).await?;
    println!(
        "seed-dev: {} new profiles ({} were already there)",
        created.len(),
        profiles.len() - created.len()
    );
    Ok(())
}

/// A Pakistani city of the geography seed.
#[derive(Debug, Clone)]
pub struct SeedCity {
    pub id: i32,
    pub region_id: Option<i32>,
    pub region_name: Option<String>,
}

/// The 25 largest Pakistani cities with their regions.
pub async fn pakistani_cities(db: &PgPool) -> sqlx::Result<Vec<SeedCity>> {
    let rows: Vec<(i32, Option<i32>, Option<String>)> = sqlx::query_as(
        "SELECT c.id, c.region_id, r.name FROM cities c LEFT JOIN regions r ON r.id = c.region_id
         WHERE c.country_code = 'PK'
         ORDER BY c.population DESC NULLS LAST, c.id
         LIMIT 25",
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, region_id, region_name)| SeedCity {
            id,
            region_id,
            region_name,
        })
        .collect())
}

/// The family facts of a fake profile.
#[derive(Debug, Clone)]
pub struct FakeFamily {
    pub father_status: ParentStatus,
    pub mother_status: ParentStatus,
    pub brothers_count: i16,
    pub sisters_count: i16,
    pub family_type: FamilyType,
    pub family_class: FamilyClass,
    pub family_values: FamilyValues,
}

/// One fake member: an `active`, complete profile with its account rows.
#[derive(Debug, Clone)]
pub struct FakeProfile {
    pub clerk_user_id: String,
    pub first_name: String,
    pub last_name: String,
    pub gender: Gender,
    pub date_of_birth: Date,
    pub managed_by: ManagedBy,
    pub marital_status: MaritalStatus,
    pub children_status: Option<ChildrenStatus>,
    pub children_count: Option<i16>,
    pub height_cm: i16,
    pub weight_kg: Option<i16>,
    pub complexion: Option<Complexion>,
    pub body_type: Option<BodyType>,
    pub religion_code: String,
    pub sect_code: Option<String>,
    pub caste_code: Option<String>,
    pub mother_tongue_code: String,
    pub language_codes: Vec<String>,
    pub country_code: String,
    pub region_id: Option<i32>,
    pub city_id: Option<i32>,
    /// A typed place name, used when `city_id` is `None`.
    pub city_other: Option<String>,
    pub education_level_code: String,
    pub education_field_code: Option<String>,
    pub employment_type: EmploymentType,
    pub profession_code: Option<String>,
    pub income_band_code: Option<String>,
    pub religiosity: Option<Religiosity>,
    pub prayer_frequency: Option<PrayerFrequency>,
    pub hijab: Option<Hijab>,
    pub beard: Option<Beard>,
    pub smoking: Option<Smoking>,
    pub living_arrangement: Option<LivingArrangement>,
    pub work_after_marriage: Option<WorkAfterMarriage>,
    pub marriage_timeline: Option<MarriageTimeline>,
    pub jahez_stance: Option<JahezStance>,
    pub about_me: Option<String>,
    pub hobby_codes: Vec<String>,
    pub completeness: i16,
    pub is_phone_verified: bool,
    pub is_photo_verified: bool,
    pub is_id_verified: bool,
    pub last_active_at: OffsetDateTime,
    pub first_activated_at: OffsetDateTime,
    pub privacy: Privacy,
    /// `None`: no `partner_preferences` row.
    pub preferences: Option<Preferences>,
    pub family: Option<FakeFamily>,
}

const MALE_NAMES: &[&str] = &[
    "Ahmed",
    "Ali",
    "Hamza",
    "Bilal",
    "Usman",
    "Hassan",
    "Hussain",
    "Imran",
    "Faisal",
    "Kamran",
    "Zain",
    "Saad",
    "Talha",
    "Fahad",
    "Asad",
    "Waqas",
    "Junaid",
    "Shahzad",
    "Adnan",
    "Omer",
    "Haris",
    "Danish",
    "Arslan",
    "Sohail",
    "Tariq",
    "Nabeel",
    "Yasir",
    "Noman",
    "Rizwan",
    "Shoaib",
    "Muhammad Ali",
    "Abdullah",
    "Ibrahim",
    "Mustafa",
    "Salman",
    "Kashif",
    "Zeeshan",
    "Atif",
    "Farhan",
    "Umair",
];
const FEMALE_NAMES: &[&str] = &[
    "Ayesha", "Fatima", "Zainab", "Maryam", "Hira", "Sana", "Amna", "Iqra", "Mahnoor", "Areeba",
    "Sadia", "Rabia", "Saba", "Nida", "Kiran", "Mehwish", "Sidra", "Bushra", "Hafsa", "Khadija",
    "Aiman", "Anam", "Laiba", "Noor", "Saima", "Uzma", "Zara", "Hina", "Komal", "Javeria",
    "Alishba", "Esha", "Rida", "Tayyaba", "Faiza", "Asma", "Nimra", "Sehrish", "Mahira", "Ruqayya",
];
const LAST_NAMES: &[&str] = &[
    "Khan", "Ahmed", "Malik", "Butt", "Chaudhry", "Qureshi", "Siddiqui", "Sheikh", "Raza",
    "Hussain", "Shah", "Mirza", "Abbasi", "Awan", "Bhatti", "Rana", "Janjua", "Gondal", "Akhtar",
    "Iqbal", "Javed", "Aslam", "Rehman", "Hashmi", "Gillani", "Niazi", "Durrani", "Baloch",
    "Memon", "Ansari",
];
const CASTES: &[&str] = &[
    "arain", "awan", "rajput", "jutt", "gujjar", "syed", "sheikh", "mughal", "malik", "qureshi",
    "pathan", "baloch", "abbasi", "ansari", "bhatti",
];
const EDUCATION: &[(&str, u32)] = &[
    ("matric", 3),
    ("intermediate", 8),
    ("bachelors", 35),
    ("masters", 25),
    ("professional", 15),
    ("mphil", 9),
    ("doctorate", 5),
];
const FIELDS: &[&str] = &[
    "engineering",
    "computer_science_it",
    "medicine",
    "business_management",
    "commerce_accounting",
    "education_teaching",
    "arts_humanities",
    "social_sciences",
    "natural_sciences",
    "law",
    "pharmacy",
    "islamic_studies",
];
const PROFESSIONS: &[&str] = &[
    "software_it",
    "engineer",
    "doctor",
    "teacher",
    "banker",
    "accountant_auditor",
    "business_owner",
    "sales_marketing",
    "manager_executive",
    "civil_servant",
    "lawyer",
    "designer_creative",
    "pharmacist",
    "lecturer_professor",
];
const HOBBIES: &[&str] = &[
    "cricket",
    "football",
    "badminton",
    "reading",
    "writing",
    "poetry",
    "calligraphy",
    "painting_drawing",
    "gym_fitness",
    "walking_running",
    "cycling",
    "swimming",
    "quran_recitation",
    "islamic_study",
    "charity_volunteering",
];
const ABOUT: &[&str] = &[
    "I value family, honesty and a calm home. I enjoy reading and long walks in the evening.",
    "Simple and practising, close to my parents and siblings. Looking for a kind and respectful partner.",
    "I work hard, keep my faith close and love spending weekends with family and friends.",
    "Easy going, fond of travel and good food. Family means a lot to me.",
    "Educated and independent, with traditional values and a modern outlook on life.",
];

/// A weighted choice from `(value, weight)` pairs.
fn weighted<'a, T>(rng: &mut StdRng, items: &'a [(T, u32)]) -> &'a T {
    let total: u32 = items.iter().map(|(_, weight)| weight).sum();
    let mut pick = rng.random_range(0..total.max(1));
    for (value, weight) in items {
        if pick < *weight {
            return value;
        }
        pick -= weight;
    }
    &items[0].0
}

fn pick<'a>(rng: &mut StdRng, items: &'a [&'a str]) -> &'a str {
    items.choose(rng).copied().unwrap_or_default()
}

fn pick_codes(rng: &mut StdRng, items: &[&str], max: usize) -> Vec<String> {
    let count = rng.random_range(0..=max);
    let mut codes: Vec<String> = items
        .sample(rng, count)
        .map(|code| (*code).to_owned())
        .collect();
    codes.sort();
    codes
}

/// The usual mother tongue of a province, with a few alternatives.
fn mother_tongue(rng: &mut StdRng, region: Option<&str>) -> &'static str {
    let options: &[(&str, u32)] = match region {
        Some("Punjab") => &[("punjabi", 7), ("urdu", 2), ("saraiki", 2)],
        Some("Sindh") => &[("urdu", 5), ("sindhi", 4), ("punjabi", 1)],
        Some("Khyber Pakhtunkhwa") => &[("pashto", 7), ("hindko", 2), ("urdu", 1)],
        Some("Balochistan") => &[("balochi", 4), ("pashto", 3), ("brahui", 1)],
        _ => &[("urdu", 5), ("punjabi", 3)],
    };
    weighted(rng, options)
}

impl FakeProfile {
    /// A plain profile: 27, never married, Muslim (Sunni), Urdu, in Pakistan with a typed place
    /// name and no city id, bachelor's, private job, default privacy and no preferences row. Tests start from this and change
    /// what they need.
    pub fn basic(gender: Gender, index: usize, now: OffsetDateTime) -> Self {
        let today = karachi_date(now);
        Self {
            clerk_user_id: format!("{CLERK_PREFIX}test_{}", Uuid::now_v7().simple()),
            first_name: match gender {
                Gender::Male => "Hamza".to_owned(),
                Gender::Female => "Sana".to_owned(),
            },
            last_name: LAST_NAMES[index % LAST_NAMES.len()].to_owned(),
            gender,
            date_of_birth: Date::from_calendar_date(today.year() - 27, today.month(), 1)
                .unwrap_or(today),
            managed_by: ManagedBy::Candidate,
            marital_status: MaritalStatus::NeverMarried,
            children_status: Some(ChildrenStatus::None),
            children_count: None,
            height_cm: match gender {
                Gender::Male => 175,
                Gender::Female => 162,
            },
            weight_kg: None,
            complexion: None,
            body_type: None,
            religion_code: "islam".to_owned(),
            sect_code: Some("sunni".to_owned()),
            caste_code: None,
            mother_tongue_code: "urdu".to_owned(),
            language_codes: Vec::new(),
            country_code: "PK".to_owned(),
            region_id: None,
            city_id: None,
            city_other: Some("Testville".to_owned()),
            education_level_code: "bachelors".to_owned(),
            education_field_code: None,
            employment_type: EmploymentType::PrivateJob,
            profession_code: None,
            income_band_code: None,
            religiosity: None,
            prayer_frequency: None,
            hijab: None,
            beard: None,
            smoking: None,
            living_arrangement: None,
            work_after_marriage: None,
            marriage_timeline: None,
            jahez_stance: None,
            about_me: None,
            hobby_codes: Vec::new(),
            completeness: 60,
            is_phone_verified: false,
            is_photo_verified: false,
            is_id_verified: false,
            last_active_at: now - Duration::hours(2),
            first_activated_at: now - Duration::days(60),
            privacy: Privacy::default(),
            preferences: None,
            family: None,
        }
    }

    /// A realistic random profile.
    #[expect(clippy::too_many_lines, reason = "one assignment per profile column")]
    pub fn random(
        rng: &mut StdRng,
        gender: Gender,
        index: usize,
        cities: &[SeedCity],
        now: OffsetDateTime,
    ) -> Self {
        let today = karachi_date(now);
        let age: i32 = match gender {
            Gender::Male => rng.random_range(23..=40),
            Gender::Female => rng.random_range(20..=36),
        };
        let date_of_birth = Date::from_calendar_date(today.year() - age, today.month(), 1)
            .unwrap_or(today)
            - Duration::days(rng.random_range(0..330));
        let marital_status = *weighted(
            rng,
            &[
                (MaritalStatus::NeverMarried, 85),
                (MaritalStatus::Divorced, 7),
                (MaritalStatus::Widowed, 3),
                (MaritalStatus::Separated, 2),
                (MaritalStatus::NikahEndedBeforeRukhsati, 1),
                (
                    if gender == Gender::Male {
                        MaritalStatus::Married
                    } else {
                        MaritalStatus::Divorced
                    },
                    2,
                ),
            ],
        );
        let (children_status, children_count) = if marital_status == MaritalStatus::NeverMarried
            || marital_status == MaritalStatus::NikahEndedBeforeRukhsati
            || rng.random_bool(0.5)
        {
            (Some(ChildrenStatus::None), None)
        } else {
            let status = if rng.random_bool(0.6) {
                ChildrenStatus::LivingWithMe
            } else {
                ChildrenStatus::NotLivingWithMe
            };
            (Some(status), Some(rng.random_range(1..=3)))
        };
        let city = cities.choose(rng).cloned().unwrap_or(SeedCity {
            id: 0,
            region_id: None,
            region_name: None,
        });
        let tongue = mother_tongue(rng, city.region_name.as_deref());
        let mut languages = vec!["urdu".to_owned(), "english".to_owned()];
        languages.retain(|code| code != tongue);
        let shia = rng.random_bool(0.15);
        let christian = rng.random_bool(0.03);
        let (religion, sect) = if christian {
            (
                "christianity",
                if rng.random_bool(0.5) {
                    "catholic"
                } else {
                    "protestant"
                },
            )
        } else if shia {
            ("islam", "shia")
        } else {
            (
                "islam",
                *weighted(
                    rng,
                    &[
                        ("sunni", 4),
                        ("sunni_barelvi", 3),
                        ("sunni_deobandi", 2),
                        ("ahle_hadith", 1),
                        ("just_muslim", 1),
                    ],
                ),
            )
        };
        let education = *weighted(rng, EDUCATION);
        let employment = if gender == Gender::Female && rng.random_bool(0.25) {
            EmploymentType::Homemaker
        } else {
            *weighted(
                rng,
                &[
                    (EmploymentType::PrivateJob, 45),
                    (EmploymentType::GovernmentJob, 15),
                    (EmploymentType::BusinessOwner, 12),
                    (EmploymentType::SelfEmployed, 10),
                    (EmploymentType::Student, 8),
                    (EmploymentType::NotWorking, 3),
                ],
            )
        };
        let working = !matches!(
            employment,
            EmploymentType::Homemaker | EmploymentType::Student | EmploymentType::NotWorking
        );
        let first_names = match gender {
            Gender::Male => MALE_NAMES,
            Gender::Female => FEMALE_NAMES,
        };
        let religiosity = *weighted(
            rng,
            &[
                (Religiosity::VeryPractising, 2),
                (Religiosity::Practising, 4),
                (Religiosity::ModeratelyPractising, 4),
                (Religiosity::NotPractising, 1),
            ],
        );
        let active_hours = *weighted(rng, &[(6_i64, 4), (48, 3), (24 * 10, 2), (24 * 45, 1)]);
        let new_member = rng.random_bool(0.08);
        let privacy = Privacy {
            discovery_visibility: *weighted(
                rng,
                &[
                    (DiscoveryVisibility::Everyone, 85),
                    (DiscoveryVisibility::PreferenceMatch, 12),
                    (DiscoveryVisibility::Hidden, 3),
                ],
            ),
            interest_permission: *weighted(
                rng,
                &[
                    (InterestPermission::Everyone, 85),
                    (InterestPermission::VerifiedOnly, 8),
                    (InterestPermission::PreferenceMatch, 7),
                ],
            ),
            name_display: *weighted(
                rng,
                &[
                    (NameDisplay::FirstNameLastInitial, 60),
                    (NameDisplay::FirstNameOnly, 15),
                    (NameDisplay::FullName, 10),
                    (NameDisplay::Initials, 10),
                    (NameDisplay::CodeOnly, 5),
                ],
            ),
            photo_visibility: match gender {
                Gender::Male => PhotoVisibility::Members,
                Gender::Female => *weighted(
                    rng,
                    &[
                        (PhotoVisibility::InterestsAndConnections, 70),
                        (PhotoVisibility::Members, 15),
                        (PhotoVisibility::Connections, 10),
                        (PhotoVisibility::ApprovedOnly, 5),
                    ],
                ),
            },
            caste_visibility: *weighted(
                rng,
                &[
                    (FieldVisibility::Members, 80),
                    (FieldVisibility::Connections, 15),
                    (FieldVisibility::Nobody, 5),
                ],
            ),
            income_visibility: *weighted(
                rng,
                &[
                    (FieldVisibility::Connections, 70),
                    (FieldVisibility::Members, 25),
                    (FieldVisibility::Nobody, 5),
                ],
            ),
            family_visibility: *weighted(
                rng,
                &[
                    (FieldVisibility::Members, 80),
                    (FieldVisibility::Connections, 20),
                ],
            ),
            ..Privacy::default()
        };
        let mut profile = Self {
            clerk_user_id: format!(
                "{CLERK_PREFIX}{}_{index:04}",
                match gender {
                    Gender::Male => "m",
                    Gender::Female => "f",
                }
            ),
            first_name: pick(rng, first_names).to_owned(),
            last_name: pick(rng, LAST_NAMES).to_owned(),
            gender,
            date_of_birth,
            managed_by: *weighted(
                rng,
                &[
                    (ManagedBy::Candidate, 60),
                    (ManagedBy::Parent, 30),
                    (ManagedBy::Sibling, 7),
                    (ManagedBy::Relative, 3),
                ],
            ),
            marital_status,
            children_status,
            children_count,
            height_cm: match gender {
                Gender::Male => rng.random_range(160..=190),
                Gender::Female => rng.random_range(150..=175),
            },
            weight_kg: rng.random_bool(0.6).then(|| match gender {
                Gender::Male => rng.random_range(60..=95),
                Gender::Female => rng.random_range(45..=75),
            }),
            complexion: Some(*weighted(
                rng,
                &[
                    (Complexion::Fair, 3),
                    (Complexion::Wheatish, 4),
                    (Complexion::Brown, 2),
                    (Complexion::VeryFair, 1),
                ],
            )),
            body_type: Some(*weighted(
                rng,
                &[
                    (BodyType::Average, 5),
                    (BodyType::Slim, 3),
                    (BodyType::Athletic, 2),
                    (BodyType::Heavy, 1),
                ],
            )),
            religion_code: religion.to_owned(),
            sect_code: Some(sect.to_owned()),
            caste_code: rng.random_bool(0.8).then(|| pick(rng, CASTES).to_owned()),
            mother_tongue_code: tongue.to_owned(),
            language_codes: languages,
            country_code: "PK".to_owned(),
            region_id: city.region_id,
            city_id: Some(city.id),
            city_other: None,
            education_level_code: education.to_owned(),
            education_field_code: Some(pick(rng, FIELDS).to_owned()),
            employment_type: employment,
            profession_code: working.then(|| pick(rng, PROFESSIONS).to_owned()),
            income_band_code: working.then(|| format!("pkr_{}", rng.random_range(2..=6))),
            religiosity: Some(religiosity),
            prayer_frequency: Some(match religiosity {
                Religiosity::VeryPractising => PrayerFrequency::FiveTimes,
                Religiosity::Practising => PrayerFrequency::MostPrayers,
                Religiosity::ModeratelyPractising => PrayerFrequency::Sometimes,
                Religiosity::NotPractising => PrayerFrequency::JummahOnly,
            }),
            hijab: (gender == Gender::Female).then(|| {
                *weighted(
                    rng,
                    &[
                        (Hijab::Dupatta, 5),
                        (Hijab::Hijab, 3),
                        (Hijab::Occasionally, 2),
                        (Hijab::Niqab, 1),
                        (Hijab::None, 1),
                    ],
                )
            }),
            beard: (gender == Gender::Male).then(|| {
                *weighted(
                    rng,
                    &[(Beard::None, 4), (Beard::Trimmed, 4), (Beard::Full, 2)],
                )
            }),
            smoking: Some(*weighted(
                rng,
                &[
                    (Smoking::No, 8),
                    (Smoking::Occasionally, 1),
                    (Smoking::Yes, 1),
                ],
            )),
            living_arrangement: Some(*weighted(
                rng,
                &[
                    (LivingArrangement::WithFamily, 5),
                    (LivingArrangement::Flexible, 3),
                    (LivingArrangement::Separate, 2),
                ],
            )),
            work_after_marriage: Some(*weighted(
                rng,
                &[
                    (WorkAfterMarriage::Flexible, 4),
                    (WorkAfterMarriage::Yes, 3),
                    (WorkAfterMarriage::No, 3),
                ],
            )),
            marriage_timeline: Some(*weighted(
                rng,
                &[
                    (MarriageTimeline::Within1Year, 4),
                    (MarriageTimeline::Within6Months, 2),
                    (MarriageTimeline::Within2Years, 2),
                    (MarriageTimeline::NotDecided, 2),
                ],
            )),
            jahez_stance: Some(*weighted(
                rng,
                &[
                    (JahezStance::Against, 5),
                    (JahezStance::NoDemand, 4),
                    (JahezStance::FamilyCustom, 1),
                ],
            )),
            about_me: rng.random_bool(0.8).then(|| pick(rng, ABOUT).to_owned()),
            hobby_codes: pick_codes(rng, HOBBIES, 5),
            completeness: rng.random_range(55..=95),
            is_phone_verified: rng.random_bool(0.6),
            is_photo_verified: rng.random_bool(0.15),
            is_id_verified: rng.random_bool(0.25),
            last_active_at: now - Duration::minutes(rng.random_range(5..=active_hours * 60)),
            first_activated_at: if new_member {
                now - Duration::hours(rng.random_range(2..=24 * 6))
            } else {
                now - Duration::days(rng.random_range(8..=240))
            },
            privacy,
            preferences: None,
            family: rng.random_bool(0.85).then(|| FakeFamily {
                father_status: if rng.random_bool(0.85) {
                    ParentStatus::Alive
                } else {
                    ParentStatus::Deceased
                },
                mother_status: if rng.random_bool(0.92) {
                    ParentStatus::Alive
                } else {
                    ParentStatus::Deceased
                },
                brothers_count: rng.random_range(0..=4),
                sisters_count: rng.random_range(0..=4),
                family_type: if rng.random_bool(0.55) {
                    FamilyType::Joint
                } else {
                    FamilyType::Nuclear
                },
                family_class: *weighted(
                    rng,
                    &[
                        (FamilyClass::Middle, 5),
                        (FamilyClass::UpperMiddle, 3),
                        (FamilyClass::LowerMiddle, 2),
                        (FamilyClass::Affluent, 1),
                    ],
                ),
                family_values: *weighted(
                    rng,
                    &[
                        (FamilyValues::Moderate, 4),
                        (FamilyValues::Traditional, 4),
                        (FamilyValues::Religious, 2),
                        (FamilyValues::Liberal, 1),
                    ],
                ),
            }),
        };
        if profile.marital_status == MaritalStatus::Married {
            profile.children_status = Some(ChildrenStatus::None);
            profile.children_count = None;
        }
        profile.preferences = rng
            .random_bool(0.9)
            .then(|| random_preferences(rng, &profile, cities, today));
        profile
    }
}

/// Preferences around the profile's own facts: the defaults of 07 section 12, sometimes
/// narrowed by place, sect, education or religious practice.
fn random_preferences(
    rng: &mut StdRng,
    profile: &FakeProfile,
    cities: &[SeedCity],
    today: Date,
) -> Preferences {
    let mut prefs = default_preferences(&DefaultsInput {
        gender: Some(profile.gender),
        age: Some(age_on(profile.date_of_birth, today)),
        marital_status: Some(profile.marital_status),
        religion_code: Some(&profile.religion_code),
        country_code: Some(&profile.country_code),
    });
    if profile.gender == Gender::Female && rng.random_bool(0.04) {
        prefs.marital_statuses.push(MaritalStatus::Married);
    }
    if rng.random_bool(0.3) {
        prefs.city_ids = cities.sample(rng, 2).map(|city| city.id).collect();
        prefs.country_codes.clear();
    }
    if rng.random_bool(0.3)
        && let Some(sect) = &profile.sect_code
    {
        prefs.sect_codes = vec![sect.clone()];
    }
    if rng.random_bool(0.3) {
        prefs.education_min_rank = Some(rng.random_range(4..=6));
    }
    if rng.random_bool(0.3) {
        prefs.religiosity_levels = vec![Religiosity::Practising, Religiosity::ModeratelyPractising];
    }
    if rng.random_bool(0.1) {
        prefs.children_acceptance = ChildrenAcceptance::None;
    }
    if rng.random_bool(0.1) {
        prefs.location_importance = Importance::High;
    }
    prefs
}

/// Inserts fake profiles with their users, consents, privacy, preferences, family, languages
/// and hobbies, in one transaction with multi-row inserts. Profiles whose `clerk_user_id`
/// already exists are skipped. Returns the new profile ids, in input order.
pub async fn insert(db: &PgPool, profiles: &[FakeProfile]) -> anyhow::Result<Vec<Uuid>> {
    let mut tx = db.begin().await?;
    let mut created_users: HashSet<String> = HashSet::new();
    let ids: Vec<(Uuid, Uuid)> = profiles
        .iter()
        .map(|_| (Uuid::now_v7(), Uuid::now_v7()))
        .collect();
    for (chunk, chunk_ids) in profiles.chunks(CHUNK).zip(ids.chunks(CHUNK)) {
        let mut qb: QueryBuilder<Postgres> =
            QueryBuilder::new("INSERT INTO users (id, clerk_user_id, email, email_verified) ");
        qb.push_values(
            chunk.iter().zip(chunk_ids),
            |mut row, (profile, (user_id, _))| {
                row.push_bind(*user_id)
                    .push_bind(profile.clerk_user_id.clone())
                    .push_bind(format!("{}@example.test", profile.clerk_user_id))
                    .push_bind(true);
            },
        );
        qb.push(" ON CONFLICT (clerk_user_id) DO NOTHING RETURNING clerk_user_id");
        let inserted: Vec<String> = qb.build_query_scalar().fetch_all(&mut *tx).await?;
        created_users.extend(inserted);
    }
    let new: Vec<(&FakeProfile, Uuid, Uuid)> = profiles
        .iter()
        .zip(&ids)
        .filter(|(profile, _)| created_users.contains(&profile.clerk_user_id))
        .map(|(profile, (user_id, profile_id))| (profile, *user_id, *profile_id))
        .collect();
    if new.is_empty() {
        tx.commit().await?;
        return Ok(Vec::new());
    }
    let user_ids: Vec<Uuid> = new.iter().map(|(_, user_id, _)| *user_id).collect();
    sqlx::query(
        "INSERT INTO user_consents (user_id, document, version)
         SELECT u.id, d.document,
                COALESCE((SELECT value #>> '{}' FROM app_settings WHERE key = d.key), '2026-11-20')
         FROM unnest($1::uuid[]) AS u(id)
         CROSS JOIN (VALUES ('terms', 'legal.terms_version'),
                            ('privacy', 'legal.privacy_version'),
                            ('community_guidelines', 'legal.guidelines_version'),
                            ('age_declaration', 'legal.terms_version')) AS d(document, key)
         ON CONFLICT DO NOTHING",
    )
    .bind(&user_ids)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO notification_preferences (user_id) SELECT unnest($1::uuid[]) ON CONFLICT DO NOTHING",
    )
    .bind(&user_ids)
    .execute(&mut *tx)
    .await?;
    for chunk in new.chunks(CHUNK) {
        insert_profiles(&mut tx, chunk).await?;
        insert_privacy(&mut tx, chunk).await?;
        insert_preferences(&mut tx, chunk).await?;
        insert_families(&mut tx, chunk).await?;
    }
    insert_codes(&mut tx, &new).await?;
    tx.commit().await.context("seed transaction")?;
    Ok(new.iter().map(|(_, _, profile_id)| *profile_id).collect())
}

type Fresh<'a> = (&'a FakeProfile, Uuid, Uuid);

async fn insert_profiles(tx: &mut sqlx::PgConnection, rows: &[Fresh<'_>]) -> sqlx::Result<()> {
    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "INSERT INTO profiles (id, user_id, public_code, status, onboarding_step,
             onboarding_completed_at, first_activated_at, managed_by, first_name, last_name,
             gender, date_of_birth, marital_status, children_status, children_count,
             current_wives_count, height_cm, weight_kg, complexion, body_type, religion_code,
             sect_code, caste_code, mother_tongue_code, nationality_code, country_code,
             region_id, city_id, city_other, education_level_code, education_field_code, employment_type,
             profession_code, income_band_code, religiosity, prayer_frequency, hijab, beard,
             smoking, living_arrangement, work_after_marriage, marriage_timeline, jahez_stance,
             about_me, completeness, is_phone_verified, is_photo_verified, is_id_verified,
             last_active_at, match_stale) ",
    );
    qb.push_values(rows, |mut row, (profile, user_id, profile_id)| {
        let wives = (profile.marital_status == MaritalStatus::Married).then_some(1_i16);
        row.push_bind(*profile_id)
            .push_bind(*user_id)
            .push_bind(generate_public_code())
            .push("'active'")
            .push("'done'")
            .push_bind(profile.first_activated_at)
            .push_bind(profile.first_activated_at)
            .push_bind(profile.managed_by)
            .push_bind(profile.first_name.clone())
            .push_bind(profile.last_name.clone())
            .push_bind(profile.gender)
            .push_bind(profile.date_of_birth)
            .push_bind(profile.marital_status)
            .push_bind(profile.children_status)
            .push_bind(profile.children_count)
            .push_bind(wives)
            .push_bind(profile.height_cm)
            .push_bind(profile.weight_kg)
            .push_bind(profile.complexion)
            .push_bind(profile.body_type)
            .push_bind(profile.religion_code.clone())
            .push_bind(profile.sect_code.clone())
            .push_bind(profile.caste_code.clone())
            .push_bind(profile.mother_tongue_code.clone())
            .push_bind(profile.country_code.clone())
            .push_bind(profile.country_code.clone())
            .push_bind(profile.region_id)
            .push_bind(profile.city_id)
            .push_bind(profile.city_other.clone())
            .push_bind(profile.education_level_code.clone())
            .push_bind(profile.education_field_code.clone())
            .push_bind(profile.employment_type)
            .push_bind(profile.profession_code.clone())
            .push_bind(profile.income_band_code.clone())
            .push_bind(profile.religiosity)
            .push_bind(profile.prayer_frequency)
            .push_bind(profile.hijab)
            .push_bind(profile.beard)
            .push_bind(profile.smoking)
            .push_bind(profile.living_arrangement)
            .push_bind(profile.work_after_marriage)
            .push_bind(profile.marriage_timeline)
            .push_bind(profile.jahez_stance)
            .push_bind(profile.about_me.clone())
            .push_bind(profile.completeness)
            .push_bind(profile.is_phone_verified)
            .push_bind(profile.is_photo_verified)
            .push_bind(profile.is_id_verified)
            .push_bind(profile.last_active_at)
            .push("true");
    });
    qb.build().execute(tx).await?;
    Ok(())
}

async fn insert_privacy(tx: &mut sqlx::PgConnection, rows: &[Fresh<'_>]) -> sqlx::Result<()> {
    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "INSERT INTO profile_privacy (profile_id, discovery_visibility, interest_permission,
             name_display, photo_visibility, caste_visibility, income_visibility,
             family_visibility, career_details_visibility, home_visibility, area_visibility,
             health_visibility, show_last_active, show_online_status, record_my_visits,
             send_read_receipts, allow_photo_requests) ",
    );
    qb.push_values(rows, |mut row, (profile, _, profile_id)| {
        let p = &profile.privacy;
        row.push_bind(*profile_id)
            .push_bind(p.discovery_visibility)
            .push_bind(p.interest_permission)
            .push_bind(p.name_display)
            .push_bind(p.photo_visibility)
            .push_bind(p.caste_visibility)
            .push_bind(p.income_visibility)
            .push_bind(p.family_visibility)
            .push_bind(p.career_details_visibility)
            .push_bind(p.home_visibility)
            .push_bind(p.area_visibility)
            .push_bind(p.health_visibility)
            .push_bind(p.show_last_active)
            .push_bind(p.show_online_status)
            .push_bind(p.record_my_visits)
            .push_bind(p.send_read_receipts)
            .push_bind(p.allow_photo_requests);
    });
    qb.build().execute(tx).await?;
    Ok(())
}

async fn insert_preferences(tx: &mut sqlx::PgConnection, rows: &[Fresh<'_>]) -> sqlx::Result<()> {
    let with: Vec<(Uuid, &Preferences)> = rows
        .iter()
        .filter_map(|(profile, _, id)| profile.preferences.as_ref().map(|prefs| (*id, prefs)))
        .collect();
    if with.is_empty() {
        return Ok(());
    }
    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(format!(
        "INSERT INTO partner_preferences (profile_id, {}) ",
        crate::views::load::PREFERENCE_COLUMNS
    ));
    qb.push_values(with, |mut row, (profile_id, p)| {
        row.push_bind(profile_id)
            .push_bind(p.age_min)
            .push_bind(p.age_max)
            .push_bind(p.age_importance)
            .push_bind(p.height_min_cm)
            .push_bind(p.height_max_cm)
            .push_bind(p.height_importance)
            .push_bind(p.marital_statuses.clone())
            .push_bind(p.marital_status_importance)
            .push_bind(p.children_acceptance)
            .push_bind(p.children_importance)
            .push_bind(p.religion_codes.clone())
            .push_bind(p.religion_importance)
            .push_bind(p.sect_codes.clone())
            .push_bind(p.sect_importance)
            .push_bind(p.caste_codes.clone())
            .push_bind(p.caste_importance)
            .push_bind(p.mother_tongue_codes.clone())
            .push_bind(p.mother_tongue_importance)
            .push_bind(p.country_codes.clone())
            .push_bind(p.region_ids.clone())
            .push_bind(p.city_ids.clone())
            .push_bind(p.location_importance)
            .push_bind(p.education_min_rank)
            .push_bind(p.education_importance)
            .push_bind(p.employment_types.clone())
            .push_bind(p.profession_codes.clone())
            .push_bind(p.profession_importance)
            .push_bind(p.income_min_rank)
            .push_bind(p.income_importance)
            .push_bind(p.religiosity_levels.clone())
            .push_bind(p.religiosity_importance)
            .push_bind(p.hijab_types.clone())
            .push_bind(p.beard_types.clone())
            .push_bind(p.appearance_importance)
            .push_bind(p.family_values.clone())
            .push_bind(p.family_types.clone())
            .push_bind(p.family_importance)
            .push_bind(p.living_arrangements.clone())
            .push_bind(p.living_arrangement_importance)
            .push_bind(p.work_after_marriage_options.clone())
            .push_bind(p.work_after_marriage_importance)
            .push_bind(p.smoking_options.clone())
            .push_bind(p.smoking_importance)
            .push_bind(p.notes.clone());
    });
    qb.build().execute(tx).await?;
    Ok(())
}

async fn insert_families(tx: &mut sqlx::PgConnection, rows: &[Fresh<'_>]) -> sqlx::Result<()> {
    let with: Vec<(Uuid, &FakeFamily)> = rows
        .iter()
        .filter_map(|(profile, _, id)| profile.family.as_ref().map(|family| (*id, family)))
        .collect();
    if with.is_empty() {
        return Ok(());
    }
    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "INSERT INTO profile_family (profile_id, father_status, mother_status, brothers_count,
             sisters_count, family_type, family_class, family_values) ",
    );
    qb.push_values(with, |mut row, (profile_id, family)| {
        row.push_bind(profile_id)
            .push_bind(family.father_status)
            .push_bind(family.mother_status)
            .push_bind(family.brothers_count)
            .push_bind(family.sisters_count)
            .push_bind(family.family_type)
            .push_bind(family.family_class)
            .push_bind(family.family_values);
    });
    qb.build().execute(tx).await?;
    Ok(())
}

/// Languages and hobbies with one `UNNEST` insert each.
async fn insert_codes(tx: &mut sqlx::PgConnection, rows: &[Fresh<'_>]) -> sqlx::Result<()> {
    let mut language_profiles = Vec::new();
    let mut languages = Vec::new();
    let mut hobby_profiles = Vec::new();
    let mut hobbies = Vec::new();
    for (profile, _, profile_id) in rows {
        for code in &profile.language_codes {
            language_profiles.push(*profile_id);
            languages.push(code.clone());
        }
        for code in &profile.hobby_codes {
            hobby_profiles.push(*profile_id);
            hobbies.push(code.clone());
        }
    }
    sqlx::query(
        "INSERT INTO profile_languages (profile_id, language_code)
         SELECT * FROM unnest($1::uuid[], $2::text[]) ON CONFLICT DO NOTHING",
    )
    .bind(&language_profiles)
    .bind(&languages)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO profile_hobbies (profile_id, hobby_code)
         SELECT * FROM unnest($1::uuid[], $2::text[]) ON CONFLICT DO NOTHING",
    )
    .bind(&hobby_profiles)
    .bind(&hobbies)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use super::*;

    #[sqlx::test]
    async fn seed_creates_300_active_profiles_per_gender_and_is_idempotent(db: PgPool) {
        let config = Config::for_tests();
        run(&config, &db).await.expect("the seed runs");
        let counts: Vec<(String, i64)> = sqlx::query_as(
            "SELECT p.gender, count(*) FROM profiles p JOIN users u ON u.id = p.user_id
             WHERE u.clerk_user_id LIKE 'seed_dev_%' AND p.status = 'active'
             GROUP BY p.gender ORDER BY p.gender",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(
            counts,
            vec![("female".to_owned(), 300), ("male".to_owned(), 300)]
        );
        let privacy_rows: i64 = sqlx::query_scalar("SELECT count(*) FROM profile_privacy")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(privacy_rows, 600, "every profile has privacy settings");
        let preferences: i64 = sqlx::query_scalar("SELECT count(*) FROM partner_preferences")
            .fetch_one(&db)
            .await
            .unwrap();
        assert!(
            preferences > 400,
            "most profiles state preferences: {preferences}"
        );

        run(&config, &db).await.expect("a second run works");
        let total: i64 = sqlx::query_scalar("SELECT count(*) FROM profiles")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(total, 600, "a second run adds nothing");
    }

    #[tokio::test]
    async fn production_is_refused() {
        let mut config = Config::for_tests();
        config.app_env = AppEnv::Production;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://unused@localhost/unused")
            .unwrap();
        let error = run(&config, &pool).await.unwrap_err();
        assert!(
            error
                .to_string()
                .contains("refuses to run when APP_ENV=production")
        );
    }
}
