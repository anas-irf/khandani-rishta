package com.khandanirishta.app.ui.feature.onboarding

import android.content.res.Resources
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.DataKey
import com.khandanirishta.app.core.data.Invalidation
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.MeRepository
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.ErrorCode
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.core.network.generated.model.Gender
import com.khandanirishta.app.core.network.generated.model.IdentitySummary
import com.khandanirishta.app.core.network.generated.model.Importance
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.OwnPhoto
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.core.network.generated.model.PhotoStatus
import com.khandanirishta.app.core.network.generated.model.Preferences
import com.khandanirishta.app.core.network.generated.model.Privacy
import com.khandanirishta.app.core.network.serialization.WireEnum
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.rememberStableImageRequest
import com.khandanirishta.app.ui.feature.preferences.Dimension
import com.khandanirishta.app.ui.feature.preferences.PreferencesInput
import com.khandanirishta.app.ui.feature.profilesections.WarningBox
import com.khandanirishta.app.ui.feature.profilesections.isFormFailure
import com.khandanirishta.app.ui.feature.profilesections.isWorking
import com.khandanirishta.app.ui.feature.profilesections.rememberOnline
import com.khandanirishta.app.ui.feature.profilesections.wireCode
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.DeepLink
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.OnboardingDone
import com.khandanirishta.app.ui.navigation.OnboardingStep
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.plural
import com.khandanirishta.app.ui.text.text
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.math.BigDecimal
import javax.inject.Inject

data class ReviewUi(
    val loading: Boolean = true,
    val loadError: ApiError? = null,
    val profile: OwnProfile? = null,
    val preferences: Preferences? = null,
    val privacy: Privacy? = null,
    val identity: IdentitySummary? = null,
    val photos: List<OwnPhoto> = emptyList(),
    val completing: Boolean = false,
    val failure: ApiError? = null,
    val outcome: StepOutcome? = null,
)

/** ONB-11: review every answer, then "Create my profile" (07 section 14). */
@HiltViewModel
class ReviewViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val me: MeRepository,
        private val bus: MessageBus,
        private val session: OnboardingSession,
        flow: OnboardingFlow,
        invalidation: Invalidation,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ReviewUi())
        val state: StateFlow<ReviewUi> = mutableState.asStateFlow()

        init {
            session.stepViewed(Steps.REVIEW, false, flow.currentStep)
            load()
            // A step edited from here saves its data: show the new answers when the member returns.
            viewModelScope.launch {
                invalidation.flow.collect { key -> if (key in RELOAD_ON) load(silent = true) }
            }
        }

        /** The profile, preferences, privacy, identity and photos (07 section 14.1). */
        fun load(silent: Boolean = false) {
            if (!silent) mutableState.update { it.copy(loading = it.profile == null, loadError = null) }
            viewModelScope.launch {
                val preferences = async { profiles.preferences() }
                val privacy = async { profiles.privacy() }
                val identity = async { profiles.identity() }
                val photos = async { profiles.photos() }
                val profile = profiles.load()
                val results = listOf(profile, preferences.await(), privacy.await(), identity.await(), photos.await())
                val error = results.firstNotNullOfOrNull { it.exceptionOrNull() }
                if (error != null) {
                    if (!silent || mutableState.value.profile == null) {
                        mutableState.update { it.copy(loading = false, loadError = error.apiError) }
                    }
                    return@launch
                }
                mutableState.update {
                    it.copy(
                        loading = false,
                        loadError = null,
                        profile = profile.getOrNull(),
                        preferences = preferences.await().getOrNull(),
                        privacy = privacy.await().getOrNull(),
                        identity = identity.await().getOrNull(),
                        photos = photos.await().getOrNull().orEmpty(),
                    )
                }
            }
        }

        /**
         * "Create my profile": `POST /v1/me/onboarding/complete` (07 section 14.2). [onCompleted] runs
         * as soon as the new `Me` is in place, before the gate host replaces this screen.
         */
        fun complete(onCompleted: (Gate) -> Unit) {
            if (mutableState.value.completing) return
            mutableState.update { it.copy(completing = true, failure = null) }
            viewModelScope.launch {
                val result = profiles.completeOnboarding()
                val completed = result.getOrNull()
                if (completed != null) {
                    session.completed(completed.gate.wire)
                    onCompleted(completed.gate)
                    return@launch
                }
                val error = result.exceptionOrNull()?.apiError ?: return@launch
                when {
                    error.code == ErrorCode.VALIDATION_FAILED -> {
                        session.validationFailed(Steps.REVIEW, error)
                        bus.toast(R.string.onboarding_review_missing)
                        val step = error.fields.firstOrNull()?.let { Steps.forField(it.field) }
                        if (step != null) session.setCompletionErrors(step, error.fields)
                        mutableState.update {
                            it.copy(completing = false, outcome = step?.let { target -> StepOutcome.Edit(target) })
                        }
                    }

                    error.code == ErrorCode.INVALID_STATE -> {
                        // Refetch `Me`: the gate router opens the right screen.
                        me.refresh()
                        mutableState.update { it.copy(completing = false) }
                    }

                    error.isFormFailure -> {
                        mutableState.update { it.copy(completing = false, failure = error) }
                    }

                    else -> {
                        mutableState.update { it.copy(completing = false) }
                        bus.error(error)
                    }
                }
            }
        }

        fun consumeOutcome() {
            mutableState.update { it.copy(outcome = null) }
        }

        fun signedOut() = session.signedOut(Steps.REVIEW)

        private companion object {
            val RELOAD_ON =
                setOf(
                    DataKey.OwnProfile,
                    DataKey.Preferences,
                    DataKey.Privacy,
                    DataKey.OwnPhotos,
                    DataKey.Verifications,
                )
        }
    }

/** One label and value of a review card; private values carry a lock (07 section 14.1). */
private data class ReviewRow(
    val label: String,
    val value: String,
    val privateByDefault: Boolean = false,
)

/** ONB-11 (07 section 14): one card per part with "Edit", the warning, and "Create my profile". */
@Composable
internal fun ReviewStep(viewModel: ReviewViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val appViewModel = LocalAppViewModel.current
    val online = rememberOnline()

    StepNavigationEffect(state.outcome, viewModel::consumeOutcome)

    OnboardingScaffold(
        step = Steps.REVIEW,
        edit = false,
        title = stringResource(R.string.onboarding_review_title),
        subtitle = stringResource(R.string.onboarding_review_subtitle),
        busy = state.completing,
        dirty = false,
        onSignOut = viewModel::signedOut,
        bottomBar = {
            if (state.profile != null) {
                StepBottomBar(
                    primaryLabel = stringResource(R.string.onboarding_review_submit),
                    onPrimary = {
                        viewModel.complete { gate ->
                            // ONB-DONE is shown once, after a completion that results in `ok` (07 section 15).
                            if (gate == Gate.OK) {
                                appViewModel.openLink(DeepLink.Screen(Tab.HOME, listOf(OnboardingDone)))
                            }
                        }
                    },
                    busy = state.completing,
                    enabled = online,
                    failure = state.failure,
                )
            }
        },
    ) {
        val profile = state.profile
        val preferences = state.preferences
        when {
            state.loadError != null && profile == null -> {
                ErrorState(state.loadError, onRetry = { viewModel.load() })
            }

            profile == null || preferences == null -> {
                FormSkeleton(fields = 6)
            }

            else -> {
                val edit: (String) -> Unit = { step -> navigator.push(OnboardingStep(step, edit = true)) }
                ReviewCards(
                    profile = profile,
                    preferences = preferences,
                    privacy = state.privacy,
                    identity = state.identity,
                    photos = state.photos,
                    onEdit = edit,
                )
                WarningBox(stringResource(R.string.profile_sections_basics_warning))
            }
        }
    }
}

@Composable
private fun ColumnScope.ReviewCards(
    profile: OwnProfile,
    preferences: Preferences,
    privacy: Privacy?,
    identity: IdentitySummary?,
    photos: List<OwnPhoto>,
    onEdit: (String) -> Unit,
) {
    val reference = LocalReference.current
    val res = LocalResources.current

    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            Icons.Outlined.Lock,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(14.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            stringResource(R.string.onboarding_review_private),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    ReviewCard(stringResource(R.string.onboarding_review_cards_account_for), onEdit = { onEdit("account_for") }) {
        ReviewRows(accountRows(profile, res, reference))
    }
    ReviewCard(stringResource(R.string.onboarding_review_cards_basics), onEdit = { onEdit("basics") }) {
        ReviewRows(basicsRows(profile, res, reference))
    }
    ReviewCard(stringResource(R.string.onboarding_review_cards_community), onEdit = { onEdit("community") }) {
        ReviewRows(communityRows(profile, res, reference))
    }
    ReviewCard(stringResource(R.string.onboarding_review_cards_location), onEdit = { onEdit("location") }) {
        ReviewRows(locationRows(profile, res, reference))
    }
    ReviewCard(
        stringResource(R.string.onboarding_review_cards_education_career),
        onEdit = { onEdit("education_career") },
    ) {
        ReviewRows(educationRows(profile, res, reference))
    }
    val familyRows = familyRows(profile, res, reference)
    ReviewCard(
        stringResource(R.string.onboarding_review_cards_family),
        empty = familyRows.isEmpty(),
        onEdit = { onEdit("family") },
    ) {
        if (familyRows.isEmpty()) {
            NotAdded(stringResource(R.string.onboarding_review_not_added_yet))
        } else {
            ReviewRows(familyRows)
        }
    }
    val lifestyleRows = lifestyleRows(profile, res, reference)
    ReviewCard(
        stringResource(R.string.onboarding_review_cards_lifestyle),
        empty = lifestyleRows.isEmpty(),
        onEdit = { onEdit("lifestyle") },
    ) {
        if (lifestyleRows.isEmpty()) {
            NotAdded(stringResource(R.string.onboarding_review_not_added_yet))
        } else {
            ReviewRows(lifestyleRows)
        }
    }
    ReviewCard(
        stringResource(R.string.onboarding_review_cards_photos),
        empty = photos.isEmpty(),
        description = privacy?.let { stringResource(photoVisibilityTitle(it.photoVisibility.wireCode)) },
        onEdit = { onEdit("photos") },
    ) {
        if (photos.isEmpty()) NotAdded(stringResource(R.string.onboarding_review_no_photos)) else PhotoThumbs(photos)
    }
    ReviewCard(stringResource(R.string.onboarding_review_cards_preferences), onEdit = { onEdit("preferences") }) {
        LookingFor(preferences, profile.basics.gender, reference, res)
    }
    ReviewCard(
        stringResource(R.string.onboarding_review_cards_identity),
        empty = identity == null,
        onEdit = { onEdit("identity") },
    ) {
        if (identity == null) {
            NotAdded(stringResource(R.string.onboarding_review_not_added))
        } else {
            ReviewRows(
                rows(res, reference) {
                    option(R.string.onboarding_review_labels_document, Lists.DOCUMENT_TYPE, identity.documentType)
                    add(R.string.onboarding_review_labels_number, identity.numberMasked)
                },
            )
        }
    }
}

/** Collects the rows of a review card; empty values are left out. */
private class RowsBuilder(
    private val res: Resources,
    private val reference: Reference,
) {
    val rows = mutableListOf<ReviewRow>()

    fun add(
        label: Int,
        value: String?,
        locked: Boolean = false,
    ) {
        if (!value.isNullOrBlank()) rows += ReviewRow(res.getString(label), value, locked)
    }

    /** The label of a closed-list value. */
    fun option(
        label: Int,
        list: String,
        value: WireEnum?,
        locked: Boolean = false,
    ) = add(label, reference.option(list, value), locked)
}

private fun rows(
    res: Resources,
    reference: Reference,
    build: RowsBuilder.() -> Unit,
): List<ReviewRow> = RowsBuilder(res, reference).apply(build).rows

private fun accountRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val account = profile.accountFor
        option(R.string.onboarding_review_labels_managed_by, Lists.MANAGED_BY, account.managedBy)
        if (account.managedBy != ManagedBy.SELF) {
            add(R.string.onboarding_review_labels_manager_name, account.managerName)
        }
    }

private fun basicsRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val basics = profile.basics
        val status = basics.maritalStatus.wireCode
        add(
            R.string.onboarding_review_labels_full_name,
            listOfNotNull(basics.firstName, basics.lastName).joinToString(" "),
        )
        option(R.string.onboarding_review_labels_gender, Lists.GENDER, basics.gender)
        basics.dateOfBirth?.let { date ->
            val value =
                res.text(
                    R.string.onboarding_review_labels_date_of_birth_value,
                    "date" to Formatters.longDate(date),
                    "age" to Formatters.ageFrom(date),
                )
            add(R.string.onboarding_review_labels_date_of_birth, value)
        }
        option(R.string.onboarding_review_labels_marital_status, Lists.MARITAL_STATUS, basics.maritalStatus)
        if (status == "married") {
            add(R.string.onboarding_review_labels_current_wives_count, basics.currentWivesCount?.toString())
        }
        if (status != null && status != "never_married" && basics.childrenStatus != null) {
            val children = reference.option(Lists.CHILDREN_STATUS, basics.childrenStatus)
            val value =
                basics.childrenCount?.let { count ->
                    res.text(R.string.onboarding_review_labels_children_value, "status" to children, "count" to count)
                } ?: children
            add(R.string.onboarding_review_labels_children, value)
        }
        add(R.string.onboarding_review_labels_height, basics.heightCm?.let { Formatters.height(res, it) })
    }

private fun communityRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val community = profile.community
        add(R.string.onboarding_review_labels_religion, reference.religion(community.religionCode))
        add(R.string.onboarding_review_labels_sect, reference.sect(community.sectCode))
        add(
            R.string.onboarding_review_labels_caste,
            community.casteCode?.let { reference.caste(it) } ?: community.casteOther,
        )
        add(
            R.string.onboarding_review_labels_sub_caste,
            community.subCasteCode?.let { reference.subCaste(it) } ?: community.subCasteOther,
        )
        add(R.string.onboarding_review_labels_mother_tongue, reference.language(community.motherTongueCode))
        add(
            R.string.onboarding_review_labels_languages,
            community.languageCodes.orEmpty().joinToString(", ") { reference.language(it) },
        )
    }

private fun locationRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val location = profile.location
        add(R.string.onboarding_review_labels_city, location.city?.name ?: location.cityOther)
        add(R.string.onboarding_review_labels_region, location.city?.regionName)
        add(R.string.onboarding_review_labels_country, reference.country(location.countryCode))
        add(R.string.onboarding_review_labels_area, location.area, locked = true)
        add(R.string.onboarding_review_labels_nationality, reference.country(location.nationalityCode))
        if (location.countryCode != location.nationalityCode) {
            option(R.string.onboarding_review_labels_residency, Lists.RESIDENCY_STATUS, location.residencyStatus)
        }
        add(R.string.onboarding_review_labels_origin, location.originCity?.name ?: location.originOther)
        option(R.string.onboarding_review_labels_relocation, Lists.RELOCATION, location.relocation)
    }

private fun educationRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val education = profile.educationCareer
        add(R.string.onboarding_review_labels_education_level, reference.educationLevel(education.educationLevelCode))
        add(R.string.onboarding_review_labels_education_field, reference.educationField(education.educationFieldCode))
        add(R.string.onboarding_review_labels_degree_title, education.degreeTitle)
        add(R.string.onboarding_review_labels_institute_name, education.instituteName, locked = true)
        option(R.string.onboarding_review_labels_employment_type, Lists.EMPLOYMENT_TYPE, education.employmentType)
        if (isWorking(education.employmentType.wireCode)) {
            add(R.string.onboarding_review_labels_profession, reference.profession(education.professionCode))
            add(R.string.onboarding_review_labels_job_title, education.jobTitle)
            add(R.string.onboarding_review_labels_employer_name, education.employerName, locked = true)
            add(R.string.onboarding_review_labels_income, reference.incomeBand(education.incomeBandCode), locked = true)
        }
    }

private fun familyRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val family = profile.family

        fun siblings(
            count: Int?,
            married: Int?,
        ): String? =
            when {
                count == null -> {
                    null
                }

                married != null && count > 0 -> {
                    res.text(R.string.onboarding_review_labels_siblings_value, "count" to count, "married" to married)
                }

                else -> {
                    count.toString()
                }
            }
        option(R.string.profile_sections_family_father_status_label, Lists.PARENT_STATUS, family.fatherStatus)
        add(R.string.profile_sections_family_father_occupation_label, family.fatherOccupation)
        option(R.string.profile_sections_family_mother_status_label, Lists.PARENT_STATUS, family.motherStatus)
        add(R.string.profile_sections_family_mother_occupation_label, family.motherOccupation)
        add(
            R.string.profile_sections_family_brothers_count_label,
            siblings(family.brothersCount, family.brothersMarried),
        )
        add(R.string.profile_sections_family_sisters_count_label, siblings(family.sistersCount, family.sistersMarried))
        option(R.string.profile_sections_family_family_type_label, Lists.FAMILY_TYPE, family.familyType)
        option(R.string.profile_sections_family_family_class_label, Lists.FAMILY_CLASS, family.familyClass)
        option(R.string.profile_sections_family_family_values_label, Lists.FAMILY_VALUES, family.familyValues)
        add(R.string.profile_sections_family_family_country_label, reference.country(family.familyCountryCode))
        option(
            R.string.profile_sections_family_home_ownership_label,
            Lists.HOME_OWNERSHIP,
            family.homeOwnership,
            locked = true,
        )
        option(R.string.profile_sections_family_home_type_label, Lists.HOME_TYPE, family.homeType, locked = true)
        family.homeSizeValue?.let { size ->
            val value =
                BigDecimal.valueOf(size).stripTrailingZeros().toPlainString() + " " +
                    reference.option(Lists.HOME_SIZE_UNIT, family.homeSizeUnit)
            add(R.string.profile_sections_family_home_size_label, value, locked = true)
        }
        add(R.string.profile_sections_family_about_family_label, family.aboutFamily)
    }

private fun lifestyleRows(
    profile: OwnProfile,
    res: Resources,
    reference: Reference,
): List<ReviewRow> =
    rows(res, reference) {
        val lifestyle = profile.lifestyle
        option(R.string.onboarding_review_labels_religiosity, Lists.RELIGIOSITY, lifestyle.religiosity)
        option(R.string.onboarding_review_labels_prayer_frequency, Lists.PRAYER_FREQUENCY, lifestyle.prayerFrequency)
        option(R.string.onboarding_review_labels_hijab, Lists.HIJAB, lifestyle.hijab)
        option(R.string.onboarding_review_labels_beard, Lists.BEARD, lifestyle.beard)
        option(
            R.string.onboarding_review_labels_religious_education,
            Lists.RELIGIOUS_EDUCATION,
            lifestyle.religiousEducation,
        )
        option(R.string.onboarding_review_labels_smoking, Lists.SMOKING, lifestyle.smoking)
        option(
            R.string.onboarding_review_labels_living_arrangement,
            Lists.LIVING_ARRANGEMENT,
            lifestyle.livingArrangement,
        )
        option(
            R.string.onboarding_review_labels_work_after_marriage,
            Lists.WORK_AFTER_MARRIAGE,
            lifestyle.workAfterMarriage,
        )
        option(R.string.onboarding_review_labels_marriage_timeline, Lists.MARRIAGE_TIMELINE, lifestyle.marriageTimeline)
        option(R.string.onboarding_review_labels_jahez_stance, Lists.JAHEZ_STANCE, lifestyle.jahezStance)
        add(
            R.string.onboarding_review_labels_weight,
            lifestyle.weightKg?.let { res.text(R.string.onboarding_review_labels_weight_value, "kg" to it) },
        )
        option(R.string.onboarding_review_labels_complexion, Lists.COMPLEXION, lifestyle.complexion)
        option(R.string.onboarding_review_labels_body_type, Lists.BODY_TYPE, lifestyle.bodyType)
        option(R.string.onboarding_review_labels_blood_group, Lists.BLOOD_GROUP, lifestyle.bloodGroup, locked = true)
        val disability =
            listOfNotNull(
                reference.option(Lists.DISABILITY, lifestyle.disability).ifEmpty { null },
                lifestyle.disabilityDetails,
            ).joinToString(": ")
        add(R.string.onboarding_review_labels_disability, disability, locked = true)
        add(
            R.string.onboarding_review_labels_hobbies,
            lifestyle.hobbyCodes.orEmpty().joinToString(", ") { reference.hobby(it) },
        )
        add(R.string.onboarding_review_labels_about_me, lifestyle.aboutMe?.take(ABOUT_PREVIEW))
    }

/** A review card with "Edit", or "Add" when nothing was added yet (07 section 14.1). */
@Composable
private fun ReviewCard(
    title: String,
    onEdit: () -> Unit,
    empty: Boolean = false,
    description: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val actionLabel =
        if (empty) {
            text(R.string.onboarding_review_add_label, "card" to title)
        } else {
            text(R.string.onboarding_review_edit_label, "card" to title)
        }
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = MaterialTheme.shapes.large,
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier.padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.semantics { heading() },
                    )
                    if (description != null) {
                        Text(
                            description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                TextButton(onClick = onEdit, modifier = Modifier.semantics { contentDescription = actionLabel }) {
                    Icon(
                        if (empty) Icons.Outlined.Add else Icons.Outlined.Edit,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(if (empty) R.string.onboarding_review_add else R.string.onboarding_review_edit))
                }
            }
            Column(Modifier.padding(end = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
        }
    }
}

@Composable
private fun ReviewRows(rows: List<ReviewRow>) {
    val privateLabel = stringResource(R.string.onboarding_review_private)
    rows.forEach { row ->
        Column(Modifier.semantics(mergeDescendants = true) { }) {
            Text(
                row.label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    row.value,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (row.privateByDefault) {
                    Spacer(Modifier.width(6.dp))
                    Icon(
                        Icons.Outlined.Lock,
                        contentDescription = privateLabel,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun NotAdded(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** Thumbnails with their status labels (08 section 5.5). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PhotoThumbs(photos: List<OwnPhoto>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        photos.sortedBy { it.position }.forEach { photo ->
            key(photo.id) { PhotoThumb(photo) }
        }
    }
}

@Composable
private fun PhotoThumb(photo: OwnPhoto) {
    val status =
        when {
            photo.status == PhotoStatus.APPROVED && photo.isPrimary -> R.string.photos_status_main
            photo.status == PhotoStatus.APPROVED -> null
            photo.status == PhotoStatus.PENDING_REVIEW -> R.string.photos_status_pending_review
            photo.status == PhotoStatus.PROCESSING -> R.string.photos_status_processing
            photo.status == PhotoStatus.REJECTED -> R.string.photos_status_rejected
            photo.status == PhotoStatus.FAILED -> R.string.photos_status_failed
            else -> null
        }
    Box(
        Modifier
            .size(THUMB_SIZE.dp)
            .clip(MaterialTheme.shapes.medium)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        AsyncImage(
            model = rememberStableImageRequest(photo.thumbUrl),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(THUMB_SIZE.dp),
        )
        if (status != null) {
            Text(
                stringResource(status),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.inverseOnSurface,
                textAlign = TextAlign.Center,
                maxLines = 1,
                modifier =
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.inverseSurface.copy(alpha = 0.8f))
                        .padding(vertical = 2.dp),
            )
        }
    }
}

/** One line per dimension that has a preference, with a "Must have" tag (07 section 14.1). */
@Composable
private fun LookingFor(
    preferences: Preferences,
    gender: Gender?,
    reference: Reference,
    res: Resources,
) {
    val values = PreferencesInput.from(preferences)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Dimension.entries.filter { values.hasPreference(it, gender) }.forEach { dimension ->
            key(dimension) {
                LookingForLine(
                    text = lookingForLine(dimension, values, gender, reference, res),
                    must = values.importanceOf(dimension) == Importance.MUST,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LookingForLine(
    text: String,
    must: Boolean,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = MaterialTheme.typography.bodyMedium)
        if (must) {
            Surface(color = MaterialTheme.colorScheme.tertiaryContainer, shape = MaterialTheme.shapes.small) {
                Text(
                    stringResource(R.string.onboarding_review_must),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
        }
    }
}

private fun lookingForLine(
    dimension: Dimension,
    values: PreferencesInput,
    gender: Gender?,
    reference: Reference,
    res: Resources,
): String {
    fun join(
        list: String,
        codes: Collection<String>,
    ) = codes.joinToString(", ") { reference.option(list, it) }

    fun line(
        id: Int,
        list: String,
        codes: Collection<String>,
    ) = res.text(id, "values" to join(list, codes))
    return when (dimension) {
        Dimension.AGE -> {
            res.text(R.string.onboarding_review_looking_for_age, "min" to values.ageMin, "max" to values.ageMax)
        }

        Dimension.MARITAL_STATUS -> {
            line(R.string.onboarding_review_looking_for_marital_status, Lists.MARITAL_STATUS, values.maritalStatuses)
        }

        Dimension.RELIGION -> {
            res.text(
                R.string.onboarding_review_looking_for_religion,
                "values" to values.religionCodes.joinToString(", ") { reference.religion(it) },
            )
        }

        Dimension.SECT -> {
            res.text(
                R.string.onboarding_review_looking_for_sect,
                "values" to values.sectCodes.joinToString(", ") { reference.sect(it) },
            )
        }

        Dimension.LOCATION -> {
            val places = values.regionIds.size + values.cityIds.size
            val parts =
                listOfNotNull(
                    values.countryCodes.joinToString(", ") { reference.country(it) }.takeIf { it.isNotEmpty() },
                    if (places > 0) res.plural(R.plurals.onboarding_review_looking_for_places_count, places) else null,
                )
            res.text(R.string.onboarding_review_looking_for_location, "values" to parts.joinToString(", "))
        }

        Dimension.EDUCATION -> {
            val level = reference.data.educationLevels.firstOrNull { it.rank == values.educationMinRank }
            val name = level?.name?.replace(Regex("\\s*\\(.*\\)\\s*$"), "")
            val value = name?.let { res.text(R.string.preferences_rows_education_option, "name" to it) }.orEmpty()
            res.text(R.string.onboarding_review_looking_for_education, "value" to value)
        }

        Dimension.HEIGHT -> {
            val min = values.heightMin
            val max = values.heightMax
            val value =
                when {
                    min != null && max != null -> {
                        Formatters.heightShort(res, min) + " - " + Formatters.heightShort(res, max)
                    }

                    min != null -> {
                        res.text(
                            R.string.onboarding_review_looking_for_height_from,
                            "min" to Formatters.heightShort(res, min),
                        )
                    }

                    else -> {
                        res.text(
                            R.string.onboarding_review_looking_for_height_to,
                            "max" to Formatters.heightShort(res, max ?: 0),
                        )
                    }
                }
            res.text(R.string.onboarding_review_looking_for_height, "value" to value)
        }

        Dimension.CHILDREN -> {
            res.text(
                R.string.onboarding_review_looking_for_children,
                "value" to reference.option(Lists.CHILDREN_ACCEPTANCE, values.childrenAcceptance),
            )
        }

        Dimension.CASTE -> {
            res.text(
                R.string.onboarding_review_looking_for_caste,
                "values" to values.casteCodes.joinToString(", ") { reference.caste(it) },
            )
        }

        Dimension.MOTHER_TONGUE -> {
            res.text(
                R.string.onboarding_review_looking_for_mother_tongue,
                "values" to values.motherTongueCodes.joinToString(", ") { reference.language(it) },
            )
        }

        Dimension.PROFESSION -> {
            val parts =
                listOf(
                    join(Lists.EMPLOYMENT_TYPE, values.employmentTypes),
                    values.professionCodes.joinToString(", ") { reference.profession(it) },
                ).filter { it.isNotEmpty() }
            res.text(R.string.onboarding_review_looking_for_profession, "values" to parts.joinToString(", "))
        }

        Dimension.INCOME -> {
            val band =
                reference.data.incomeBands.firstOrNull { it.currencyCode == "PKR" && it.rank == values.incomeMinRank }
            val amount = band?.let { Regex("\\d[\\d,]*").find(it.label)?.value }
            val value = amount?.let { res.text(R.string.preferences_rows_income_option, "amount" to it) }.orEmpty()
            res.text(R.string.onboarding_review_looking_for_income, "value" to value)
        }

        Dimension.RELIGIOSITY -> {
            line(R.string.onboarding_review_looking_for_religiosity, Lists.RELIGIOSITY, values.religiosityLevels)
        }

        Dimension.APPEARANCE -> {
            if (gender == Gender.FEMALE) {
                line(R.string.onboarding_review_looking_for_appearance_beard, Lists.BEARD, values.beardTypes)
            } else {
                line(R.string.onboarding_review_looking_for_appearance_hijab, Lists.HIJAB, values.hijabTypes)
            }
        }

        Dimension.FAMILY -> {
            val parts =
                listOf(
                    join(Lists.FAMILY_VALUES, values.familyValues),
                    join(Lists.FAMILY_TYPE, values.familyTypes),
                ).filter { it.isNotEmpty() }
            res.text(R.string.onboarding_review_looking_for_family, "values" to parts.joinToString(", "))
        }

        Dimension.LIVING_ARRANGEMENT -> {
            line(
                R.string.onboarding_review_looking_for_living_arrangement,
                Lists.LIVING_ARRANGEMENT,
                values.livingArrangements,
            )
        }

        Dimension.WORK_AFTER_MARRIAGE -> {
            line(
                R.string.onboarding_review_looking_for_work_after_marriage,
                Lists.WORK_AFTER_MARRIAGE,
                values.workAfterMarriageOptions,
            )
        }

        Dimension.SMOKING -> {
            line(R.string.onboarding_review_looking_for_smoking, Lists.SMOKING, values.smokingOptions)
        }
    }
}

private const val ABOUT_PREVIEW = 200
private const val THUMB_SIZE = 88
