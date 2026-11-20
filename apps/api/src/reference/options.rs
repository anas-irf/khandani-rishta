//! Labels of the closed option lists, served in `ReferenceBootstrap.options`.
//!
//! Generated from specs/05-reference-data.md section 2. The codes are the values allowed by the
//! schema `CHECK` constraints; rows are in display order. `label_ur` stays empty until the
//! Urdu phase.

/// One option of a closed list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OptionRow {
    pub code: &'static str,
    pub label: &'static str,
    pub label_ur: Option<&'static str>,
}

/// A closed list and its options.
#[derive(Debug, Clone, Copy)]
pub struct OptionList {
    pub name: &'static str,
    pub rows: &'static [OptionRow],
}

const fn row(code: &'static str, label: &'static str) -> OptionRow {
    OptionRow {
        code,
        label,
        label_ur: None,
    }
}

/// Every closed list, in the order of 05 section 2.
pub const OPTION_LISTS: &[OptionList] = &[
    OptionList {
        name: "gender",
        rows: &[row("male", "Male"), row("female", "Female")],
    },
    OptionList {
        name: "managed_by",
        rows: &[
            row("self", "Self"),
            row("parent", "Parent"),
            row("sibling", "Brother or sister"),
            row("relative", "Relative"),
            row("friend", "Friend"),
        ],
    },
    OptionList {
        name: "marital_status",
        rows: &[
            row("never_married", "Never married"),
            row("divorced", "Divorced"),
            row("widowed", "Widowed"),
            row("separated", "Separated"),
            row("nikah_ended_before_rukhsati", "Nikah ended before rukhsati"),
            row("married", "Married (seeking another marriage)"),
        ],
    },
    OptionList {
        name: "children_status",
        rows: &[
            row("none", "No children"),
            row("living_with_me", "Yes, living with me"),
            row("not_living_with_me", "Yes, not living with me"),
        ],
    },
    OptionList {
        name: "complexion",
        rows: &[
            row("very_fair", "Very fair"),
            row("fair", "Fair"),
            row("wheatish", "Wheatish"),
            row("brown", "Brown"),
            row("dark", "Dark"),
        ],
    },
    OptionList {
        name: "body_type",
        rows: &[
            row("slim", "Slim"),
            row("average", "Average"),
            row("athletic", "Athletic"),
            row("heavy", "Heavy"),
        ],
    },
    OptionList {
        name: "blood_group",
        rows: &[
            row("a_pos", "A+"),
            row("a_neg", "A-"),
            row("b_pos", "B+"),
            row("b_neg", "B-"),
            row("ab_pos", "AB+"),
            row("ab_neg", "AB-"),
            row("o_pos", "O+"),
            row("o_neg", "O-"),
        ],
    },
    OptionList {
        name: "disability",
        rows: &[
            row("none", "None"),
            row("physical", "Physical disability"),
            row("visual", "Visual impairment"),
            row("hearing", "Hearing impairment"),
            row("speech", "Speech impairment"),
            row("chronic_illness", "Long-term illness"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "residency_status",
        rows: &[
            row("citizen", "Citizen"),
            row("permanent_resident", "Permanent resident"),
            row("work_visa", "Work visa"),
            row("student_visa", "Student visa"),
            row("dependent_visa", "Dependent or family visa"),
            row("visit_visa", "Visit visa"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "relocation",
        rows: &[
            row("not_willing", "Not willing to relocate"),
            row("within_country", "Within the same country"),
            row("abroad", "Willing to move abroad"),
            row("anywhere", "Anywhere"),
        ],
    },
    OptionList {
        name: "employment_type",
        rows: &[
            row("private_job", "Private job"),
            row("government_job", "Government job"),
            row("armed_forces", "Armed forces"),
            row("business_owner", "Business owner"),
            row("self_employed", "Self-employed or freelancer"),
            row("student", "Student"),
            row("homemaker", "Homemaker"),
            row("not_working", "Not working"),
            row("retired", "Retired"),
        ],
    },
    OptionList {
        name: "religiosity",
        rows: &[
            row("very_practising", "Very practising"),
            row("practising", "Practising"),
            row("moderately_practising", "Moderately practising"),
            row("not_practising", "Not practising"),
        ],
    },
    OptionList {
        name: "prayer_frequency",
        rows: &[
            row("five_times", "Five times a day"),
            row("most_prayers", "Most prayers"),
            row("sometimes", "Sometimes"),
            row("jummah_only", "Jummah only"),
            row("rarely", "Rarely"),
        ],
    },
    OptionList {
        name: "hijab",
        rows: &[
            row("niqab", "Niqab"),
            row("hijab", "Hijab or abaya"),
            row("dupatta", "Dupatta or chadar"),
            row("occasionally", "Occasionally"),
            row("none", "None"),
        ],
    },
    OptionList {
        name: "beard",
        rows: &[
            row("full", "Full beard"),
            row("trimmed", "Trimmed beard"),
            row("none", "No beard"),
        ],
    },
    OptionList {
        name: "religious_education",
        rows: &[
            row("none", "None"),
            row("nazra", "Nazra Quran"),
            row("hafiz", "Hafiz-e-Quran"),
            row("alim", "Alim or Alima (Dars-e-Nizami)"),
        ],
    },
    OptionList {
        name: "smoking",
        rows: &[
            row("no", "No"),
            row("occasionally", "Occasionally"),
            row("yes", "Yes"),
        ],
    },
    OptionList {
        name: "living_arrangement",
        rows: &[
            row("with_family", "With family (joint)"),
            row("separate", "Separate home"),
            row("flexible", "Flexible"),
        ],
    },
    OptionList {
        name: "work_after_marriage",
        rows: &[
            row("yes", "Yes"),
            row("no", "No"),
            row("flexible", "Flexible"),
        ],
    },
    OptionList {
        name: "marriage_timeline",
        rows: &[
            row("within_6_months", "Within 6 months"),
            row("within_1_year", "Within 1 year"),
            row("within_2_years", "Within 2 years"),
            row("not_decided", "Not decided"),
        ],
    },
    OptionList {
        name: "jahez_stance",
        rows: &[
            row("against", "Against jahez"),
            row("no_demand", "No demand"),
            row("family_custom", "As per family custom"),
        ],
    },
    OptionList {
        name: "parent_status",
        rows: &[row("alive", "Alive"), row("deceased", "Deceased")],
    },
    OptionList {
        name: "family_type",
        rows: &[
            row("joint", "Joint family"),
            row("nuclear", "Nuclear family"),
        ],
    },
    OptionList {
        name: "family_class",
        rows: &[
            row("lower_middle", "Lower middle class"),
            row("middle", "Middle class"),
            row("upper_middle", "Upper middle class"),
            row("affluent", "Affluent"),
        ],
    },
    OptionList {
        name: "family_values",
        rows: &[
            row("religious", "Religious"),
            row("traditional", "Traditional"),
            row("moderate", "Moderate"),
            row("liberal", "Liberal"),
        ],
    },
    OptionList {
        name: "home_ownership",
        rows: &[
            row("owned", "Owned"),
            row("rented", "Rented"),
            row("ancestral", "Family-owned (ancestral)"),
            row("employer_provided", "Employer or government provided"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "home_type",
        rows: &[
            row("house", "House"),
            row("apartment", "Apartment or flat"),
            row("portion", "Portion"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "home_size_unit",
        rows: &[
            row("marla", "Marla"),
            row("kanal", "Kanal"),
            row("sq_yard", "Square yards (gaz)"),
            row("sq_ft", "Square feet"),
            row("sq_m", "Square metres"),
        ],
    },
    OptionList {
        name: "guardian_relation",
        rows: &[
            row("father", "Father"),
            row("mother", "Mother"),
            row("brother", "Brother"),
            row("sister", "Sister"),
            row("uncle", "Uncle"),
            row("aunt", "Aunt"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "preferred_contact",
        rows: &[
            row("self", "The candidate"),
            row("guardian", "The guardian"),
        ],
    },
    OptionList {
        name: "importance",
        rows: &[
            row("must", "Must have"),
            row("high", "Very important"),
            row("medium", "Important"),
            row("low", "Nice to have"),
        ],
    },
    OptionList {
        name: "children_acceptance",
        rows: &[
            row("any", "Children are fine"),
            row(
                "not_living_with_partner",
                "Only if the children do not live with the partner",
            ),
            row("none", "No children"),
        ],
    },
    OptionList {
        name: "name_display",
        rows: &[
            row("full_name", "Full name"),
            row("first_name_last_initial", "First name and initial"),
            row("first_name_only", "First name only"),
            row("initials", "Initials"),
            row("code_only", "Profile code only"),
        ],
    },
    OptionList {
        name: "photo_visibility",
        rows: &[
            row("members", "All members"),
            row("interests_and_connections", "People I show interest in"),
            row("connections", "Connections only"),
            row("approved_only", "Only people I approve"),
        ],
    },
    OptionList {
        name: "field_visibility",
        rows: &[
            row("members", "All members"),
            row("connections", "Connections only"),
            row("nobody", "Nobody"),
        ],
    },
    OptionList {
        name: "discovery_visibility",
        rows: &[
            row("everyone", "Everyone"),
            row("preference_match", "Only people who fit my must-haves"),
            row("hidden", "Hidden"),
        ],
    },
    OptionList {
        name: "interest_permission",
        rows: &[
            row("everyone", "Anyone"),
            row("verified_only", "Verified members only"),
            row("preference_match", "Only people who fit my must-haves"),
        ],
    },
    OptionList {
        name: "document_type",
        rows: &[
            row("cnic", "CNIC"),
            row("nicop", "NICOP"),
            row("poc", "Pakistan Origin Card (POC)"),
            row("passport", "Passport"),
        ],
    },
    OptionList {
        name: "closed_reason",
        rows: &[
            row("found_match_here", "I found a match on Khandani Rishta"),
            row("found_match_elsewhere", "I found a match elsewhere"),
            row("taking_a_break", "I am taking a break"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "connection_stage",
        rows: &[
            row("chatting", "Getting to know each other"),
            row("families_talking", "Our families are in touch"),
            row("engaged", "Rishta confirmed"),
            row("nikah_done", "Nikah completed"),
        ],
    },
    OptionList {
        name: "connection_end_reason",
        rows: &[
            row("not_compatible", "We are not compatible"),
            row("family_declined", "Family did not agree"),
            row("no_response", "No response"),
            row("found_someone_else", "Found someone else"),
            row("inappropriate_behaviour", "Inappropriate behaviour"),
            row("other", "Other"),
            row("blocked", "Ended by a block"),
            row("account_closed", "The account was closed"),
        ],
    },
    OptionList {
        name: "report_reason",
        rows: &[
            row("fake_profile", "Fake profile"),
            row("already_married", "Already married and hiding it"),
            row("misleading_information", "False or misleading information"),
            row("inappropriate_photo", "Inappropriate photo"),
            row("harassment", "Harassment or abusive behaviour"),
            row("asking_for_money", "Asking for money"),
            row("marriage_bureau_or_agent", "Marriage bureau or paid agent"),
            row("underage", "Under 18"),
            row("impersonation", "Pretending to be someone else"),
            row("offensive_content", "Offensive content"),
            row("other", "Something else"),
        ],
    },
    OptionList {
        name: "photo_rejection_reason",
        rows: &[
            row("not_a_person", "The photo does not show a person"),
            row("face_not_visible", "The face is not clearly visible"),
            row("group_photo", "Group photo"),
            row("inappropriate", "Not appropriate for this platform"),
            row("contains_contact_info", "Contains contact details or text"),
            row("low_quality", "Too blurry or too dark"),
            row("not_the_candidate", "Does not appear to be the candidate"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "verification_rejection_reason",
        rows: &[
            row("unreadable", "The image is not readable"),
            row(
                "document_mismatch",
                "The document does not match the profile",
            ),
            row("face_mismatch", "The face does not match"),
            row("gesture_missing", "The requested gesture is missing"),
            row("expired_document", "The document has expired"),
            row("underage", "The candidate is under 18"),
            row("suspected_fraud", "The document could not be accepted"),
            row("other", "Other"),
        ],
    },
    OptionList {
        name: "email_match_digest",
        rows: &[
            row("off", "Off"),
            row("daily", "Daily"),
            row("weekly", "Weekly"),
        ],
    },
];

/// The options of one list, or `None` for an unknown list name.
pub fn list(name: &str) -> Option<&'static [OptionRow]> {
    OPTION_LISTS.iter().find(|l| l.name == name).map(|l| l.rows)
}

/// The label of one code in one list.
pub fn label(list_name: &str, code: &str) -> Option<&'static str> {
    list(list_name)?
        .iter()
        .find(|r| r.code == code)
        .map(|r| r.label)
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;
    use std::collections::{BTreeSet, HashSet};

    use regex::Regex;
    use sqlx::error::DatabaseError;
    use sqlx::{AssertSqlSafe, PgConnection, PgPool, SqlSafeStr};

    use super::OPTION_LISTS;

    /// The `*_importance` columns of `partner_preferences`, all constrained to the `importance` list.
    const IMPORTANCE_COLUMNS: &[&str] = &[
        "age_importance",
        "height_importance",
        "marital_status_importance",
        "children_importance",
        "religion_importance",
        "sect_importance",
        "caste_importance",
        "mother_tongue_importance",
        "location_importance",
        "education_importance",
        "profession_importance",
        "income_importance",
        "religiosity_importance",
        "appearance_importance",
        "family_importance",
        "living_arrangement_importance",
        "work_after_marriage_importance",
        "smoking_importance",
    ];

    /// The `*_visibility` columns of `profile_privacy` that use the `field_visibility` list.
    const FIELD_VISIBILITY_COLUMNS: &[&str] = &[
        "caste_visibility",
        "income_visibility",
        "family_visibility",
        "career_details_visibility",
        "home_visibility",
        "area_visibility",
        "health_visibility",
    ];

    /// Where each closed list is enforced: `(list, table, columns)`. Every column's `CHECK`
    /// constraint must allow the codes of the list (05 section 1.1).
    const LIST_COLUMNS: &[(&str, &str, &[&str])] = &[
        ("gender", "profiles", &["gender"]),
        ("managed_by", "profiles", &["managed_by"]),
        ("marital_status", "profiles", &["marital_status"]),
        ("children_status", "profiles", &["children_status"]),
        ("complexion", "profiles", &["complexion"]),
        ("body_type", "profiles", &["body_type"]),
        ("blood_group", "profiles", &["blood_group"]),
        ("disability", "profiles", &["disability"]),
        ("residency_status", "profiles", &["residency_status"]),
        ("relocation", "profiles", &["relocation"]),
        ("employment_type", "profiles", &["employment_type"]),
        ("religiosity", "profiles", &["religiosity"]),
        ("prayer_frequency", "profiles", &["prayer_frequency"]),
        ("hijab", "profiles", &["hijab"]),
        ("beard", "profiles", &["beard"]),
        ("religious_education", "profiles", &["religious_education"]),
        ("smoking", "profiles", &["smoking"]),
        ("living_arrangement", "profiles", &["living_arrangement"]),
        ("work_after_marriage", "profiles", &["work_after_marriage"]),
        ("marriage_timeline", "profiles", &["marriage_timeline"]),
        ("jahez_stance", "profiles", &["jahez_stance"]),
        (
            "parent_status",
            "profile_family",
            &["father_status", "mother_status"],
        ),
        ("family_type", "profile_family", &["family_type"]),
        ("family_class", "profile_family", &["family_class"]),
        ("family_values", "profile_family", &["family_values"]),
        ("home_ownership", "profile_family", &["home_ownership"]),
        ("home_type", "profile_family", &["home_type"]),
        ("home_size_unit", "profile_family", &["home_size_unit"]),
        (
            "guardian_relation",
            "profile_contacts",
            &["guardian_relation"],
        ),
        (
            "preferred_contact",
            "profile_contacts",
            &["preferred_contact"],
        ),
        ("importance", "partner_preferences", IMPORTANCE_COLUMNS),
        (
            "children_acceptance",
            "partner_preferences",
            &["children_acceptance"],
        ),
        ("name_display", "profile_privacy", &["name_display"]),
        ("photo_visibility", "profile_privacy", &["photo_visibility"]),
        (
            "field_visibility",
            "profile_privacy",
            FIELD_VISIBILITY_COLUMNS,
        ),
        (
            "discovery_visibility",
            "profile_privacy",
            &["discovery_visibility"],
        ),
        (
            "interest_permission",
            "profile_privacy",
            &["interest_permission"],
        ),
        ("document_type", "profile_identity", &["document_type"]),
        ("closed_reason", "profiles", &["closed_reason"]),
        ("connection_stage", "connections", &["stage"]),
        ("connection_end_reason", "connections", &["ended_reason"]),
        ("report_reason", "reports", &["reason"]),
        (
            "photo_rejection_reason",
            "profile_photos",
            &["rejection_reason"],
        ),
        (
            "verification_rejection_reason",
            "verification_requests",
            &["rejection_reason"],
        ),
        (
            "email_match_digest",
            "notification_preferences",
            &["email_match_digest"],
        ),
    ];

    /// Closed lists that no column enforces. Each entry needs a comment saying why. Today every
    /// list of 05 section 2 is backed by at least one column, so this stays empty.
    const LISTS_WITHOUT_COLUMN: &[&str] = &[];

    /// A value no list contains.
    const MADE_UP_CODE: &str = "not_a_real_code";

    /// SQLSTATE of a violated `CHECK` constraint.
    const CHECK_VIOLATION: &str = "23514";

    #[test]
    fn option_lists_are_well_formed_and_mapped_to_columns() {
        let code_shape = Regex::new("^[a-z][a-z0-9_]*$").expect("valid regex");
        let mut list_names = HashSet::new();
        for list in OPTION_LISTS {
            assert!(list_names.insert(list.name), "duplicate list {}", list.name);
            assert!(!list.rows.is_empty(), "list {} is empty", list.name);
            let mut codes = HashSet::new();
            for row in list.rows {
                assert!(
                    code_shape.is_match(row.code),
                    "{}: code {:?} breaks the code rule (05 section 1.2)",
                    list.name,
                    row.code
                );
                assert!(
                    codes.insert(row.code),
                    "{}: duplicate {}",
                    list.name,
                    row.code
                );
                assert!(
                    !row.label.is_empty(),
                    "{}.{} has no label",
                    list.name,
                    row.code
                );
            }
        }

        // Every list is mapped to columns or explicitly skipped, and nothing else is mapped.
        let mapped: Vec<&str> = LIST_COLUMNS.iter().map(|(list, _, _)| *list).collect();
        let mapped_set: HashSet<&str> = mapped.iter().copied().collect();
        assert_eq!(mapped.len(), mapped_set.len(), "a list is mapped twice");
        for name in &list_names {
            assert!(
                mapped_set.contains(name) || LISTS_WITHOUT_COLUMN.contains(name),
                "list {name} has no column mapping: add it to LIST_COLUMNS"
            );
        }
        for name in mapped_set.iter().chain(LISTS_WITHOUT_COLUMN) {
            assert!(
                list_names.contains(name),
                "mapping names an unknown list {name}"
            );
        }
    }

    /// Other columns that must be set for `code` to pass the table's cross-column rules, as
    /// `(column, SQL literal)`. Without them the row would fail a different `CHECK`.
    fn companions(
        table: &str,
        column: &str,
        code: &str,
    ) -> &'static [(&'static str, &'static str)] {
        match (table, column, code) {
            // profiles_wives_count_when_married and profiles_married_only_male
            ("profiles", "marital_status", "married") => {
                &[("gender", "'male'"), ("current_wives_count", "1")]
            }
            // profile_family_home_size: a unit needs a value
            ("profile_family", "home_size_unit", _) => &[("home_size_value", "1")],
            _ => &[],
        }
    }

    /// `INSERT` into a probe table. The text is built only from the static table, column and
    /// companion names of this module; the code itself is bound as `$1`.
    fn probe_insert(table: &str, column: &str, code: &str) -> AssertSqlSafe<String> {
        let mut columns = vec![format!("\"{column}\"")];
        let mut values = vec!["$1".to_owned()];
        for (other, literal) in companions(table, column, code) {
            columns.push(format!("\"{other}\""));
            values.push((*literal).to_owned());
        }
        AssertSqlSafe(format!(
            "INSERT INTO probe_{table} ({}) VALUES ({})",
            columns.join(", "),
            values.join(", ")
        ))
    }

    /// Creates `probe_<table>`: a temporary copy of the table with its `CHECK` constraints, no
    /// `NOT NULL` rules and no defaults. A row that sets only the column under test can then
    /// fail only that column's constraint. Rows vanish at the end of each statement, and the
    /// real tables are never touched.
    async fn create_probe(conn: &mut PgConnection, table: &str) {
        let statements = [
            format!(
                "CREATE TEMP TABLE probe_{table} (LIKE {table} INCLUDING CONSTRAINTS) \
                 ON COMMIT DELETE ROWS"
            ),
            format!(
                "DO $$ DECLARE c name; BEGIN \
                 FOR c IN SELECT attname FROM pg_attribute \
                          WHERE attrelid = 'pg_temp.probe_{table}'::regclass \
                            AND attnum > 0 AND NOT attisdropped AND attnotnull \
                 LOOP \
                   EXECUTE format('ALTER TABLE pg_temp.probe_{table} ALTER COLUMN %I DROP NOT NULL', c); \
                 END LOOP; END $$"
            ),
        ];
        for sql in statements {
            sqlx::query(AssertSqlSafe(sql))
                .execute(&mut *conn)
                .await
                .unwrap_or_else(|e| panic!("probe setup for {table} failed: {e}"));
        }
    }

    /// 05 section 1.1: the code module and the schema `CHECK` constraints agree. Every code of
    /// every closed list is accepted by every column that uses the list, and a made-up code is
    /// rejected by the constraint itself (not by some other error).
    #[sqlx::test]
    async fn every_option_code_is_accepted_by_its_check_constraint(pool: PgPool) {
        // Temporary tables live in one session, so keep a single connection.
        let mut conn = pool.acquire().await.expect("connection");

        let tables: BTreeSet<&str> = LIST_COLUMNS.iter().map(|(_, table, _)| *table).collect();
        for table in tables {
            create_probe(&mut conn, table).await;
        }

        for &(list, table, columns) in LIST_COLUMNS {
            let rows = super::list(list).expect("mapped list exists");
            for &column in columns {
                for row in rows {
                    sqlx::query(probe_insert(table, column, row.code))
                        .bind(row.code)
                        .execute(&mut *conn)
                        .await
                        .unwrap_or_else(|e| {
                            panic!("{table}.{column} rejects {list} code {:?}: {e}", row.code)
                        });
                }

                let error = sqlx::query(probe_insert(table, column, MADE_UP_CODE))
                    .bind(MADE_UP_CODE)
                    .execute(&mut *conn)
                    .await
                    .expect_err(&format!("{table}.{column} accepts a made-up {list} code"));
                let sqlstate = error
                    .as_database_error()
                    .and_then(DatabaseError::code)
                    .map(Cow::into_owned);
                assert_eq!(
                    sqlstate.as_deref(),
                    Some(CHECK_VIOLATION),
                    "{table}.{column}: made-up code failed for another reason: {error}"
                );
            }
        }
    }

    async fn count(pool: &PgPool, sql: impl SqlSafeStr) -> i64 {
        sqlx::query_scalar(sql)
            .fetch_one(pool)
            .await
            .expect("count query")
    }

    /// 05 sections 3 to 11 and 12: the seed migrations hold the rows of the spec tables.
    #[sqlx::test]
    async fn seeded_tables_hold_the_rows_of_the_spec(pool: PgPool) {
        let expected = [
            ("religions", 6),
            ("sects", 14),
            ("languages", 29),
            ("education_levels", 10),
            ("education_fields", 27),
            ("profession_categories", 39),
            ("income_bands", 56),
            ("hobbies", 42),
        ];
        for (table, rows) in expected {
            let actual = count(
                &pool,
                AssertSqlSafe(format!("SELECT count(*) FROM {table}")),
            )
            .await;
            assert_eq!(actual, rows, "{table}");
        }

        // 05 section 5.2 lists 69 top-level castes; section 5.3 lists 253 sub-castes.
        let top = count(
            &pool,
            "SELECT count(*) FROM castes WHERE parent_code IS NULL",
        )
        .await;
        assert_eq!(top, 69, "top-level castes");
        let sub = count(
            &pool,
            "SELECT count(*) FROM castes WHERE parent_code IS NOT NULL",
        )
        .await;
        assert_eq!(sub, 253, "sub-castes");

        let per_parent: Vec<(String, i64)> = sqlx::query_as(
            "SELECT parent_code, count(*) FROM castes \
             WHERE parent_code IS NOT NULL GROUP BY parent_code ORDER BY parent_code",
        )
        .fetch_all(&pool)
        .await
        .expect("sub-caste counts");
        let expected_per_parent: Vec<(String, i64)> = [
            ("arain", 6),
            ("awan", 1),
            ("baloch", 39),
            ("bohra", 2),
            ("gujjar", 9),
            ("jutt", 36),
            ("kashmiri", 11),
            ("khoja", 2),
            ("memon", 7),
            ("mughal", 6),
            ("pathan", 39),
            ("qureshi", 8),
            ("rajput", 30),
            ("sheikh", 11),
            ("sindhi", 27),
            ("syed", 19),
        ]
        .into_iter()
        .map(|(parent, n)| (parent.to_owned(), n))
        .collect();
        assert_eq!(per_parent, expected_per_parent, "sub-castes per parent");

        // 05 section 10.1: seven bands per currency, ranks 1 to 7, eight currencies.
        let currencies: Vec<(String, i64, i16, i16)> = sqlx::query_as(
            "SELECT currency_code, count(*), min(rank), max(rank) FROM income_bands \
             GROUP BY currency_code ORDER BY currency_code",
        )
        .fetch_all(&pool)
        .await
        .expect("income band counts");
        assert_eq!(currencies.len(), 8, "currencies");
        for (currency, bands, lowest, highest) in currencies {
            assert_eq!((bands, lowest, highest), (7, 1, 7), "{currency} bands");
        }

        // 05 section 12: geography is seeded, Pakistan first, Lahore findable.
        assert!(
            count(&pool, "SELECT count(*) FROM countries").await > 0,
            "countries"
        );
        assert!(
            count(&pool, "SELECT count(*) FROM regions").await > 0,
            "regions"
        );
        assert!(
            count(&pool, "SELECT count(*) FROM cities").await > 0,
            "cities"
        );

        let pakistan: (String, Option<String>, i32) =
            sqlx::query_as("SELECT name, dial_code, sort_order FROM countries WHERE code = 'PK'")
                .fetch_one(&pool)
                .await
                .expect("Pakistan is seeded");
        assert_eq!(
            pakistan,
            ("Pakistan".to_owned(), Some("+92".to_owned()), 10)
        );

        let lahore: Vec<(String, bool)> = sqlx::query_as(
            "SELECT r.name, c.is_major FROM cities c \
             JOIN regions r ON r.id = c.region_id \
             WHERE c.country_code = 'PK' AND c.name = 'Lahore'",
        )
        .fetch_all(&pool)
        .await
        .expect("Lahore lookup");
        assert_eq!(lahore, [("Punjab".to_owned(), true)], "Lahore");
    }

    /// 04 section 3 and 05 section 1.2: codes follow the code rule, sub-castes have exactly one
    /// parent level, and rows named "Other" are the only ones sorted last.
    #[sqlx::test]
    async fn seeded_codes_are_well_formed_and_castes_have_two_levels(pool: PgPool) {
        let malformed = count(
            &pool,
            "SELECT count(*) FROM ( \
                 SELECT code FROM religions UNION ALL SELECT code FROM sects \
                 UNION ALL SELECT code FROM castes UNION ALL SELECT code FROM languages \
                 UNION ALL SELECT code FROM education_levels \
                 UNION ALL SELECT code FROM education_fields \
                 UNION ALL SELECT code FROM profession_categories \
                 UNION ALL SELECT code FROM income_bands UNION ALL SELECT code FROM hobbies \
             ) all_codes WHERE code !~ '^[a-z][a-z0-9_]*$'",
        )
        .await;
        assert_eq!(malformed, 0, "codes that break ^[a-z][a-z0-9_]*$");

        let three_levels = count(
            &pool,
            "SELECT count(*) FROM castes child \
             JOIN castes parent ON parent.code = child.parent_code \
             WHERE parent.parent_code IS NOT NULL",
        )
        .await;
        assert_eq!(
            three_levels, 0,
            "sub-castes whose parent is itself a sub-caste"
        );

        let wrong_prefix = count(
            &pool,
            "SELECT count(*) FROM castes WHERE parent_code IS NOT NULL \
             AND left(code, char_length(parent_code) + 1) <> parent_code || '_'",
        )
        .await;
        assert_eq!(
            wrong_prefix, 0,
            "sub-caste codes that do not start with the parent code"
        );

        let misplaced_other = count(
            &pool,
            "SELECT count(*) FROM ( \
                 SELECT name, sort_order FROM religions UNION ALL SELECT name, sort_order FROM sects \
                 UNION ALL SELECT name, sort_order FROM languages \
                 UNION ALL SELECT name, sort_order FROM education_fields \
                 UNION ALL SELECT name, sort_order FROM profession_categories \
             ) lookup WHERE (name = 'Other') <> (sort_order = 9990)",
        )
        .await;
        assert_eq!(
            misplaced_other, 0,
            "'Other' rows must be the rows with sort_order 9990"
        );
    }
}
