package com.khandanirishta.app.ui.feature.profilesections

import android.content.res.Resources
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.ui.components.ConfirmDialog
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.Subject
import com.khandanirishta.app.ui.text.pick
import com.khandanirishta.app.ui.text.text

/** What the fields of one section need: its values, errors, how to change them, and the [locator] that marks them. */
@Stable
class FieldsScope<T : SectionInput>(
    val values: T,
    val context: SectionContext,
    private val form: FormState<SectionInput>,
    private val res: Resources,
    val locator: FieldLocator,
    private val onEdit: (Set<String>, (SectionInput) -> SectionInput) -> Unit,
) {
    /** Inputs are disabled while the save runs (07 section 2.4). */
    val enabled: Boolean get() = !form.busy
    val mode: FormMode get() = context.mode
    val profile: OwnProfile get() = context.profile
    val subject: Subject get() = context.subject

    fun error(field: String): String? = form.error(field)?.resolve(res)

    /** Changes [fields]: their server errors go away and the rules run again. */
    @Suppress("UNCHECKED_CAST")
    fun edit(
        vararg fields: String,
        transform: (T) -> T,
    ) {
        onEdit(fields.toSet()) { values -> transform(values as T) }
    }
}

/**
 * The fields of a profile section (07 sections 3 to 9), the same on onboarding and ME-EDIT:
 * the summary box, then the section's fields in page order.
 */
@Composable
fun SectionFields(
    ui: SectionFormUi,
    context: SectionContext,
    locator: FieldLocator,
    onEdit: (Set<String>, (SectionInput) -> SectionInput) -> Unit,
    modifier: Modifier = Modifier,
    onIncomeCurrency: (String) -> Unit = {},
    onUseHelpMeWrite: () -> Unit = {},
) {
    val form = ui.form ?: return
    val res = LocalResources.current
    val rules = remember(context) { SectionRules(context) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(FieldSpacing)) {
        if (form.showSummary) FormErrors(form = form, fields = rules.fields(form.values), locator = locator)
        when (val values = form.values) {
            is AccountForInput -> {
                AccountForFields(FieldsScope(values, context, form, res, locator, onEdit))
            }

            is BasicsInput -> {
                BasicsFields(FieldsScope(values, context, form, res, locator, onEdit))
            }

            is CommunityInput -> {
                CommunityFields(FieldsScope(values, context, form, res, locator, onEdit))
            }

            is LocationInput -> {
                LocationFields(FieldsScope(values, context, form, res, locator, onEdit))
            }

            is EducationCareerInput -> {
                EducationCareerFields(
                    FieldsScope(values, context, form, res, locator, onEdit),
                    currency = ui.incomeCurrency,
                    onCurrency = onIncomeCurrency,
                )
            }

            is FamilyInput -> {
                FamilyFields(FieldsScope(values, context, form, res, locator, onEdit))
            }

            is LifestyleInput -> {
                LifestyleFields(
                    FieldsScope(values, context, form, res, locator, onEdit),
                    onUseHelpMeWrite = onUseHelpMeWrite,
                )
            }
        }
    }
}

/** "Change gender to {gender}?" before saving a changed gender during onboarding (07 section 4.1). */
@Composable
fun GenderChangeDialog(
    gender: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val reference = LocalReference.current
    ConfirmDialog(
        title =
            text(
                R.string.profile_sections_basics_gender_dialog_title,
                "gender" to reference.option(Lists.GENDER, gender),
            ),
        text = stringResource(R.string.profile_sections_basics_gender_dialog_body),
        confirmLabel = stringResource(R.string.profile_sections_basics_gender_dialog_confirm),
        dismissLabel = stringResource(R.string.profile_sections_basics_gender_dialog_cancel),
        // The choice is made on the phone: offline, the save after it fails inline and keeps the input.
        needsNetwork = false,
        onConfirm = onConfirm,
        onDismiss = onDismiss,
    )
}

/** The step title of a section (07 sections 3 to 9), in the wording of 07 section 3.2. */
@StringRes
fun sectionTitle(
    section: String,
    subject: Subject,
): Int =
    when (section) {
        "account_for" -> {
            R.string.profile_sections_account_for_title
        }

        "basics" -> {
            R.string.profile_sections_basics_title
        }

        "community" -> {
            R.string.profile_sections_community_title
        }

        "location" -> {
            subject.pick(
                R.string.profile_sections_location_title,
                R.string.profile_sections_location_title_male,
                R.string.profile_sections_location_title_female,
                R.string.profile_sections_location_title_unknown,
            )
        }

        "education_career" -> {
            R.string.profile_sections_education_career_title
        }

        "family" -> {
            R.string.profile_sections_family_title
        }

        else -> {
            subject.pick(
                R.string.profile_sections_lifestyle_title,
                R.string.profile_sections_lifestyle_title_male,
                R.string.profile_sections_lifestyle_title_female,
                R.string.profile_sections_lifestyle_title_unknown,
            )
        }
    }

/** The one-line subtitle under a section's title. */
@StringRes
fun sectionSubtitle(
    section: String,
    subject: Subject,
): Int =
    when (section) {
        "account_for" -> {
            R.string.profile_sections_account_for_subtitle
        }

        "basics" -> {
            R.string.profile_sections_basics_subtitle
        }

        "community" -> {
            R.string.profile_sections_community_subtitle
        }

        "location" -> {
            subject.pick(
                R.string.profile_sections_location_subtitle,
                R.string.profile_sections_location_subtitle_male,
                R.string.profile_sections_location_subtitle_female,
                R.string.profile_sections_location_subtitle_unknown,
            )
        }

        "education_career" -> {
            R.string.profile_sections_education_career_subtitle
        }

        "family" -> {
            R.string.profile_sections_family_subtitle
        }

        else -> {
            subject.pick(
                R.string.profile_sections_lifestyle_subtitle,
                R.string.profile_sections_lifestyle_subtitle_male,
                R.string.profile_sections_lifestyle_subtitle_female,
                R.string.profile_sections_lifestyle_subtitle_unknown,
            )
        }
    }
