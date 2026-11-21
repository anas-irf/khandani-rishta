package com.khandanirishta.app.ui.feature.profilesections

import com.khandanirishta.app.R

/**
 * The messages of the profile section rules (07 section 16), by API field key and field code.
 * The same texts serve the client rules and the API's `validation_failed` answers; a field and
 * code that is not listed falls back to the generic text of the code (17 section 8.3).
 */
fun profileSectionMessage(
    field: String,
    code: String,
): Int? =
    when ("$field.$code") {
        "managed_by.required" -> {
            R.string.profile_sections_errors_managed_by_required
        }

        "manager_name.required" -> {
            R.string.profile_sections_errors_manager_name_required
        }

        "manager_name.too_short" -> {
            R.string.profile_sections_errors_manager_name_too_short
        }

        "manager_name.too_long" -> {
            R.string.profile_sections_errors_manager_name_too_long
        }

        "manager_name.invalid" -> {
            R.string.profile_sections_errors_manager_name_invalid
        }

        "consents.required" -> {
            R.string.profile_sections_errors_consents_required
        }

        "consent_age.required" -> {
            R.string.profile_sections_errors_consent_age_required
        }

        "consent_candidate.required" -> {
            R.string.profile_sections_errors_consent_candidate_required
        }

        "first_name.required" -> {
            R.string.profile_sections_errors_first_name_required
        }

        "first_name.too_short" -> {
            R.string.profile_sections_errors_first_name_too_short
        }

        "first_name.too_long" -> {
            R.string.profile_sections_errors_first_name_too_long
        }

        "first_name.invalid" -> {
            R.string.profile_sections_errors_first_name_invalid
        }

        "first_name.locked" -> {
            R.string.profile_sections_errors_first_name_locked
        }

        "last_name.required" -> {
            R.string.profile_sections_errors_last_name_required
        }

        "last_name.too_short" -> {
            R.string.profile_sections_errors_last_name_too_short
        }

        "last_name.too_long" -> {
            R.string.profile_sections_errors_last_name_too_long
        }

        "last_name.invalid" -> {
            R.string.profile_sections_errors_last_name_invalid
        }

        "last_name.locked" -> {
            R.string.profile_sections_errors_last_name_locked
        }

        "gender.required" -> {
            R.string.profile_sections_errors_gender_required
        }

        "gender.locked" -> {
            R.string.profile_sections_errors_gender_locked
        }

        "date_of_birth.required" -> {
            R.string.profile_sections_errors_date_of_birth_required
        }

        "date_of_birth.invalid" -> {
            R.string.profile_sections_errors_date_of_birth_invalid
        }

        "date_of_birth.too_young" -> {
            R.string.profile_sections_errors_date_of_birth_too_young
        }

        "date_of_birth.too_young_other" -> {
            R.string.profile_sections_errors_date_of_birth_too_young_other
        }

        "date_of_birth.out_of_range" -> {
            R.string.profile_sections_errors_date_of_birth_out_of_range
        }

        "date_of_birth.locked" -> {
            R.string.profile_sections_errors_date_of_birth_locked
        }

        "marital_status.required" -> {
            R.string.profile_sections_errors_marital_status_required
        }

        "marital_status.not_allowed" -> {
            R.string.profile_sections_errors_marital_status_not_allowed
        }

        "current_wives_count.required" -> {
            R.string.profile_sections_errors_current_wives_count_required
        }

        "current_wives_count.out_of_range" -> {
            R.string.profile_sections_errors_current_wives_count_out_of_range
        }

        "children_status.required" -> {
            R.string.profile_sections_errors_children_status_required
        }

        "children_count.required" -> {
            R.string.profile_sections_errors_children_count_required
        }

        "children_count.out_of_range" -> {
            R.string.profile_sections_errors_children_count_out_of_range
        }

        "height_cm.required" -> {
            R.string.profile_sections_errors_height_cm_required
        }

        "height_cm.out_of_range" -> {
            R.string.profile_sections_errors_height_cm_out_of_range
        }

        "religion_code.required" -> {
            R.string.profile_sections_errors_religion_code_required
        }

        "religion_code.unknown_code" -> {
            R.string.profile_sections_errors_religion_code_unknown_code
        }

        "sect_code.required" -> {
            R.string.profile_sections_errors_sect_code_required
        }

        "sect_code.mismatch" -> {
            R.string.profile_sections_errors_sect_code_mismatch
        }

        "sect_code.unknown_code" -> {
            R.string.profile_sections_errors_sect_code_unknown_code
        }

        "caste_code.unknown_code" -> {
            R.string.profile_sections_errors_caste_code_unknown_code
        }

        "caste_other.too_short" -> {
            R.string.profile_sections_errors_caste_other_too_short
        }

        "caste_other.too_long" -> {
            R.string.profile_sections_errors_caste_other_too_long
        }

        "caste_other.not_allowed" -> {
            R.string.profile_sections_errors_caste_other_not_allowed
        }

        "caste_other.contains_contact_info" -> {
            R.string.profile_sections_errors_caste_other_contains_contact_info
        }

        "caste_other.inappropriate" -> {
            R.string.profile_sections_errors_caste_other_inappropriate
        }

        "caste_other.invalid" -> {
            R.string.profile_sections_errors_caste_other_invalid
        }

        "sub_caste_code.mismatch" -> {
            R.string.profile_sections_errors_sub_caste_code_mismatch
        }

        "sub_caste_code.not_allowed" -> {
            R.string.profile_sections_errors_sub_caste_code_not_allowed
        }

        "sub_caste_code.unknown_code" -> {
            R.string.profile_sections_errors_sub_caste_code_unknown_code
        }

        "sub_caste_other.too_short" -> {
            R.string.profile_sections_errors_sub_caste_other_too_short
        }

        "sub_caste_other.too_long" -> {
            R.string.profile_sections_errors_sub_caste_other_too_long
        }

        "sub_caste_other.not_allowed" -> {
            R.string.profile_sections_errors_sub_caste_other_not_allowed
        }

        "sub_caste_other.contains_contact_info" -> {
            R.string.profile_sections_errors_sub_caste_other_contains_contact_info
        }

        "sub_caste_other.inappropriate" -> {
            R.string.profile_sections_errors_sub_caste_other_inappropriate
        }

        "sub_caste_other.invalid" -> {
            R.string.profile_sections_errors_sub_caste_other_invalid
        }

        "mother_tongue_code.required" -> {
            R.string.profile_sections_errors_mother_tongue_code_required
        }

        "mother_tongue_code.unknown_code" -> {
            R.string.profile_sections_errors_mother_tongue_code_unknown_code
        }

        "language_codes.too_long" -> {
            R.string.profile_sections_errors_language_codes_too_long
        }

        "language_codes.unknown_code" -> {
            R.string.profile_sections_errors_language_codes_unknown_code
        }

        "country_code.required" -> {
            R.string.profile_sections_errors_country_code_required
        }

        "country_code.unknown_code" -> {
            R.string.profile_sections_errors_country_code_unknown_code
        }

        "city_id.required" -> {
            R.string.profile_sections_errors_city_id_required
        }

        "city_id.mismatch" -> {
            R.string.profile_sections_errors_city_id_mismatch
        }

        "city_other.too_short" -> {
            R.string.profile_sections_errors_city_other_too_short
        }

        "city_other.too_long" -> {
            R.string.profile_sections_errors_city_other_too_long
        }

        "city_other.not_allowed" -> {
            R.string.profile_sections_errors_city_other_not_allowed
        }

        "city_other.contains_contact_info" -> {
            R.string.profile_sections_errors_city_other_contains_contact_info
        }

        "city_other.inappropriate" -> {
            R.string.profile_sections_errors_city_other_inappropriate
        }

        "city_other.invalid" -> {
            R.string.profile_sections_errors_city_other_invalid
        }

        "region_id.required" -> {
            R.string.profile_sections_errors_region_id_required
        }

        "region_id.mismatch" -> {
            R.string.profile_sections_errors_region_id_mismatch
        }

        "area.too_long" -> {
            R.string.profile_sections_errors_area_too_long
        }

        "area.contains_contact_info" -> {
            R.string.profile_sections_errors_area_contains_contact_info
        }

        "area.inappropriate" -> {
            R.string.profile_sections_errors_area_inappropriate
        }

        "area.invalid" -> {
            R.string.profile_sections_errors_area_invalid
        }

        "residency_status.required" -> {
            R.string.profile_sections_errors_residency_status_required
        }

        "origin_city_id.mismatch" -> {
            R.string.profile_sections_errors_origin_city_id_mismatch
        }

        "origin_other.too_long" -> {
            R.string.profile_sections_errors_origin_other_too_long
        }

        "origin_other.contains_contact_info" -> {
            R.string.profile_sections_errors_origin_other_contains_contact_info
        }

        "origin_other.inappropriate" -> {
            R.string.profile_sections_errors_origin_other_inappropriate
        }

        "origin_other.invalid" -> {
            R.string.profile_sections_errors_origin_other_invalid
        }

        "education_level_code.required" -> {
            R.string.profile_sections_errors_education_level_code_required
        }

        "employment_type.required" -> {
            R.string.profile_sections_errors_employment_type_required
        }

        "degree_title.too_long" -> {
            R.string.profile_sections_errors_degree_title_too_long
        }

        "degree_title.contains_contact_info" -> {
            R.string.profile_sections_errors_degree_title_contains_contact_info
        }

        "degree_title.inappropriate" -> {
            R.string.profile_sections_errors_degree_title_inappropriate
        }

        "job_title.too_long" -> {
            R.string.profile_sections_errors_job_title_too_long
        }

        "job_title.contains_contact_info" -> {
            R.string.profile_sections_errors_job_title_contains_contact_info
        }

        "job_title.inappropriate" -> {
            R.string.profile_sections_errors_job_title_inappropriate
        }

        "institute_name.too_long" -> {
            R.string.profile_sections_errors_institute_name_too_long
        }

        "institute_name.contains_contact_info" -> {
            R.string.profile_sections_errors_institute_name_contains_contact_info
        }

        "institute_name.inappropriate" -> {
            R.string.profile_sections_errors_institute_name_inappropriate
        }

        "employer_name.too_long" -> {
            R.string.profile_sections_errors_employer_name_too_long
        }

        "employer_name.contains_contact_info" -> {
            R.string.profile_sections_errors_employer_name_contains_contact_info
        }

        "employer_name.inappropriate" -> {
            R.string.profile_sections_errors_employer_name_inappropriate
        }

        "brothers_married.out_of_range" -> {
            R.string.profile_sections_errors_brothers_married_out_of_range
        }

        "sisters_married.out_of_range" -> {
            R.string.profile_sections_errors_sisters_married_out_of_range
        }

        "brothers_count.out_of_range" -> {
            R.string.profile_sections_errors_brothers_count_out_of_range
        }

        "brothers_count.required" -> {
            R.string.profile_sections_errors_brothers_count_required
        }

        "sisters_count.out_of_range" -> {
            R.string.profile_sections_errors_sisters_count_out_of_range
        }

        "sisters_count.required" -> {
            R.string.profile_sections_errors_sisters_count_required
        }

        "father_occupation.too_long" -> {
            R.string.profile_sections_errors_father_occupation_too_long
        }

        "mother_occupation.too_long" -> {
            R.string.profile_sections_errors_mother_occupation_too_long
        }

        "home_size_value.out_of_range" -> {
            R.string.profile_sections_errors_home_size_value_out_of_range
        }

        "home_size_value.required" -> {
            R.string.profile_sections_errors_home_size_value_required
        }

        "home_size_unit.required" -> {
            R.string.profile_sections_errors_home_size_unit_required
        }

        "family_city_id.mismatch" -> {
            R.string.profile_sections_errors_family_city_id_mismatch
        }

        "about_family.too_short" -> {
            R.string.profile_sections_errors_about_family_too_short
        }

        "about_family.too_long" -> {
            R.string.profile_sections_errors_about_family_too_long
        }

        "about_family.contains_contact_info" -> {
            R.string.profile_sections_errors_about_family_contains_contact_info
        }

        "about_family.inappropriate" -> {
            R.string.profile_sections_errors_about_family_inappropriate
        }

        "hijab.not_allowed" -> {
            R.string.profile_sections_errors_hijab_not_allowed
        }

        "beard.not_allowed" -> {
            R.string.profile_sections_errors_beard_not_allowed
        }

        "weight_kg.out_of_range" -> {
            R.string.profile_sections_errors_weight_kg_out_of_range
        }

        "disability_details.too_long" -> {
            R.string.profile_sections_errors_disability_details_too_long
        }

        "hobby_codes.too_long" -> {
            R.string.profile_sections_errors_hobby_codes_too_long
        }

        "about_me.too_short" -> {
            R.string.profile_sections_errors_about_me_too_short
        }

        "about_me.too_long" -> {
            R.string.profile_sections_errors_about_me_too_long
        }

        "about_me.contains_contact_info" -> {
            R.string.profile_sections_errors_about_me_contains_contact_info
        }

        "about_me.inappropriate" -> {
            R.string.profile_sections_errors_about_me_inappropriate
        }

        else -> {
            null
        }
    }

/** The messages of the contact details form (08 section 3.7), by field key and code. */
fun contactMessage(
    field: String,
    code: String,
): Int? =
    when ("$field.$code") {
        "phone_e164.invalid" -> R.string.me_errors_phone_e164_invalid
        "whatsapp_e164.invalid" -> R.string.me_errors_whatsapp_e164_invalid
        "guardian_phone_e164.invalid" -> R.string.me_errors_guardian_phone_e164_invalid
        "guardian_phone_e164.required" -> R.string.me_errors_guardian_phone_e164_required
        "phone.pk_mobile" -> R.string.me_errors_phone_pk_mobile
        "contact_email.invalid" -> R.string.me_errors_contact_email_invalid
        "contact_email.too_long" -> R.string.me_errors_contact_email_too_long
        "guardian.required" -> R.string.me_errors_guardian_required
        "guardian_name.required" -> R.string.me_errors_guardian_name_required
        "guardian_name.too_short" -> R.string.me_errors_guardian_name_too_short
        "guardian_name.too_long" -> R.string.me_errors_guardian_name_too_long
        "guardian_name.invalid" -> R.string.me_errors_guardian_name_invalid
        "guardian_relation.required" -> R.string.me_errors_guardian_relation_required
        "best_time_to_call.too_long" -> R.string.me_errors_best_time_to_call_too_long
        "preferred_contact.invalid" -> R.string.me_errors_preferred_contact_invalid
        else -> null
    }
