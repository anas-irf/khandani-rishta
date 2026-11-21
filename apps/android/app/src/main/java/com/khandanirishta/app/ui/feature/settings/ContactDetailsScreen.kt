package com.khandanirishta.app.ui.feature.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.ConnectionRepository
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.data.ProfileRepository
import com.khandanirishta.app.core.data.SectionPayload
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.apiError
import com.khandanirishta.app.core.network.generated.model.ContactShareStatus
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.FormSkeleton
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.NoteBox
import com.khandanirishta.app.ui.components.Phone
import com.khandanirishta.app.ui.components.PhoneField
import com.khandanirishta.app.ui.components.RadioCard
import com.khandanirishta.app.ui.components.RadioCardsField
import com.khandanirishta.app.ui.components.SelectField
import com.khandanirishta.app.ui.feature.profilesections.ContactsInput
import com.khandanirishta.app.ui.feature.profilesections.ContactsRules
import com.khandanirishta.app.ui.feature.profilesections.FieldLocator
import com.khandanirishta.app.ui.feature.profilesections.FormCard
import com.khandanirishta.app.ui.feature.profilesections.FormScreenScaffold
import com.khandanirishta.app.ui.feature.profilesections.FormState
import com.khandanirishta.app.ui.feature.profilesections.FormSummaryBox
import com.khandanirishta.app.ui.feature.profilesections.HelperText
import com.khandanirishta.app.ui.feature.profilesections.RevealEffect
import com.khandanirishta.app.ui.feature.profilesections.SaveBar
import com.khandanirishta.app.ui.feature.profilesections.WarningBox
import com.khandanirishta.app.ui.feature.profilesections.begin
import com.khandanirishta.app.ui.feature.profilesections.edit
import com.khandanirishta.app.ui.feature.profilesections.failed
import com.khandanirishta.app.ui.feature.profilesections.locate
import com.khandanirishta.app.ui.feature.profilesections.rememberFieldLocator
import com.khandanirishta.app.ui.feature.profilesections.rememberOnline
import com.khandanirishta.app.ui.feature.profilesections.savedAs
import com.khandanirishta.app.ui.feature.profilesections.shownByForm
import com.khandanirishta.app.ui.messages.MessageBus
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ContactsUi(
    val loading: Boolean = true,
    val loadError: ApiError? = null,
    val profile: OwnProfile? = null,
    val form: FormState<ContactsInput>? = null,
    /** The member shares contact details with at least one connection (08 section 3.6). */
    val sharing: Boolean = false,
    val saved: Boolean = false,
    /** Changes when the mobile number is set from outside, so its field starts again from the value. */
    val phoneVersion: Int = 0,
)

/** SET-CONTACTS: the contact details a member may later share with a connection (08 section 3). */
@HiltViewModel
class ContactDetailsViewModel
    @Inject
    constructor(
        private val profiles: ProfileRepository,
        private val connections: ConnectionRepository,
        private val bus: MessageBus,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ContactsUi())
        val state: StateFlow<ContactsUi> = mutableState.asStateFlow()

        init {
            load()
            // `my_contact_share` on the connections list tells whether something is shared (08 section 3.6).
            viewModelScope.launch {
                connections.list(filter = "active", cursor = null).onSuccess { page ->
                    val sharing = page.items.any { it.myContactShare?.status == ContactShareStatus.ACTIVE }
                    mutableState.update { it.copy(sharing = sharing) }
                }
            }
        }

        /** `GET /v1/me/profile` (the `contacts` section). */
        fun load() {
            mutableState.update { it.copy(loading = it.form == null, loadError = null) }
            viewModelScope.launch {
                profiles
                    .load()
                    .onSuccess { profile ->
                        mutableState.update {
                            it.copy(
                                loading = false,
                                profile = profile,
                                form = it.form ?: FormState.of(ContactsInput.from(profile.contacts), ContactsRules),
                            )
                        }
                    }.onFailure { error ->
                        mutableState.update { it.copy(loading = false, loadError = error.apiError) }
                    }
            }
        }

        fun edit(
            fields: Set<String>,
            transform: (ContactsInput) -> ContactsInput,
        ) {
            mutableState.update { state -> state.copy(form = state.form?.edit(ContactsRules, fields, transform)) }
        }

        /** "Use {phone}": fills the field; nothing is saved until "Save" (08 section 3.2). */
        fun useVerifiedPhone(phone: String) {
            edit(setOf("phone_e164")) { it.copy(phone = phone) }
            mutableState.update { it.copy(phoneVersion = it.phoneVersion + 1) }
        }

        /** `PUT /v1/me/profile/sections/contacts` with the whole section. */
        fun save() {
            val current = mutableState.value.form ?: return
            if (current.busy) return
            val (checked, values) = current.begin(ContactsRules)
            mutableState.update { it.copy(form = checked) }
            if (values == null) return
            viewModelScope.launch {
                profiles
                    .saveSection(SectionPayload.Contacts(values.toBody()))
                    .onSuccess {
                        bus.toast(R.string.me_contacts_saved)
                        mutableState.update {
                            it.copy(form = it.form?.savedAs(values)?.copy(busy = true), saved = true)
                        }
                    }.onFailure { throwable ->
                        val error = throwable.apiError
                        mutableState.update { it.copy(form = it.form?.failed(ContactsRules, error)) }
                        if (!error.shownByForm) bus.error(error)
                    }
            }
        }

        fun consumeSaved() {
            mutableState.update { it.copy(saved = false) }
        }
    }

/**
 * SET-CONTACTS (specs/16 section 6.28, specs/08 section 3): the phone numbers, email and guardian
 * contact the member may share with a connection. [focus] names the field to show first
 * (`phone_e164`, `whatsapp_e164`, `contact_email` or `guardian_name`). With [returnConnectionId],
 * the save goes back to that connection, whose share dialog opens again by itself (08 section 3.5).
 */
@Composable
fun ContactDetailsScreen(
    focus: String?,
    returnConnectionId: String?,
    viewModel: ContactDetailsViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    val online = rememberOnline()
    val locator = rememberFieldLocator()
    val form = state.form
    val target = focus?.takeIf { it in ContactsInput.FOCUSABLE }
    RevealEffect(form?.reveal, locator)

    LaunchedEffect(state.saved) {
        if (state.saved) {
            viewModel.consumeSaved()
            // Back to the previous screen. When [returnConnectionId] is set that is the connection,
            // which opens its contact share dialog again with the earlier selection (08 section 3.5).
            navigator.back()
        }
    }

    FormScreenScaffold(
        title = stringResource(R.string.me_contacts_title),
        busy = form?.busy == true,
        dirty = form?.dirty == true,
        onLeave = { navigator.back() },
        bottomBar = { onCancel ->
            if (form != null) {
                SaveBar(
                    onSave = viewModel::save,
                    onCancel = onCancel,
                    busy = form.busy,
                    enabled = online,
                    saveLabel = stringResource(R.string.me_contacts_save),
                    cancelLabel = stringResource(R.string.me_contacts_cancel),
                    failure = form.failure,
                    failureText = stringResource(R.string.me_contacts_failed),
                )
            }
        },
    ) {
        val profile = state.profile
        when {
            state.loadError != null && form == null -> {
                ErrorState(state.loadError, onRetry = viewModel::load)
            }

            form == null || profile == null -> {
                FormSkeleton(fields = 5)
            }

            else -> {
                ContactsFields(
                    form = form,
                    profile = profile,
                    sharing = state.sharing,
                    phoneVersion = state.phoneVersion,
                    focus = target,
                    locator = locator,
                    onEdit = viewModel::edit,
                    onUseVerifiedPhone = viewModel::useVerifiedPhone,
                )
            }
        }
    }
}

@Composable
private fun ColumnScope.ContactsFields(
    form: FormState<ContactsInput>,
    profile: OwnProfile,
    sharing: Boolean,
    phoneVersion: Int,
    focus: String?,
    locator: FieldLocator,
    onEdit: (Set<String>, (ContactsInput) -> ContactsInput) -> Unit,
    onUseVerifiedPhone: (String) -> Unit,
) {
    val values = form.values
    val res = LocalResources.current
    val reference = LocalReference.current
    val me = LocalMe.current
    val enabled = !form.busy
    var guardianOpen by rememberSaveable { mutableStateOf(values.hasGuardian || focus == "guardian_name") }
    val preferGuardian = values.preferredContact == "guardian"
    val guardianShown =
        guardianOpen || preferGuardian || ContactsInput.GUARDIAN_FIELDS.any { form.error(it) != null }
    val emailFocus = remember { FocusRequester() }
    val guardianNameFocus = remember { FocusRequester() }

    fun error(field: String): String? = form.error(field)?.resolve(res)

    fun edit(
        field: String,
        transform: (ContactsInput) -> ContactsInput,
    ) = onEdit(setOf(field), transform)

    // 08 section 3.5: show the field named by `focus` once the form is there.
    LaunchedEffect(focus) {
        if (focus == null) return@LaunchedEffect
        withFrameNanos { }
        withFrameNanos { }
        locator.reveal(focus)
        runCatching {
            when (focus) {
                "contact_email" -> emailFocus.requestFocus()
                "guardian_name" -> guardianNameFocus.requestFocus()
            }
        }
    }

    if (form.showSummary) FormSummaryBox(form.unmatched)
    NoteBox(stringResource(R.string.me_contacts_intro))

    Column(Modifier.locate("phone_e164", locator)) {
        key(phoneVersion) {
            PhoneField(
                value = values.phone,
                onChange = { phone -> edit("phone_e164") { it.copy(phone = phone) } },
                label = stringResource(R.string.me_contacts_phone),
                error = error("phone_e164"),
                optional = true,
            )
        }
        // A verified sign-in number can be used with one tap; nothing is saved until "Save" (08 section 3.2).
        val verified = me?.user?.takeIf { it.phoneVerified }?.phoneE164
        if (verified != null && values.phone == null) {
            val dialCodes = remember(reference) { reference.data.countries.mapNotNull { it.dialCode } }
            TextButton(onClick = { onUseVerifiedPhone(verified) }, enabled = enabled) {
                Text(text(R.string.me_contacts_use_verified_phone, "phone" to displayPhone(verified, dialCodes)))
            }
        }
    }

    Column(Modifier.locate("whatsapp_same", locator)) {
        CheckboxRow(
            checked = values.whatsappSame,
            onCheckedChange = { same ->
                onEdit(setOf("whatsapp_same", "whatsapp_e164")) { it.copy(whatsappSame = same) }
            },
            label = stringResource(R.string.me_contacts_whatsapp_same),
            enabled = enabled,
        )
        if (!values.whatsappSame) {
            PhoneField(
                value = values.whatsapp,
                onChange = { phone -> edit("whatsapp_e164") { it.copy(whatsapp = phone) } },
                label = stringResource(R.string.me_contacts_whatsapp),
                error = error("whatsapp_e164"),
                optional = true,
                modifier = Modifier.locate("whatsapp_e164", locator),
            )
        }
    }

    KrTextField(
        value = values.email,
        onValueChange = { email -> edit("contact_email") { it.copy(email = email) } },
        label = stringResource(R.string.me_contacts_email),
        error = error("contact_email"),
        optional = true,
        maxLength = EMAIL_MAX,
        enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
        modifier =
            Modifier
                .locate("contact_email", locator)
                .focusRequester(emailFocus),
    )

    RadioCardsField(
        cards =
            listOf(
                RadioCard("self", stringResource(R.string.me_contacts_preferred_self)),
                RadioCard("guardian", stringResource(R.string.me_contacts_preferred_guardian)),
            ),
        selected = values.preferredContact,
        onSelect = { code ->
            if (code == "guardian") guardianOpen = true
            edit("preferred_contact") { it.copy(preferredContact = code) }
        },
        label = stringResource(R.string.me_contacts_preferred),
        error = error("preferred_contact"),
        enabled = enabled,
        modifier = Modifier.locate("preferred_contact", locator),
    )

    if (guardianShown) {
        FormCard(title = stringResource(R.string.me_contacts_guardian_group)) {
            val managing = profile.accountFor.managedBy != null && profile.accountFor.managedBy != ManagedBy.SELF
            if (managing) HelperText(stringResource(R.string.me_contacts_managing_hint))
            KrTextField(
                value = values.guardianName,
                onValueChange = { name -> edit("guardian_name") { it.copy(guardianName = name) } },
                label = stringResource(R.string.me_contacts_guardian_name),
                error = error("guardian_name"),
                optional = !preferGuardian,
                maxLength = GUARDIAN_NAME_MAX,
                enabled = enabled,
                keyboardOptions =
                    KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                modifier =
                    Modifier
                        .locate("guardian_name", locator)
                        .focusRequester(guardianNameFocus),
            )
            SelectField(
                label = stringResource(R.string.me_contacts_guardian_relation),
                options = reference.options(Lists.GUARDIAN_RELATION),
                selected = values.guardianRelation,
                onSelect = { code -> edit("guardian_relation") { it.copy(guardianRelation = code) } },
                error = error("guardian_relation"),
                optional = !preferGuardian,
                enabled = enabled,
                modifier = Modifier.locate("guardian_relation", locator),
            )
            PhoneField(
                value = values.guardianPhone,
                onChange = { phone -> edit("guardian_phone_e164") { it.copy(guardianPhone = phone) } },
                label = stringResource(R.string.me_contacts_guardian_phone),
                error = error("guardian_phone_e164"),
                optional = !preferGuardian,
                modifier = Modifier.locate("guardian_phone_e164", locator),
            )
        }
    } else {
        TextButton(onClick = { guardianOpen = true }, enabled = enabled) {
            Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.me_contacts_guardian_add))
        }
    }

    KrTextField(
        value = values.bestTimeToCall,
        onValueChange = { time -> edit("best_time_to_call") { it.copy(bestTimeToCall = time) } },
        label = stringResource(R.string.me_contacts_best_time),
        placeholder = stringResource(R.string.me_contacts_best_time_placeholder),
        error = error("best_time_to_call"),
        optional = true,
        maxLength = BEST_TIME_MAX,
        enabled = enabled,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        modifier = Modifier.locate("best_time_to_call", locator),
    )

    if (sharing && form.dirty) {
        WarningBox(stringResource(R.string.me_contacts_shared_warning))
    }
}

/** "+92 300 1234567" for display (08 section 3.3 rule 6). */
private fun displayPhone(
    value: String,
    dialCodes: List<String>,
): String {
    val (dial, national) = Phone.split(value, dialCodes)
    if (dial == null) return value
    val grouped =
        if (dial == "+92" && national.length == PK_NATIONAL) national.take(3) + " " + national.drop(3) else national
    return "$dial $grouped"
}

private const val EMAIL_MAX = 254
private const val GUARDIAN_NAME_MAX = 80
private const val BEST_TIME_MAX = 80
private const val PK_NATIONAL = 10
