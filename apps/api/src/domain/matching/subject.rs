//! The matchable view of a profile (10 section 3.2) and the place lookup used by the location
//! dimension and the `LookingFor` lines (10 sections 4.5 and 11.1).

use std::collections::{BTreeSet, HashMap};

use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::domain::options::{
    Beard, ChildrenStatus, EmploymentType, FamilyType, FamilyValues, FieldVisibility, Gender,
    Hijab, LivingArrangement, MaritalStatus, MarriageTimeline, PrayerFrequency, Religiosity,
    Relocation, Smoking, WorkAfterMarriage,
};
use crate::domain::preferences::Preferences;
use crate::domain::time::age_on;

/// The facts of one profile as loaded from `profiles`, `profile_family`, `profile_privacy`,
/// `profile_languages` and `profile_hobbies`, before the matchable rule of 09 section 5.4 is
/// applied. [`Subject::from_rows`] turns it into a [`Subject`].
///
/// Columns that `profiles_required_when_submitted` (04 section 5.1) guarantees on every
/// non-draft profile are not optional here; only non-draft profiles are ever matched.
/// Values that come from reference tables are passed already resolved (ranks).
#[derive(Debug, Clone)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors boolean columns of profiles and profile_privacy"
)]
pub struct SubjectRows {
    /// `profiles.id`. Final tie-break of the ranking order (10 section 6).
    pub id: Uuid,
    /// `profiles.gender`. Chooses the appearance preference (`hijab_types` or `beard_types`)
    /// and orients the age gap (10 sections 4.4 and 5.2).
    pub gender: Gender,
    /// `profiles.date_of_birth`. Only the age derived from it is matched (10 section 4.3 rule 5).
    pub date_of_birth: Date,
    /// `profiles.height_cm`.
    pub height_cm: i16,
    /// `profiles.marital_status`.
    pub marital_status: MaritalStatus,
    /// `profiles.children_status`. `None` counts as `none` for a `never_married` profile and is
    /// unknown otherwise (10 section 4.4, `children`).
    pub children_status: Option<ChildrenStatus>,
    /// `profiles.religion_code`.
    pub religion_code: String,
    /// `profiles.sect_code`.
    pub sect_code: Option<String>,
    /// `profiles.caste_code`: always a top-level caste (07 section 5.3). `None` when the profile
    /// states no caste or only a typed `caste_other`.
    pub caste_code: Option<String>,
    /// `profile_privacy.caste_visibility`.
    pub caste_visibility: FieldVisibility,
    /// `profiles.mother_tongue_code`.
    pub mother_tongue_code: String,
    /// `profile_languages.language_code` rows: languages spoken besides the mother tongue.
    pub language_codes: Vec<String>,
    /// `profiles.country_code`.
    pub country_code: String,
    /// `profiles.region_id`.
    pub region_id: Option<i32>,
    /// `profiles.city_id`. `None` when the profile uses `city_other`.
    pub city_id: Option<i32>,
    /// `profiles.origin_city_id`: the family's home town.
    pub origin_city_id: Option<i32>,
    /// `profiles.relocation`.
    pub relocation: Option<Relocation>,
    /// `education_levels.rank` of `profiles.education_level_code`, from the reference cache.
    /// `None` only if the code could not be resolved; it is then unknown.
    pub education_rank: Option<i16>,
    /// `profiles.employment_type`.
    pub employment_type: EmploymentType,
    /// `profiles.profession_code`.
    pub profession_code: Option<String>,
    /// `income_bands.rank` of `profiles.income_band_code`, from the reference cache. Ranks are
    /// comparable across currencies (05 section 10.1).
    pub income_rank: Option<i16>,
    /// `profile_privacy.income_visibility`.
    pub income_visibility: FieldVisibility,
    /// `profiles.religiosity`.
    pub religiosity: Option<Religiosity>,
    /// `profiles.prayer_frequency`.
    pub prayer_frequency: Option<PrayerFrequency>,
    /// `profiles.hijab` (women only).
    pub hijab: Option<Hijab>,
    /// `profiles.beard` (men only).
    pub beard: Option<Beard>,
    /// `profiles.smoking`.
    pub smoking: Option<Smoking>,
    /// `profiles.living_arrangement`.
    pub living_arrangement: Option<LivingArrangement>,
    /// `profiles.work_after_marriage`.
    pub work_after_marriage: Option<WorkAfterMarriage>,
    /// `profiles.marriage_timeline`.
    pub marriage_timeline: Option<MarriageTimeline>,
    /// `profile_family.family_values`. `None` also when there is no `profile_family` row.
    pub family_values: Option<FamilyValues>,
    /// `profile_family.family_type`. `None` also when there is no `profile_family` row.
    pub family_type: Option<FamilyType>,
    /// `profile_privacy.family_visibility`.
    pub family_visibility: FieldVisibility,
    /// `profile_hobbies.hobby_code` rows.
    pub hobby_codes: Vec<String>,
    /// `profiles.completeness`, 0 to 100 (ranking `quality`, 10 section 6).
    pub completeness: i16,
    /// `profiles.has_approved_photo` (ranking `quality`).
    pub has_approved_photo: bool,
    /// `profiles.is_phone_verified` (ranking `quality`).
    pub is_phone_verified: bool,
    /// `profiles.is_photo_verified` (ranking `quality`, reason `verified`).
    pub is_photo_verified: bool,
    /// `profiles.is_id_verified` (ranking `quality`, reason `verified`).
    pub is_id_verified: bool,
    /// `profiles.last_active_at` (ranking `activity`, tie-break, reason `recently_active`).
    pub last_active_at: Option<OffsetDateTime>,
    /// `profiles.first_activated_at` (ranking `newness`, reason `new_member`).
    pub first_activated_at: Option<OffsetDateTime>,
    /// `profile_privacy.show_last_active` (reason `recently_active` needs it on both sides).
    pub show_last_active: bool,
}

/// The matchable view of a profile: every value that 10 sections 4 to 7 read, with the groups
/// the owner hides from members (caste, income, family) already replaced by `None`
/// (09 section 5.4, 10 section 3.2).
///
/// The only constructor is [`Subject::from_rows`], so the privacy rule cannot be forgotten.
/// The same type describes a candidate and a viewer: both directions of a pair are scored
/// against it.
#[derive(Debug, Clone)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors boolean columns of profiles and profile_privacy"
)]
pub struct Subject {
    /// `profiles.id`.
    pub id: Uuid,
    /// `profiles.gender`.
    pub gender: Gender,
    /// Whole years on the day the subject was built, in `Asia/Karachi` (10 section 4.3 rule 5).
    pub age: i32,
    /// `profiles.height_cm`.
    pub height_cm: i16,
    /// `profiles.marital_status`.
    pub marital_status: MaritalStatus,
    /// `profiles.children_status` as stored. Use [`Subject::children`] for the matched value.
    pub children_status: Option<ChildrenStatus>,
    /// `profiles.religion_code`.
    pub religion_code: String,
    /// `profiles.sect_code`.
    pub sect_code: Option<String>,
    /// Matchable top-level `caste_code`: `None` when not stated, typed as `caste_other`, or
    /// hidden from members.
    pub caste_code: Option<String>,
    /// `profiles.mother_tongue_code`.
    pub mother_tongue_code: String,
    /// Other languages spoken, sorted and without duplicates.
    pub language_codes: Vec<String>,
    /// `profiles.country_code`. Never unknown (10 section 4.5 note 3).
    pub country_code: String,
    /// `profiles.region_id`.
    pub region_id: Option<i32>,
    /// `profiles.city_id`.
    pub city_id: Option<i32>,
    /// `profiles.origin_city_id`.
    pub origin_city_id: Option<i32>,
    /// `profiles.relocation`.
    pub relocation: Option<Relocation>,
    /// `education_levels.rank` of the profile's level.
    pub education_rank: Option<i16>,
    /// `profiles.employment_type`.
    pub employment_type: EmploymentType,
    /// `profiles.profession_code`.
    pub profession_code: Option<String>,
    /// Matchable `income_bands.rank`: `None` when not stated or hidden from members.
    pub income_rank: Option<i16>,
    /// `profiles.religiosity`.
    pub religiosity: Option<Religiosity>,
    /// `profiles.prayer_frequency`.
    pub prayer_frequency: Option<PrayerFrequency>,
    /// `profiles.hijab`.
    pub hijab: Option<Hijab>,
    /// `profiles.beard`.
    pub beard: Option<Beard>,
    /// `profiles.smoking`.
    pub smoking: Option<Smoking>,
    /// `profiles.living_arrangement`.
    pub living_arrangement: Option<LivingArrangement>,
    /// `profiles.work_after_marriage`.
    pub work_after_marriage: Option<WorkAfterMarriage>,
    /// `profiles.marriage_timeline`.
    pub marriage_timeline: Option<MarriageTimeline>,
    /// Matchable `profile_family.family_values`: `None` when not stated or hidden from members.
    pub family_values: Option<FamilyValues>,
    /// Matchable `profile_family.family_type`: `None` when not stated or hidden from members.
    pub family_type: Option<FamilyType>,
    /// Hobby codes, sorted and without duplicates.
    pub hobby_codes: Vec<String>,
    /// `profiles.completeness`.
    pub completeness: i16,
    /// `profiles.has_approved_photo`.
    pub has_approved_photo: bool,
    /// `profiles.is_phone_verified`.
    pub is_phone_verified: bool,
    /// `profiles.is_photo_verified`.
    pub is_photo_verified: bool,
    /// `profiles.is_id_verified`.
    pub is_id_verified: bool,
    /// `profiles.last_active_at`.
    pub last_active_at: Option<OffsetDateTime>,
    /// `profiles.first_activated_at`.
    pub first_activated_at: Option<OffsetDateTime>,
    /// `profile_privacy.show_last_active`.
    pub show_last_active: bool,
    /// Private, so that a `Subject` can only be built by [`Subject::from_rows`].
    _private: (),
}

impl Subject {
    /// Builds the matchable view (10 section 3.2). `today` is the current date in
    /// `Asia/Karachi` ([`crate::domain::time::karachi_date`]); use the same date for every
    /// subject of one scoring pass.
    ///
    /// A value in the `caste`, `income` or `family` group is kept only when the group's
    /// visibility is `members`; otherwise it becomes `None`, which every matching function
    /// treats as unknown (09 section 5.4).
    pub fn from_rows(rows: SubjectRows, today: Date) -> Self {
        let members = |visibility: FieldVisibility| visibility == FieldVisibility::Members;
        let caste_matchable = members(rows.caste_visibility);
        let income_matchable = members(rows.income_visibility);
        let family_matchable = members(rows.family_visibility);
        Self {
            id: rows.id,
            gender: rows.gender,
            age: age_on(rows.date_of_birth, today),
            height_cm: rows.height_cm,
            marital_status: rows.marital_status,
            children_status: rows.children_status,
            religion_code: rows.religion_code,
            sect_code: rows.sect_code,
            caste_code: rows.caste_code.filter(|_| caste_matchable),
            mother_tongue_code: rows.mother_tongue_code,
            language_codes: sorted_unique(rows.language_codes),
            country_code: rows.country_code,
            region_id: rows.region_id,
            city_id: rows.city_id,
            origin_city_id: rows.origin_city_id,
            relocation: rows.relocation,
            education_rank: rows.education_rank,
            employment_type: rows.employment_type,
            profession_code: rows.profession_code,
            income_rank: rows.income_rank.filter(|_| income_matchable),
            religiosity: rows.religiosity,
            prayer_frequency: rows.prayer_frequency,
            hijab: rows.hijab,
            beard: rows.beard,
            smoking: rows.smoking,
            living_arrangement: rows.living_arrangement,
            work_after_marriage: rows.work_after_marriage,
            marriage_timeline: rows.marriage_timeline,
            family_values: rows.family_values.filter(|_| family_matchable),
            family_type: rows.family_type.filter(|_| family_matchable),
            hobby_codes: sorted_unique(rows.hobby_codes),
            completeness: rows.completeness,
            has_approved_photo: rows.has_approved_photo,
            is_phone_verified: rows.is_phone_verified,
            is_photo_verified: rows.is_photo_verified,
            is_id_verified: rows.is_id_verified,
            last_active_at: rows.last_active_at,
            first_activated_at: rows.first_activated_at,
            show_last_active: rows.show_last_active,
            _private: (),
        }
    }

    /// The children status used by matching: a stored value, or `none` when the value is
    /// missing and the subject has never married. `None` means unknown (10 section 4.4).
    pub fn children(&self) -> Option<ChildrenStatus> {
        self.children_status.or_else(|| {
            (self.marital_status == MaritalStatus::NeverMarried).then_some(ChildrenStatus::None)
        })
    }

    /// Whether the subject speaks `code` as an additional language (`profile_languages`).
    pub fn speaks(&self, code: &str) -> bool {
        self.language_codes.iter().any(|language| language == code)
    }
}

fn sorted_unique(mut codes: Vec<String>) -> Vec<String> {
    codes.sort_unstable();
    codes.dedup();
    codes
}

/// A `cities` row as far as matching needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct City {
    /// Display name, used in `LookingFor` location lines (10 section 11.1).
    pub name: String,
    /// `cities.region_id`, `None` for a city without a region.
    pub region_id: Option<i32>,
    /// `cities.country_code`.
    pub country_code: String,
}

/// A `regions` row as far as matching needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Region {
    /// Display name, used in `LookingFor` location lines (10 section 11.1).
    pub name: String,
    /// `regions.country_code`.
    pub country_code: String,
}

/// The cities and regions listed in the preferences of one scoring pass, with their parents
/// (10 section 4.5 note 1). Load them once per pass: collect the ids with [`GeoIds::collect`],
/// query `cities` and `regions` for those ids, and insert the rows.
///
/// An id missing from the lookup simply contributes no parent: it cannot cause a panic.
#[derive(Debug, Clone, Default)]
pub struct Geo {
    cities: HashMap<i32, City>,
    regions: HashMap<i32, Region>,
}

impl Geo {
    /// An empty lookup.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds or replaces a city.
    pub fn insert_city(&mut self, id: i32, city: City) {
        self.cities.insert(id, city);
    }

    /// Adds or replaces a region.
    pub fn insert_region(&mut self, id: i32, region: Region) {
        self.regions.insert(id, region);
    }

    /// The city with this id, if loaded.
    pub fn city(&self, id: i32) -> Option<&City> {
        self.cities.get(&id)
    }

    /// The region with this id, if loaded.
    pub fn region(&self, id: i32) -> Option<&Region> {
        self.regions.get(&id)
    }

    /// `regions_of(city_ids)` contains `region_id` (10 section 4.5).
    pub(crate) fn region_of_any_city(&self, city_ids: &[i32], region_id: i32) -> bool {
        city_ids
            .iter()
            .filter_map(|id| self.city(*id))
            .any(|city| city.region_id == Some(region_id))
    }

    /// `countries_of(city_ids)` or `countries_of(region_ids)` contains `country_code`
    /// (10 section 4.5).
    pub(crate) fn country_of_any(
        &self,
        city_ids: &[i32],
        region_ids: &[i32],
        country: &str,
    ) -> bool {
        city_ids
            .iter()
            .filter_map(|id| self.city(*id))
            .any(|city| city.country_code == country)
            || region_ids
                .iter()
                .filter_map(|id| self.region(*id))
                .any(|region| region.country_code == country)
    }
}

/// The city and region ids that a scoring pass must load into [`Geo`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GeoIds {
    /// Sorted, without duplicates.
    pub cities: Vec<i32>,
    /// Sorted, without duplicates.
    pub regions: Vec<i32>,
}

impl GeoIds {
    /// Every `city_ids` and `region_ids` entry of the given preferences: the viewer's and the
    /// candidates' (10 section 4.5 note 1).
    pub fn collect<'a>(preferences: impl IntoIterator<Item = &'a Preferences>) -> Self {
        let mut cities = BTreeSet::new();
        let mut regions = BTreeSet::new();
        for prefs in preferences {
            cities.extend(prefs.city_ids.iter().copied());
            regions.extend(prefs.region_ids.iter().copied());
        }
        Self {
            cities: cities.into_iter().collect(),
            regions: regions.into_iter().collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use time::macros::date;

    use super::*;
    use crate::domain::matching::testkit::{self, PUNJAB};

    #[test]
    fn hidden_groups_become_unknown() {
        let mut rows = testkit::woman();
        rows.caste_code = Some("rajput".into());
        rows.income_rank = Some(5);
        rows.income_visibility = FieldVisibility::Members;
        rows.family_values = Some(FamilyValues::Traditional);
        rows.family_type = Some(FamilyType::Joint);

        let visible = Subject::from_rows(rows.clone(), testkit::TODAY);
        assert_eq!(visible.caste_code.as_deref(), Some("rajput"));
        assert_eq!(visible.income_rank, Some(5));
        assert_eq!(visible.family_values, Some(FamilyValues::Traditional));
        assert_eq!(visible.family_type, Some(FamilyType::Joint));

        rows.caste_visibility = FieldVisibility::Connections;
        rows.income_visibility = FieldVisibility::Nobody;
        rows.family_visibility = FieldVisibility::Connections;
        let hidden = Subject::from_rows(rows, testkit::TODAY);
        assert_eq!(hidden.caste_code, None);
        assert_eq!(hidden.income_rank, None);
        assert_eq!(hidden.family_values, None);
        assert_eq!(hidden.family_type, None);
    }

    #[test]
    fn age_is_whole_years_on_the_given_day() {
        let mut rows = testkit::man();
        rows.date_of_birth = date!(1997 - 11 - 21);
        assert_eq!(
            Subject::from_rows(rows.clone(), date!(2026 - 11 - 20)).age,
            28
        );
        assert_eq!(Subject::from_rows(rows, date!(2026 - 11 - 21)).age, 29);
    }

    #[test]
    fn children_null_counts_as_none_only_when_never_married() {
        let mut rows = testkit::woman();
        rows.children_status = None;
        rows.marital_status = MaritalStatus::NeverMarried;
        assert_eq!(
            Subject::from_rows(rows.clone(), testkit::TODAY).children(),
            Some(ChildrenStatus::None)
        );
        rows.marital_status = MaritalStatus::Divorced;
        assert_eq!(Subject::from_rows(rows, testkit::TODAY).children(), None);
    }

    #[test]
    fn hobbies_and_languages_are_deduplicated() {
        let mut rows = testkit::man();
        rows.hobby_codes = vec!["travel".into(), "cricket".into(), "travel".into()];
        rows.language_codes = vec!["urdu".into(), "english".into(), "urdu".into()];
        let subject = Subject::from_rows(rows, testkit::TODAY);
        assert_eq!(subject.hobby_codes, ["cricket", "travel"]);
        assert_eq!(subject.language_codes, ["english", "urdu"]);
        assert!(subject.speaks("urdu"));
        assert!(!subject.speaks("sindhi"));
    }

    #[test]
    fn geo_ids_collects_every_listed_place_once() {
        let mut a = testkit::no_preferences();
        a.city_ids = vec![11, 10];
        a.region_ids = vec![PUNJAB];
        let mut b = testkit::no_preferences();
        b.city_ids = vec![10, 20];
        let ids = GeoIds::collect([&a, &b]);
        assert_eq!(ids.cities, [10, 11, 20]);
        assert_eq!(ids.regions, [PUNJAB]);
    }

    #[test]
    fn unknown_place_ids_have_no_parents() {
        let geo = testkit::geo();
        assert!(!geo.region_of_any_city(&[999], PUNJAB));
        assert!(!geo.country_of_any(&[999], &[999], "PK"));
    }
}
