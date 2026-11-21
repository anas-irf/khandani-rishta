package com.khandanirishta.app.ui.feature.profilesections

import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.data.SectionPayload
import com.khandanirishta.app.core.network.generated.model.AccountForBody
import com.khandanirishta.app.core.network.generated.model.BasicsSection
import com.khandanirishta.app.core.network.generated.model.Beard
import com.khandanirishta.app.core.network.generated.model.BloodGroup
import com.khandanirishta.app.core.network.generated.model.BodyType
import com.khandanirishta.app.core.network.generated.model.ChildrenStatus
import com.khandanirishta.app.core.network.generated.model.CommunitySection
import com.khandanirishta.app.core.network.generated.model.Complexion
import com.khandanirishta.app.core.network.generated.model.ConsentDocument
import com.khandanirishta.app.core.network.generated.model.Disability
import com.khandanirishta.app.core.network.generated.model.EducationCareerSection
import com.khandanirishta.app.core.network.generated.model.EmploymentType
import com.khandanirishta.app.core.network.generated.model.FamilyClass
import com.khandanirishta.app.core.network.generated.model.FamilySection
import com.khandanirishta.app.core.network.generated.model.FamilyType
import com.khandanirishta.app.core.network.generated.model.FamilyValues
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.Hijab
import com.khandanirishta.app.core.network.generated.model.HomeOwnership
import com.khandanirishta.app.core.network.generated.model.HomeSizeUnit
import com.khandanirishta.app.core.network.generated.model.HomeType
import com.khandanirishta.app.core.network.generated.model.JahezStance
import com.khandanirishta.app.core.network.generated.model.LifestyleSection
import com.khandanirishta.app.core.network.generated.model.LivingArrangement
import com.khandanirishta.app.core.network.generated.model.LocationSection
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.MaritalStatus
import com.khandanirishta.app.core.network.generated.model.MarriageTimeline
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.ParentStatus
import com.khandanirishta.app.core.network.generated.model.PrayerFrequency
import com.khandanirishta.app.core.network.generated.model.Religiosity
import com.khandanirishta.app.core.network.generated.model.ReligiousEducation
import com.khandanirishta.app.core.network.generated.model.Relocation
import com.khandanirishta.app.core.network.generated.model.ResidencyStatus
import com.khandanirishta.app.core.network.generated.model.Smoking
import com.khandanirishta.app.core.network.generated.model.WorkAfterMarriage
import com.khandanirishta.app.ui.navigation.GateRouter
import java.math.BigDecimal
import java.time.LocalDate

/*
 * The values of the profile section forms (07 sections 3 to 9), their prefill from `OwnProfile`
 * (07 section 2.4 step 2) and the whole section sent with `PUT /v1/me/profile/sections/{section}`.
 * Closed lists are kept as wire codes, so a value this build does not know stays empty.
 */

/** The seven sections edited with these forms, in onboarding order (08 section 2). */
val SECTION_KEYS: List<String> =
    listOf("account_for", "basics", "community", "location", "education_career", "family", "lifestyle")

/** "Prefer not to say" in the caste list and "Not specified" in the sub-caste list (07 section 5.2). */
const val NOT_SPECIFIED = "__none"

/** Children statuses that come with a number of children (07 section 4.1). */
val CHILDREN_WITH_COUNT = setOf("living_with_me", "not_living_with_me")

/** Employment types without profession, job, employer and income (07 section 7.3 rule 2). */
val NOT_WORKING = setOf("student", "homemaker", "not_working")

fun isWorking(employmentType: String?): Boolean = employmentType !in NOT_WORKING

sealed interface SectionInput

data class AccountForInput(
    val managedBy: String? = null,
    val managerName: String = "",
    /** Consent 1: terms, privacy policy and community guidelines. */
    val consentTerms: Boolean = false,
    /** Consent 2: the age declaration. */
    val consentAge: Boolean = false,
    /** Consent 3: the candidate knows and agrees. */
    val consentCandidate: Boolean = false,
) : SectionInput

data class BasicsInput(
    val firstName: String = "",
    val lastName: String = "",
    val gender: String? = null,
    val dateOfBirth: LocalDate? = null,
    val maritalStatus: String? = null,
    val currentWivesCount: Int? = null,
    val childrenStatus: String? = null,
    val childrenCount: Int? = null,
    val heightCm: Int? = null,
) : SectionInput

data class CommunityInput(
    val religionCode: String? = null,
    val sectCode: String? = null,
    /** A listed caste, [NOT_SPECIFIED], or `null` for nothing chosen. */
    val casteCode: String? = null,
    val casteOther: String = "",
    /** "Other (type your own)" was chosen: [casteOther] is used. */
    val casteTyped: Boolean = false,
    val subCasteCode: String? = null,
    val subCasteOther: String = "",
    val subCasteTyped: Boolean = false,
    val motherTongueCode: String? = null,
    val languageCodes: Set<String> = emptySet(),
) : SectionInput

data class LocationInput(
    val place: PlaceValue = PlaceValue(countryCode = PAKISTAN),
    val area: String = "",
    val nationalityCode: String? = PAKISTAN,
    val residencyStatus: String? = null,
    /** The family's home town in Pakistan (`origin_city_id` or `origin_other`). */
    val origin: PlaceValue = PlaceValue(countryCode = PAKISTAN),
    val relocation: String? = null,
) : SectionInput {
    /** Residency is asked only when living outside the country of nationality (07 section 6.1). */
    val asksResidency: Boolean
        get() = place.countryCode != null && nationalityCode != null && place.countryCode != nationalityCode
}

data class EducationCareerInput(
    val educationLevelCode: String? = null,
    val educationFieldCode: String? = null,
    val degreeTitle: String = "",
    val instituteName: String = "",
    val employmentType: String? = null,
    val professionCode: String? = null,
    val jobTitle: String = "",
    val employerName: String = "",
    val incomeBandCode: String? = null,
) : SectionInput

data class FamilyInput(
    val fatherStatus: String? = null,
    val fatherOccupation: String = "",
    val motherStatus: String? = null,
    val motherOccupation: String = "",
    val brothersCount: Int? = null,
    val brothersMarried: Int? = null,
    val sistersCount: Int? = null,
    val sistersMarried: Int? = null,
    val familyType: String? = null,
    val familyClass: String? = null,
    val familyValues: String? = null,
    /** The switch "My family lives in a different city" (not stored). */
    val familyElsewhere: Boolean = false,
    /** `family_country_code` and `family_city_id`. */
    val familyPlace: PlaceValue = PlaceValue(countryCode = PAKISTAN),
    val homeOwnership: String? = null,
    val homeType: String? = null,
    /** Typed with up to 2 decimals, so kept as text. */
    val homeSizeValue: String = "",
    val homeSizeUnit: String? = null,
    val aboutFamily: String = "",
) : SectionInput

data class LifestyleInput(
    val religiosity: String? = null,
    val prayerFrequency: String? = null,
    val hijab: String? = null,
    val beard: String? = null,
    val religiousEducation: String? = null,
    val smoking: String? = null,
    val livingArrangement: String? = null,
    val workAfterMarriage: String? = null,
    val marriageTimeline: String? = null,
    val jahezStance: String? = null,
    val weightKg: String = "",
    val complexion: String? = null,
    val bodyType: String? = null,
    val bloodGroup: String? = null,
    val disability: String? = null,
    val disabilityDetails: String = "",
    /** In the order chosen ("Help me write" names the first three, 07 section 9.3). */
    val hobbyCodes: Set<String> = emptySet(),
    val aboutMe: String = "",
) : SectionInput

const val PAKISTAN = "PK"

/** What the rules of a section need besides its values. */
class SectionContext(
    val mode: FormMode,
    val profile: OwnProfile,
    val reference: Reference?,
    val places: PlaceLookup,
) {
    val subject: Subject get() = subjectOf(profile.accountFor.managedBy, profile.basics.gender)

    fun sectCount(religionCode: String?): Int =
        reference
            ?.data
            ?.religions
            ?.firstOrNull { it.code == religionCode }
            ?.sects
            ?.size ?: 0

    fun hasSubCastes(casteCode: String?): Boolean =
        reference
            ?.data
            ?.castes
            ?.firstOrNull { it.code == casteCode }
            ?.subCastes
            ?.isNotEmpty() == true
}

/** Which sub-caste control is shown (07 section 5.2). */
enum class SubCasteControl { HIDDEN, SELECT, TEXT }

fun CommunityInput.subCasteControl(context: SectionContext): SubCasteControl =
    when {
        casteTyped -> SubCasteControl.TEXT
        casteCode == null || casteCode == NOT_SPECIFIED -> SubCasteControl.HIDDEN
        context.hasSubCastes(casteCode) -> SubCasteControl.SELECT
        else -> SubCasteControl.TEXT
    }

/** Consent 3 is shown for a profile not managed by the candidate (07 section 3.1, 08 section 2.1 rule 4). */
fun AccountForInput.showsCandidateConsent(context: SectionContext): Boolean {
    if (managedBy == null || managedBy == ManagedBy.SELF.wire) return false
    return context.mode == FormMode.ONBOARDING || context.profile.accountFor.managedBy == ManagedBy.SELF
}

/** Fields of the "Religious practice" group shown only for Islam (07 section 9.1). */
fun lifestyleShows(
    field: String,
    context: SectionContext,
): Boolean {
    val islam = context.profile.community.religionCode == "islam"
    val gender = context.profile.basics.gender
        ?.wire
    return when (field) {
        "hijab" -> islam && gender == "female"
        "beard" -> islam && gender == "male"
        "prayer_frequency", "religious_education" -> islam
        else -> true
    }
}

/** The form values of [section] filled from the profile. */
fun sectionValues(
    section: String,
    context: SectionContext,
): SectionInput {
    val profile = context.profile
    return when (section) {
        "account_for" -> {
            val managedBy = profile.accountFor.managedBy.wireCode
            // Consents of a step already continued were recorded (03 section 4.3): they start ticked.
            val recorded =
                context.mode == FormMode.ONBOARDING && GateRouter.stepIndex(profile.onboardingStep.wire) > 0
            AccountForInput(
                managedBy = managedBy,
                managerName = profile.accountFor.managerName.orEmpty(),
                consentTerms = recorded,
                consentAge = recorded,
                consentCandidate = recorded && managedBy != null && managedBy != ManagedBy.SELF.wire,
            )
        }

        "basics" -> {
            with(profile.basics) {
                BasicsInput(
                    firstName = firstName.orEmpty(),
                    lastName = lastName.orEmpty(),
                    gender = gender.wireCode,
                    dateOfBirth = dateOfBirth,
                    maritalStatus = maritalStatus.wireCode,
                    currentWivesCount = currentWivesCount,
                    childrenStatus = childrenStatus.wireCode,
                    childrenCount = childrenCount,
                    heightCm = heightCm,
                )
            }
        }

        "community" -> {
            with(profile.community) {
                val listedWithSubs = casteCode != null && context.hasSubCastes(casteCode)
                CommunityInput(
                    religionCode = religionCode,
                    sectCode = sectCode,
                    casteCode = casteCode,
                    casteOther = casteOther.orEmpty(),
                    casteTyped = casteOther != null,
                    subCasteCode = subCasteCode,
                    subCasteOther = subCasteOther.orEmpty(),
                    subCasteTyped = listedWithSubs && subCasteOther != null,
                    motherTongueCode = motherTongueCode,
                    languageCodes = languageCodes.orEmpty().toCollection(LinkedHashSet()),
                )
            }
        }

        "location" -> {
            with(profile.location) {
                context.places.remember(listOf(city, originCity))
                LocationInput(
                    place =
                        PlaceValue(
                            countryCode = countryCode ?: PAKISTAN,
                            regionId = regionId ?: city?.regionId,
                            cityId = cityId,
                            cityOther = if (cityId != null) null else cityOther,
                        ),
                    area = area.orEmpty(),
                    nationalityCode = nationalityCode ?: PAKISTAN,
                    residencyStatus = residencyStatus.wireCode,
                    origin =
                        PlaceValue(
                            countryCode = PAKISTAN,
                            cityId = originCityId,
                            cityOther = if (originCityId != null) null else originOther,
                        ),
                    relocation = relocation.wireCode,
                )
            }
        }

        "education_career" -> {
            with(profile.educationCareer) {
                EducationCareerInput(
                    educationLevelCode = educationLevelCode,
                    educationFieldCode = educationFieldCode,
                    degreeTitle = degreeTitle.orEmpty(),
                    instituteName = instituteName.orEmpty(),
                    employmentType = employmentType.wireCode,
                    professionCode = professionCode,
                    jobTitle = jobTitle.orEmpty(),
                    employerName = employerName.orEmpty(),
                    incomeBandCode = incomeBandCode,
                )
            }
        }

        "family" -> {
            with(profile.family) {
                FamilyInput(
                    fatherStatus = fatherStatus.wireCode,
                    fatherOccupation = fatherOccupation.orEmpty(),
                    motherStatus = motherStatus.wireCode,
                    motherOccupation = motherOccupation.orEmpty(),
                    brothersCount = brothersCount,
                    brothersMarried = brothersMarried,
                    sistersCount = sistersCount,
                    sistersMarried = sistersMarried,
                    familyType = familyType.wireCode,
                    familyClass = familyClass.wireCode,
                    familyValues = familyValues.wireCode,
                    familyElsewhere = familyCountryCode != null || familyCityId != null,
                    familyPlace = PlaceValue(countryCode = familyCountryCode ?: PAKISTAN, cityId = familyCityId),
                    homeOwnership = homeOwnership.wireCode,
                    homeType = homeType.wireCode,
                    homeSizeValue =
                        homeSizeValue?.let { BigDecimal.valueOf(it).stripTrailingZeros().toPlainString() }.orEmpty(),
                    homeSizeUnit = homeSizeUnit.wireCode,
                    aboutFamily = aboutFamily.orEmpty(),
                )
            }
        }

        else -> {
            with(profile.lifestyle) {
                LifestyleInput(
                    religiosity = religiosity.wireCode,
                    prayerFrequency = prayerFrequency.wireCode,
                    hijab = hijab.wireCode,
                    beard = beard.wireCode,
                    religiousEducation = religiousEducation.wireCode,
                    smoking = smoking.wireCode,
                    livingArrangement = livingArrangement.wireCode,
                    workAfterMarriage = workAfterMarriage.wireCode,
                    marriageTimeline = marriageTimeline.wireCode,
                    jahezStance = jahezStance.wireCode,
                    weightKg = weightKg?.toString().orEmpty(),
                    complexion = complexion.wireCode,
                    bodyType = bodyType.wireCode,
                    bloodGroup = bloodGroup.wireCode,
                    disability = disability.wireCode,
                    disabilityDetails = disabilityDetails.orEmpty(),
                    hobbyCodes = hobbyCodes.orEmpty().toCollection(LinkedHashSet()),
                    aboutMe = aboutMe.orEmpty(),
                )
            }
        }
    }
}

/** The whole section to send (07 sections 3.3 to 9.4: dependent fields as the API stores them). */
fun SectionInput.toPayload(context: SectionContext): SectionPayload =
    when (this) {
        is AccountForInput -> toPayload(context)
        is BasicsInput -> SectionPayload.Basics(toBody())
        is CommunityInput -> SectionPayload.Community(toBody(context))
        is LocationInput -> SectionPayload.Location(toBody())
        is EducationCareerInput -> SectionPayload.EducationCareer(toBody())
        is FamilyInput -> SectionPayload.Family(toBody())
        is LifestyleInput -> SectionPayload.Lifestyle(toBody(context))
    }

private fun AccountForInput.toPayload(context: SectionContext): SectionPayload {
    val consents = mutableListOf<ConsentDocument>()
    if (context.mode == FormMode.ONBOARDING) {
        if (consentTerms) {
            consents += listOf(ConsentDocument.TERMS, ConsentDocument.PRIVACY, ConsentDocument.COMMUNITY_GUIDELINES)
        }
        if (consentAge) consents += ConsentDocument.AGE_DECLARATION
    }
    if (showsCandidateConsent(context) && consentCandidate) consents += ConsentDocument.CANDIDATE_CONSENT
    val self = managedBy == ManagedBy.SELF.wire
    return SectionPayload.AccountFor(
        AccountForBody(
            consents = consents.takeIf { it.isNotEmpty() },
            managedBy = wireOf<ManagedBy>(managedBy),
            managerName = if (self) null else collapse(managerName),
        ),
    )
}

/** 07 section 4.2 rules 4 to 6, the way the API stores them. */
private fun BasicsInput.toBody(): BasicsSection {
    val childrenStatus = if (maritalStatus == "never_married") "none" else this.childrenStatus
    val withCount = childrenStatus in CHILDREN_WITH_COUNT
    return BasicsSection(
        firstName = collapse(firstName),
        lastName = collapse(lastName),
        gender = wireOf<Gender>(gender),
        dateOfBirth = dateOfBirth,
        maritalStatus = wireOf<MaritalStatus>(maritalStatus),
        childrenStatus = wireOf<ChildrenStatus>(childrenStatus),
        childrenCount = if (withCount) childrenCount else null,
        currentWivesCount = if (maritalStatus == "married") currentWivesCount else null,
        heightCm = heightCm,
    )
}

private fun CommunityInput.toBody(context: SectionContext): CommunitySection {
    val listedCaste = if (!casteTyped && casteCode != NOT_SPECIFIED) casteCode else null
    val typedCaste = if (casteTyped) collapse(casteOther) else null
    var subCode: String? = null
    var subOther: String? = null
    when (subCasteControl(context)) {
        SubCasteControl.SELECT -> {
            if (subCasteTyped) {
                subOther = collapse(subCasteOther)
            } else if (subCasteCode != NOT_SPECIFIED) {
                subCode = subCasteCode
            }
        }

        SubCasteControl.TEXT -> {
            subOther = collapse(subCasteOther)
        }

        SubCasteControl.HIDDEN -> {}
    }
    val anyCaste = listedCaste != null || typedCaste != null
    return CommunitySection(
        religionCode = religionCode,
        sectCode = if (context.sectCount(religionCode) > 0) sectCode else null,
        casteCode = listedCaste,
        casteOther = typedCaste,
        subCasteCode = if (anyCaste) subCode else null,
        subCasteOther = if (anyCaste) subOther else null,
        motherTongueCode = motherTongueCode,
        languageCodes = languageCodes.filter { it != motherTongueCode },
    )
}

private fun LocationInput.toBody(): LocationSection =
    LocationSection(
        countryCode = place.countryCode,
        regionId = place.regionId,
        cityId = place.cityId,
        cityOther = place.cityOtherToSend,
        nationalityCode = nationalityCode,
        area = collapse(area),
        residencyStatus =
            when {
                asksResidency -> wireOf<ResidencyStatus>(residencyStatus)
                place.countryCode != null && nationalityCode != null -> ResidencyStatus.CITIZEN
                else -> wireOf<ResidencyStatus>(residencyStatus)
            },
        originCityId = origin.cityId,
        originOther = origin.cityOtherToSend,
        relocation = wireOf<Relocation>(relocation),
    )

private fun EducationCareerInput.toBody(): EducationCareerSection {
    val working = isWorking(employmentType)
    return EducationCareerSection(
        educationLevelCode = educationLevelCode,
        educationFieldCode = educationFieldCode,
        degreeTitle = collapse(degreeTitle),
        instituteName = collapse(instituteName),
        employmentType = wireOf<EmploymentType>(employmentType),
        professionCode = if (working) professionCode else null,
        jobTitle = if (working) collapse(jobTitle) else null,
        employerName = if (working) collapse(employerName) else null,
        incomeBandCode = if (working) incomeBandCode else null,
    )
}

private fun FamilyInput.toBody(): FamilySection {
    val size = homeSizeValue.trim().ifEmpty { null }

    fun counted(
        total: Int?,
        married: Int?,
    ): Int? = if (total == null || total == 0) null else married
    return FamilySection(
        fatherStatus = wireOf<ParentStatus>(fatherStatus),
        fatherOccupation = collapse(fatherOccupation),
        motherStatus = wireOf<ParentStatus>(motherStatus),
        motherOccupation = collapse(motherOccupation),
        brothersCount = brothersCount,
        brothersMarried = counted(brothersCount, brothersMarried),
        sistersCount = sistersCount,
        sistersMarried = counted(sistersCount, sistersMarried),
        familyType = wireOf<FamilyType>(familyType),
        familyClass = wireOf<FamilyClass>(familyClass),
        familyValues = wireOf<FamilyValues>(familyValues),
        familyCountryCode = if (familyElsewhere) familyPlace.countryCode else null,
        familyCityId = if (familyElsewhere) familyPlace.cityId else null,
        homeOwnership = wireOf<HomeOwnership>(homeOwnership),
        homeType = wireOf<HomeType>(homeType),
        homeSizeValue = size?.toDoubleOrNull(),
        homeSizeUnit = wireOf<HomeSizeUnit>(homeSizeUnit),
        aboutFamily = trimmed(aboutFamily),
    )
}

/** A field that is not shown is sent as `null` (07 section 9.1). */
private fun LifestyleInput.toBody(context: SectionContext): LifestyleSection {
    fun <T> shown(
        field: String,
        value: T?,
    ): T? = if (lifestyleShows(field, context)) value else null
    val withDetails = disability != null && disability != "none"
    return LifestyleSection(
        religiosity = wireOf<Religiosity>(religiosity),
        prayerFrequency = shown("prayer_frequency", wireOf<PrayerFrequency>(prayerFrequency)),
        hijab = shown("hijab", wireOf<Hijab>(hijab)),
        beard = shown("beard", wireOf<Beard>(beard)),
        religiousEducation = shown("religious_education", wireOf<ReligiousEducation>(religiousEducation)),
        smoking = wireOf<Smoking>(smoking),
        livingArrangement = wireOf<LivingArrangement>(livingArrangement),
        workAfterMarriage = wireOf<WorkAfterMarriage>(workAfterMarriage),
        marriageTimeline = wireOf<MarriageTimeline>(marriageTimeline),
        jahezStance = wireOf<JahezStance>(jahezStance),
        weightKg = weightKg.trim().toIntOrNull(),
        complexion = wireOf<Complexion>(complexion),
        bodyType = wireOf<BodyType>(bodyType),
        bloodGroup = wireOf<BloodGroup>(bloodGroup),
        disability = wireOf<Disability>(disability),
        disabilityDetails = if (withDetails) collapse(disabilityDetails) else null,
        hobbyCodes = hobbyCodes.toList(),
        aboutMe = trimmed(aboutMe),
    )
}
