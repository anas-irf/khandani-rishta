-- 0004_profiles.sql
-- Generated from specs/04-database-schema.md. Never edit after merge; add a new migration.

CREATE TABLE profiles (
    id                       uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id                  uuid NOT NULL UNIQUE REFERENCES users (id),
    public_code              text NOT NULL UNIQUE CHECK (public_code ~ '^KR[0-9A-HJKMNP-TV-Z]{8}$'),

    -- lifecycle
    status                   text NOT NULL DEFAULT 'draft' CHECK (status IN (
                                 'draft', 'pending_review', 'changes_requested', 'active',
                                 'paused', 'closed', 'suspended', 'deleted')),
    status_reason            text,                              -- moderator note shown to the owner
    onboarding_step          text NOT NULL DEFAULT 'account_for' CHECK (onboarding_step IN (
                                 'account_for', 'basics', 'community', 'location', 'education_career',
                                 'family', 'lifestyle', 'photos', 'preferences', 'identity', 'review', 'done')),
    onboarding_completed_at  timestamptz,
    first_activated_at       timestamptz,                       -- first time status became 'active'
    paused_at                timestamptz,
    closed_at                timestamptz,
    closed_reason            text CHECK (closed_reason IN (
                                 'found_match_here', 'found_match_elsewhere', 'taking_a_break', 'other')),

    -- who manages the profile
    managed_by               text CHECK (managed_by IN ('self', 'parent', 'sibling', 'relative', 'friend')),
    manager_name             text CHECK (char_length(manager_name) <= 80),

    -- basics
    first_name               text CHECK (char_length(first_name) BETWEEN 2 AND 40),
    last_name                text CHECK (char_length(last_name) BETWEEN 2 AND 40),
    gender                   text CHECK (gender IN ('male', 'female')),
    date_of_birth            date CHECK (date_of_birth > DATE '1930-01-01'),
    marital_status           text CHECK (marital_status IN (
                                 'never_married', 'divorced', 'widowed', 'separated',
                                 'nikah_ended_before_rukhsati', 'married')),
    children_status          text CHECK (children_status IN ('none', 'living_with_me', 'not_living_with_me')),
    children_count           smallint CHECK (children_count BETWEEN 0 AND 15),
    current_wives_count      smallint CHECK (current_wives_count BETWEEN 1 AND 3),   -- only when marital_status = 'married'

    -- appearance and health
    height_cm                smallint CHECK (height_cm BETWEEN 122 AND 213),
    weight_kg                smallint CHECK (weight_kg BETWEEN 30 AND 200),
    complexion               text CHECK (complexion IN ('very_fair', 'fair', 'wheatish', 'brown', 'dark')),
    body_type                text CHECK (body_type IN ('slim', 'average', 'athletic', 'heavy')),
    blood_group              text CHECK (blood_group IN (
                                 'a_pos', 'a_neg', 'b_pos', 'b_neg', 'ab_pos', 'ab_neg', 'o_pos', 'o_neg')),
    disability               text CHECK (disability IN (
                                 'none', 'physical', 'visual', 'hearing', 'speech', 'chronic_illness', 'other')),
    disability_details       text CHECK (char_length(disability_details) <= 300),

    -- religion and community
    religion_code            text REFERENCES religions (code),
    sect_code                text REFERENCES sects (code),
    caste_code               text REFERENCES castes (code),
    sub_caste_code           text REFERENCES castes (code),
    caste_other              text CHECK (char_length(caste_other) BETWEEN 2 AND 60),
    sub_caste_other          text CHECK (char_length(sub_caste_other) BETWEEN 2 AND 60),
    mother_tongue_code       text REFERENCES languages (code),

    -- location
    nationality_code         text REFERENCES countries (code),
    country_code             text REFERENCES countries (code),
    region_id                integer REFERENCES regions (id),
    city_id                  integer REFERENCES cities (id),
    city_other               text CHECK (char_length(city_other) BETWEEN 2 AND 60),
    area                     text CHECK (char_length(area) <= 80),             -- neighbourhood or town
    residency_status         text CHECK (residency_status IN (
                                 'citizen', 'permanent_resident', 'work_visa', 'student_visa',
                                 'dependent_visa', 'visit_visa', 'other')),
    origin_city_id           integer REFERENCES cities (id),                   -- family's home town in Pakistan
    origin_other             text CHECK (char_length(origin_other) <= 60),
    relocation               text CHECK (relocation IN ('not_willing', 'within_country', 'abroad', 'anywhere')),

    -- education and career
    education_level_code     text REFERENCES education_levels (code),
    education_field_code     text REFERENCES education_fields (code),
    degree_title             text CHECK (char_length(degree_title) <= 80),
    institute_name           text CHECK (char_length(institute_name) <= 120),
    employment_type          text CHECK (employment_type IN (
                                 'private_job', 'government_job', 'armed_forces', 'business_owner',
                                 'self_employed', 'student', 'homemaker', 'not_working', 'retired')),
    profession_code          text REFERENCES profession_categories (code),
    job_title                text CHECK (char_length(job_title) <= 80),
    employer_name            text CHECK (char_length(employer_name) <= 120),
    income_band_code         text REFERENCES income_bands (code),

    -- religious practice and lifestyle
    religiosity              text CHECK (religiosity IN (
                                 'very_practising', 'practising', 'moderately_practising', 'not_practising')),
    prayer_frequency         text CHECK (prayer_frequency IN (
                                 'five_times', 'most_prayers', 'sometimes', 'jummah_only', 'rarely')),
    hijab                    text CHECK (hijab IN ('niqab', 'hijab', 'dupatta', 'occasionally', 'none')),
    beard                    text CHECK (beard IN ('full', 'trimmed', 'none')),
    religious_education      text CHECK (religious_education IN ('none', 'nazra', 'hafiz', 'alim')),
    smoking                  text CHECK (smoking IN ('no', 'occasionally', 'yes')),
    living_arrangement       text CHECK (living_arrangement IN ('with_family', 'separate', 'flexible')),
    work_after_marriage      text CHECK (work_after_marriage IN ('yes', 'no', 'flexible')),
    marriage_timeline        text CHECK (marriage_timeline IN (
                                 'within_6_months', 'within_1_year', 'within_2_years', 'not_decided')),
    jahez_stance             text CHECK (jahez_stance IN ('against', 'no_demand', 'family_custom')),

    -- free text (moderated, see 13-safety-and-moderation.md)
    about_me                 text CHECK (char_length(about_me) <= 1500),
    about_me_status          text NOT NULL DEFAULT 'approved'
                             CHECK (about_me_status IN ('approved', 'pending', 'rejected')),

    -- denormalised, maintained by the API
    completeness             smallint NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 100),
    has_approved_photo       boolean NOT NULL DEFAULT false,
    is_phone_verified        boolean NOT NULL DEFAULT false,
    is_photo_verified        boolean NOT NULL DEFAULT false,
    is_id_verified           boolean NOT NULL DEFAULT false,
    last_active_at           timestamptz,
    match_stale              boolean NOT NULL DEFAULT true,     -- recommendations must be recomputed
    match_refreshed_at       timestamptz,

    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT profiles_required_when_submitted CHECK (
        status IN ('draft', 'deleted')
        OR (
            managed_by IS NOT NULL
            AND first_name IS NOT NULL AND last_name IS NOT NULL
            AND gender IS NOT NULL AND date_of_birth IS NOT NULL
            AND marital_status IS NOT NULL AND height_cm IS NOT NULL
            AND religion_code IS NOT NULL AND mother_tongue_code IS NOT NULL
            AND country_code IS NOT NULL
            AND (city_id IS NOT NULL OR city_other IS NOT NULL)
            AND education_level_code IS NOT NULL AND employment_type IS NOT NULL
        )
    ),
    CONSTRAINT profiles_hijab_only_female CHECK (hijab IS NULL OR gender = 'female'),
    CONSTRAINT profiles_beard_only_male CHECK (beard IS NULL OR gender = 'male'),
    CONSTRAINT profiles_married_only_male CHECK (marital_status <> 'married' OR gender = 'male'),
    CONSTRAINT profiles_wives_count_when_married CHECK (
        (marital_status = 'married') = (current_wives_count IS NOT NULL)
        OR marital_status IS NULL
    ),
    CONSTRAINT profiles_children_consistent CHECK (
        children_status IS NULL
        OR (children_status = 'none' AND COALESCE(children_count, 0) = 0)
        OR (children_status <> 'none' AND children_count >= 1)
    ),
    CONSTRAINT profiles_caste_choice CHECK (caste_code IS NULL OR caste_other IS NULL),
    CONSTRAINT profiles_sub_caste_choice CHECK (sub_caste_code IS NULL OR sub_caste_other IS NULL)
);

-- Discovery: opposite gender, active, most recently active first.
CREATE INDEX profiles_discovery_idx ON profiles (gender, last_active_at DESC) WHERE status = 'active';
CREATE INDEX profiles_dob_idx ON profiles (gender, date_of_birth) WHERE status = 'active';
CREATE INDEX profiles_city_idx ON profiles (city_id) WHERE status = 'active';
CREATE INDEX profiles_country_region_idx ON profiles (country_code, region_id) WHERE status = 'active';
CREATE INDEX profiles_caste_idx ON profiles (caste_code) WHERE status = 'active';
CREATE INDEX profiles_new_idx ON profiles (gender, first_activated_at DESC) WHERE status = 'active';
CREATE INDEX profiles_review_idx ON profiles (updated_at) WHERE status = 'pending_review';
CREATE INDEX profiles_text_review_idx ON profiles (updated_at) WHERE about_me_status = 'pending';

CREATE TABLE profile_family (
    profile_id           uuid PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    father_status        text CHECK (father_status IN ('alive', 'deceased')),
    father_occupation    text CHECK (char_length(father_occupation) <= 80),
    mother_status        text CHECK (mother_status IN ('alive', 'deceased')),
    mother_occupation    text CHECK (char_length(mother_occupation) <= 80),
    brothers_count       smallint CHECK (brothers_count BETWEEN 0 AND 15),
    brothers_married     smallint CHECK (brothers_married BETWEEN 0 AND 15),
    sisters_count        smallint CHECK (sisters_count BETWEEN 0 AND 15),
    sisters_married      smallint CHECK (sisters_married BETWEEN 0 AND 15),
    family_type          text CHECK (family_type IN ('joint', 'nuclear')),
    family_class         text CHECK (family_class IN ('lower_middle', 'middle', 'upper_middle', 'affluent')),
    family_values        text CHECK (family_values IN ('religious', 'traditional', 'moderate', 'liberal')),
    family_country_code  text REFERENCES countries (code),      -- where the family lives, if not with the candidate
    family_city_id       integer REFERENCES cities (id),
    home_ownership       text CHECK (home_ownership IN ('owned', 'rented', 'ancestral', 'employer_provided', 'other')),
    home_type            text CHECK (home_type IN ('house', 'apartment', 'portion', 'other')),
    home_size_value      numeric(7, 2) CHECK (home_size_value > 0),
    home_size_unit       text CHECK (home_size_unit IN ('marla', 'kanal', 'sq_yard', 'sq_ft', 'sq_m')),
    about_family         text CHECK (char_length(about_family) <= 1000),
    about_family_status  text NOT NULL DEFAULT 'approved'
                         CHECK (about_family_status IN ('approved', 'pending', 'rejected')),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profile_family_brothers CHECK (brothers_married IS NULL OR brothers_married <= brothers_count),
    CONSTRAINT profile_family_sisters CHECK (sisters_married IS NULL OR sisters_married <= sisters_count),
    CONSTRAINT profile_family_home_size CHECK ((home_size_value IS NULL) = (home_size_unit IS NULL))
);

CREATE TABLE profile_contacts (
    profile_id           uuid PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    phone_e164           text CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    whatsapp_e164        text CHECK (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    contact_email        text CHECK (char_length(contact_email) <= 254),
    guardian_name        text CHECK (char_length(guardian_name) <= 80),
    guardian_relation    text CHECK (guardian_relation IN (
                             'father', 'mother', 'brother', 'sister', 'uncle', 'aunt', 'other')),
    guardian_phone_e164  text CHECK (guardian_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    preferred_contact    text NOT NULL DEFAULT 'self' CHECK (preferred_contact IN ('self', 'guardian')),
    best_time_to_call    text CHECK (char_length(best_time_to_call) <= 80),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profile_identity (
    profile_id         uuid PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    document_type      text NOT NULL CHECK (document_type IN ('cnic', 'nicop', 'poc', 'passport')),
    number_encrypted   bytea NOT NULL,                          -- 12-byte nonce || AES-256-GCM ciphertext || tag
    number_hash        bytea NOT NULL UNIQUE,                   -- HMAC-SHA256(pepper, namespace || ':' || normalised number), namespaces in 12 section 3
    number_last4       text NOT NULL CHECK (char_length(number_last4) = 4),
    status             text NOT NULL DEFAULT 'unverified'
                       CHECK (status IN ('unverified', 'pending', 'verified', 'rejected')),
    verified_at        timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profile_languages (
    profile_id     uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    language_code  text NOT NULL REFERENCES languages (code),
    PRIMARY KEY (profile_id, language_code)
);

CREATE TABLE profile_hobbies (
    profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    hobby_code  text NOT NULL REFERENCES hobbies (code),
    PRIMARY KEY (profile_id, hobby_code)
);

CREATE TABLE partner_preferences (
    profile_id                  uuid PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,

    age_min                     smallint NOT NULL DEFAULT 18 CHECK (age_min BETWEEN 18 AND 80),
    age_max                     smallint NOT NULL DEFAULT 80 CHECK (age_max BETWEEN 18 AND 80),
    age_importance              text NOT NULL DEFAULT 'high',

    height_min_cm               smallint CHECK (height_min_cm BETWEEN 122 AND 213),
    height_max_cm               smallint CHECK (height_max_cm BETWEEN 122 AND 213),
    height_importance           text NOT NULL DEFAULT 'low',

    marital_statuses            text[] NOT NULL DEFAULT '{}',   -- values of profiles.marital_status
    marital_status_importance   text NOT NULL DEFAULT 'high',

    children_acceptance         text NOT NULL DEFAULT 'any'
                                CHECK (children_acceptance IN ('any', 'not_living_with_partner', 'none')),
    children_importance         text NOT NULL DEFAULT 'medium',

    religion_codes              text[] NOT NULL DEFAULT '{}',
    religion_importance         text NOT NULL DEFAULT 'must',

    sect_codes                  text[] NOT NULL DEFAULT '{}',
    sect_importance             text NOT NULL DEFAULT 'medium',

    caste_codes                 text[] NOT NULL DEFAULT '{}',   -- top-level caste codes only
    caste_importance            text NOT NULL DEFAULT 'low',

    mother_tongue_codes         text[] NOT NULL DEFAULT '{}',
    mother_tongue_importance    text NOT NULL DEFAULT 'low',

    country_codes               text[] NOT NULL DEFAULT '{}',
    region_ids                  integer[] NOT NULL DEFAULT '{}',
    city_ids                    integer[] NOT NULL DEFAULT '{}',
    location_importance         text NOT NULL DEFAULT 'medium',

    education_min_rank          smallint,                       -- education_levels.rank
    education_importance        text NOT NULL DEFAULT 'medium',

    employment_types            text[] NOT NULL DEFAULT '{}',   -- values of profiles.employment_type
    profession_codes            text[] NOT NULL DEFAULT '{}',
    profession_importance       text NOT NULL DEFAULT 'low',

    income_min_rank             smallint,                       -- income_bands.rank
    income_importance           text NOT NULL DEFAULT 'low',

    religiosity_levels          text[] NOT NULL DEFAULT '{}',   -- values of profiles.religiosity
    religiosity_importance      text NOT NULL DEFAULT 'medium',

    hijab_types                 text[] NOT NULL DEFAULT '{}',   -- used when the candidate seeks a woman
    beard_types                 text[] NOT NULL DEFAULT '{}',   -- used when the candidate seeks a man
    appearance_importance       text NOT NULL DEFAULT 'low',

    family_values               text[] NOT NULL DEFAULT '{}',   -- values of profile_family.family_values
    family_types                text[] NOT NULL DEFAULT '{}',   -- values of profile_family.family_type
    family_importance           text NOT NULL DEFAULT 'low',

    living_arrangements         text[] NOT NULL DEFAULT '{}',   -- values of profiles.living_arrangement
    living_arrangement_importance text NOT NULL DEFAULT 'low',

    work_after_marriage_options text[] NOT NULL DEFAULT '{}',   -- values of profiles.work_after_marriage
    work_after_marriage_importance text NOT NULL DEFAULT 'low',

    smoking_options             text[] NOT NULL DEFAULT '{}',   -- values of profiles.smoking
    smoking_importance          text NOT NULL DEFAULT 'low',

    notes                       text CHECK (char_length(notes) <= 1000),   -- "what I am looking for", shown on the profile
    notes_status                text NOT NULL DEFAULT 'approved'
                                CHECK (notes_status IN ('approved', 'pending', 'rejected')),

    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT partner_preferences_age_range CHECK (age_min <= age_max),
    CONSTRAINT partner_preferences_height_range CHECK (
        height_min_cm IS NULL OR height_max_cm IS NULL OR height_min_cm <= height_max_cm),
    CONSTRAINT partner_preferences_importance CHECK (
        age_importance                 IN ('must', 'high', 'medium', 'low')
        AND height_importance          IN ('must', 'high', 'medium', 'low')
        AND marital_status_importance  IN ('must', 'high', 'medium', 'low')
        AND children_importance        IN ('must', 'high', 'medium', 'low')
        AND religion_importance        IN ('must', 'high', 'medium', 'low')
        AND sect_importance            IN ('must', 'high', 'medium', 'low')
        AND caste_importance           IN ('must', 'high', 'medium', 'low')
        AND mother_tongue_importance   IN ('must', 'high', 'medium', 'low')
        AND location_importance        IN ('must', 'high', 'medium', 'low')
        AND education_importance       IN ('must', 'high', 'medium', 'low')
        AND profession_importance      IN ('must', 'high', 'medium', 'low')
        AND income_importance          IN ('must', 'high', 'medium', 'low')
        AND religiosity_importance     IN ('must', 'high', 'medium', 'low')
        AND appearance_importance      IN ('must', 'high', 'medium', 'low')
        AND family_importance          IN ('must', 'high', 'medium', 'low')
        AND living_arrangement_importance  IN ('must', 'high', 'medium', 'low')
        AND work_after_marriage_importance IN ('must', 'high', 'medium', 'low')
        AND smoking_importance         IN ('must', 'high', 'medium', 'low')
    )
);

CREATE TABLE profile_privacy (
    profile_id                 uuid PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,

    discovery_visibility       text NOT NULL DEFAULT 'everyone'
                               CHECK (discovery_visibility IN ('everyone', 'preference_match', 'hidden')),
    interest_permission        text NOT NULL DEFAULT 'everyone'
                               CHECK (interest_permission IN ('everyone', 'verified_only', 'preference_match')),

    name_display               text NOT NULL DEFAULT 'first_name_last_initial'
                               CHECK (name_display IN (
                                   'full_name', 'first_name_last_initial', 'first_name_only', 'initials', 'code_only')),
    photo_visibility           text NOT NULL DEFAULT 'members'
                               CHECK (photo_visibility IN (
                                   'members', 'interests_and_connections', 'connections', 'approved_only')),

    caste_visibility           text NOT NULL DEFAULT 'members',
    income_visibility          text NOT NULL DEFAULT 'connections',
    family_visibility          text NOT NULL DEFAULT 'members',
    career_details_visibility  text NOT NULL DEFAULT 'connections',   -- job title, employer, institute
    home_visibility            text NOT NULL DEFAULT 'connections',   -- home ownership, type, size
    area_visibility            text NOT NULL DEFAULT 'connections',   -- neighbourhood (city is always visible)
    health_visibility          text NOT NULL DEFAULT 'connections',   -- disability, blood group

    show_last_active           boolean NOT NULL DEFAULT true,
    show_online_status         boolean NOT NULL DEFAULT true,
    record_my_visits           boolean NOT NULL DEFAULT true,   -- false: browse privately
    send_read_receipts         boolean NOT NULL DEFAULT true,
    allow_photo_requests       boolean NOT NULL DEFAULT true,

    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT profile_privacy_field_levels CHECK (
        caste_visibility               IN ('members', 'connections', 'nobody')
        AND income_visibility          IN ('members', 'connections', 'nobody')
        AND family_visibility          IN ('members', 'connections', 'nobody')
        AND career_details_visibility  IN ('members', 'connections', 'nobody')
        AND home_visibility            IN ('members', 'connections', 'nobody')
        AND area_visibility            IN ('members', 'connections', 'nobody')
        AND health_visibility          IN ('members', 'connections', 'nobody')
    )
);

-- Keep updated_at current on every update.
CREATE TRIGGER profiles_set_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER profile_family_set_updated_at
    BEFORE UPDATE ON profile_family
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER profile_contacts_set_updated_at
    BEFORE UPDATE ON profile_contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER profile_identity_set_updated_at
    BEFORE UPDATE ON profile_identity
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER partner_preferences_set_updated_at
    BEFORE UPDATE ON partner_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER profile_privacy_set_updated_at
    BEFORE UPDATE ON profile_privacy
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
