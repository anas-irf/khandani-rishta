package com.khandanirishta.app.ui.feature.gates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.AutoDelete
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.ConsentDocument
import com.khandanirishta.app.core.network.generated.model.FieldError
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.ArchTone
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.IconText
import com.khandanirishta.app.ui.components.KrActionBar
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonSize
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrDialog
import com.khandanirishta.app.ui.components.KrIconButton
import com.khandanirishta.app.ui.components.KrMenu
import com.khandanirishta.app.ui.components.KrMenuItem
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.NavRow
import com.khandanirishta.app.ui.components.NudgeCard
import com.khandanirishta.app.ui.components.QuoteBlock
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.RowEnd
import com.khandanirishta.app.ui.components.SectionHeading
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.feature.settings.DeleteAccountSheet
import com.khandanirishta.app.ui.feature.settings.kit.BulletLine
import com.khandanirishta.app.ui.feature.settings.kit.SignOutDialog
import com.khandanirishta.app.ui.feature.settings.kit.longDateInZone
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.Help
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.MyPhotos
import com.khandanirishta.app.ui.navigation.MyProfile
import com.khandanirishta.app.ui.navigation.PrivacySettings
import com.khandanirishta.app.ui.navigation.Verification
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.KrType
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing
import com.khandanirishta.app.ui.navigation.Settings as SettingsKey

/*
 * The gate screens of specs/16 section 6.2, on the page of GateFrame: the title on sand, then what
 * happened, with the one way on in the bar at the foot. None shows the primary navigation; each
 * offers "Sign out" (and Help, where the gate allows it) in the top bar menu. The gate host swaps
 * the screen by itself when `Me.gate` changes, so no screen navigates to another gate.
 */

/** The socket is closed while an account is blocked (19 section 4), and review has no end time: both poll. */
private const val POLL_MILLIS = 60_000L

/**
 * GATE-BLOCKED: what happened to a suspended or banned account (specs/16 section 6.2, copy of
 * specs/06 section 8.4), with "Contact support" and "Delete my data" (06 section 9.4).
 */
@Composable
fun GateBlockedScreen(
    modifier: Modifier = Modifier,
    viewModel: GateViewModel = hiltViewModel(),
) {
    val me = LocalMe.current ?: return
    val links = rememberLinkOpener()
    val res = LocalResources.current
    var deleting by rememberSaveable { mutableStateOf(false) }
    // A suspension that ends is noticed by the next `GET /v1/me`, once a minute while visible.
    LifecycleResumeEffect(Unit) {
        viewModel.startPolling(POLL_MILLIS)
        onPauseOrDispose { viewModel.stopPolling() }
    }
    val user = me.user
    val code = me.profile.publicCode
    val account =
        remember(me.gate, user, code) {
            BlockedAccount(
                banned = me.gate == Gate.BANNED,
                code = code,
                reason = user.statusReason?.takeIf { it.isNotBlank() },
                until = user.suspendedUntil?.let { longDateInZone(it, user.timezone) },
                purgeDate = user.purgeAfter?.let { longDateInZone(it, user.timezone) },
            )
        }

    BlockedGate(
        account = account,
        onSupport = {
            links.email(
                to = me.config.supportEmail,
                subject = res.text(R.string.gate_blocked_support_subject, "code" to code),
            )
        },
        onOpenPage = { links.webPage(it) },
        onDelete = { deleting = true },
        modifier = modifier,
        actions = { GateExits(showHelp = true) },
    )
    if (deleting) DeleteAccountSheet(onDismiss = { deleting = false })
}

/** What GATE-BLOCKED says. */
@Immutable
internal data class BlockedAccount(
    val banned: Boolean,
    val code: String,
    val reason: String? = null,
    val until: String? = null,
    val purgeDate: String? = null,
)

@Composable
internal fun BlockedGate(
    account: BlockedAccount,
    onSupport: () -> Unit,
    onOpenPage: (path: String) -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val title = if (account.banned) R.string.gate_blocked_banned_title else R.string.gate_blocked_suspended_title
    // "Reason: {reason}." then the end date (suspended) or the invitation to write (banned), 06 section 8.4.
    val reasonLine = account.reason?.let { text(R.string.gate_blocked_reason, "reason" to it) }
    val secondLine =
        if (account.banned) {
            stringResource(R.string.gate_blocked_banned_mistake)
        } else {
            account.until?.let { text(R.string.gate_blocked_suspended_until, "date" to it) }
        }
    val body = listOfNotNull(reasonLine, secondLine).joinToString(" ")
    GateFrame(
        title = stringResource(title),
        modifier = modifier,
        actions = actions,
        bottomBar = {
            KrActionBar(maxWidth = Sizes.formWidth) {
                KrButton(
                    text = stringResource(R.string.gate_blocked_contact_support),
                    onClick = onSupport,
                    icon = Icons.Outlined.MailOutline,
                    fullWidth = true,
                )
            }
        },
    ) {
        if (body.isNotEmpty()) MemberText(body)
        Text(
            text = text(R.string.gate_blocked_profile_code, "code" to account.code),
            style = MaterialTheme.typography.bodySmall.merge(KrType.numbers),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s20),
            verticalArrangement = Arrangement.spacedBy(Spacing.s8),
        ) {
            KrTextLink(
                text = stringResource(R.string.gate_layout_guidelines),
                onClick = { onOpenPage("community-guidelines") },
            )
            KrTextLink(text = stringResource(R.string.gate_layout_terms), onClick = { onOpenPage("terms") })
        }
        // Once a deletion is scheduled the date is shown instead (06 section 9.4).
        if (account.purgeDate != null) {
            StatusBanner(
                text = text(R.string.gate_blocked_data_deletion, "date" to account.purgeDate),
                tone = StatusTone.WARNING,
                icon = Icons.Outlined.AutoDelete,
                announce = true,
            )
        } else {
            KrButton(
                text = stringResource(R.string.gate_blocked_delete_data),
                onClick = onDelete,
                variant = KrButtonVariant.SECONDARY,
                size = KrButtonSize.LARGE,
                enabled = LocalOnline.current,
                fullWidth = true,
            )
        }
    }
}

/**
 * GATE-DELETION: the account is scheduled for deletion; "Keep my account" cancels it
 * (specs/16 section 6.2, 06 sections 9.1 and 9.3).
 */
@Composable
fun GateDeletionScreen(
    modifier: Modifier = Modifier,
    viewModel: GateViewModel = hiltViewModel(),
) {
    val me = LocalMe.current ?: return
    val state by viewModel.state.collectAsStateWithLifecycle()
    val purgeAfter = me.user.purgeAfter
    val timezone = me.user.timezone
    val date = remember(purgeAfter, timezone) { purgeAfter?.let { longDateInZone(it, timezone) } }

    DeletionGate(
        date = date,
        busy = state.busy,
        onKeep = { viewModel.keepAccount() },
        modifier = modifier,
        actions = { GateExits(showHelp = true) },
    )
}

@Composable
internal fun DeletionGate(
    date: String?,
    busy: Boolean,
    onKeep: () -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    GateFrame(
        title = stringResource(R.string.gate_deletion_title),
        modifier = modifier,
        actions = actions,
        bottomBar = {
            KrActionBar(maxWidth = Sizes.formWidth) {
                KrButton(
                    text = stringResource(R.string.gate_deletion_keep),
                    onClick = onKeep,
                    icon = Icons.Outlined.Restore,
                    loading = busy,
                    enabled = LocalOnline.current,
                    fullWidth = true,
                )
            }
        },
    ) {
        Text(
            text =
                if (date != null) {
                    text(R.string.gate_deletion_text, "date" to date)
                } else {
                    stringResource(R.string.gate_deletion_text_no_date)
                },
            style = MaterialTheme.typography.bodyLarge,
        )
        Text(
            text = stringResource(R.string.gate_deletion_hidden),
            style = MaterialTheme.typography.bodyMedium,
            color = KrTheme.colors.textSecondary,
        )
    }
}

/**
 * GATE-CONSENT: acceptance of new versions of the legal documents (specs/16 section 6.2). Help is
 * not open under this gate (16 section 3.2), so the menu offers only "Sign out".
 */
@Composable
fun GateConsentScreen(
    modifier: Modifier = Modifier,
    viewModel: GateViewModel = hiltViewModel(),
) {
    val me = LocalMe.current ?: return
    val links = rememberLinkOpener()
    val state by viewModel.state.collectAsStateWithLifecycle()
    var disagreeing by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val required = me.consentsRequired
    val documents = remember(required) { required.filter { it != ConsentDocument.UNKNOWN } }

    ConsentGate(
        documents = documents,
        busy = state.busy,
        onOpenPage = { links.webPage(it) },
        onAccept = { viewModel.acceptConsents(documents) },
        onDisagree = { disagreeing = true },
        modifier = modifier,
        actions = { GateExits(showHelp = false) },
    )
    if (disagreeing) {
        // It only leads to the confirmation, which is where danger is.
        KrDialog(
            title = stringResource(R.string.gate_consent_disagree_dialog_title),
            text = stringResource(R.string.gate_consent_disagree_dialog_text),
            confirmLabel = stringResource(R.string.gate_consent_disagree_dialog_delete),
            variant = KrButtonVariant.INK,
            dismissLabel = stringResource(R.string.gate_consent_disagree_dialog_back),
            onConfirm = {
                disagreeing = false
                deleting = true
            },
            onDismissRequest = { disagreeing = false },
        )
    }
    if (deleting) DeleteAccountSheet(onDismiss = { deleting = false })
}

@Composable
internal fun ConsentGate(
    documents: List<ConsentDocument>,
    busy: Boolean,
    onOpenPage: (path: String) -> Unit,
    onAccept: () -> Unit,
    onDisagree: () -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    var agreed by rememberSaveable { mutableStateOf(false) }
    GateFrame(
        title = stringResource(R.string.gate_consent_title),
        modifier = modifier,
        actions = actions,
        bottomBar = {
            KrActionBar(maxWidth = Sizes.formWidth) {
                KrButton(
                    text = stringResource(R.string.gate_consent_accept),
                    onClick = onAccept,
                    loading = busy,
                    enabled = agreed && LocalOnline.current,
                    fullWidth = true,
                )
            }
        },
    ) {
        if (documents.isNotEmpty()) {
            Column {
                documents.forEach { document ->
                    val page = document.page()
                    val name = document.label()?.let { stringResource(it) } ?: Reference.fallback(document.wire)
                    if (page != null) {
                        NavRow(
                            title = name,
                            icon = Icons.Outlined.Description,
                            end = RowEnd.EXTERNAL,
                            onClick = { onOpenPage(page) },
                        )
                    } else {
                        IconText(
                            icon = Icons.Outlined.Description,
                            text = name,
                            style = MaterialTheme.typography.titleSmall,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            gap = Spacing.s12,
                            modifier = Modifier.padding(vertical = Spacing.s16),
                        )
                    }
                    RowDivider()
                }
            }
        }
        CheckboxRow(
            checked = agreed,
            onCheckedChange = { agreed = it },
            label = stringResource(R.string.gate_consent_agree),
            enabled = !busy,
        )
        KrButton(
            text = stringResource(R.string.gate_consent_disagree),
            onClick = onDisagree,
            variant = KrButtonVariant.QUIET,
            enabled = !busy,
        )
    }
}

/**
 * GATE-REVIEW: the profile waits for a moderator (specs/16 section 6.2). Shows the action cards of
 * specs/07 section 15.1 that still apply and refetches `Me` every minute while visible.
 */
@Composable
fun GateReviewScreen(
    modifier: Modifier = Modifier,
    viewModel: GateViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    val profile by viewModel.ownProfile.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.loadOwnProfile() }
    LifecycleResumeEffect(Unit) {
        viewModel.startPolling(POLL_MILLIS)
        onPauseOrDispose { viewModel.stopPolling() }
    }
    val own = profile

    // Cards that depend on the profile appear once it has loaded; privacy is always offered.
    ReviewGate(
        showPhoto = own != null && needsPhoto(own),
        showVerify = own != null && needsVerification(own),
        onOpen = { navigator.push(it) },
        modifier = modifier,
        actions = { GateExits(showHelp = true, showSettings = true) },
    )
}

@Composable
internal fun ReviewGate(
    showPhoto: Boolean,
    showVerify: Boolean,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    GateFrame(
        title = stringResource(R.string.gate_review_title),
        modifier = modifier,
        actions = actions,
        bottomBar = {
            KrActionBar(maxWidth = Sizes.formWidth) {
                KrButton(
                    text = stringResource(R.string.gate_review_view_profile),
                    onClick = { onOpen(MyProfile) },
                    icon = Icons.Outlined.Person,
                    fullWidth = true,
                )
            }
        },
    ) {
        Text(stringResource(R.string.gate_review_text), style = MaterialTheme.typography.bodyLarge)
        SectionHeading(stringResource(R.string.gate_review_next_steps))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
            if (showPhoto) {
                NudgeCard(
                    title = stringResource(R.string.gate_review_photo_title),
                    description = stringResource(R.string.gate_review_photo_text),
                    icon = Icons.Outlined.PhotoCamera,
                    onClick = { onOpen(MyPhotos) },
                )
            }
            if (showVerify) {
                NudgeCard(
                    title = stringResource(R.string.gate_review_verify_title),
                    description = stringResource(R.string.gate_review_verify_text),
                    icon = Icons.Outlined.Badge,
                    tone = ArchTone.SUCCESS,
                    onClick = { onOpen(Verification) },
                )
            }
            NudgeCard(
                title = stringResource(R.string.gate_review_privacy_title),
                description = stringResource(R.string.gate_review_privacy_text),
                icon = Icons.Outlined.Shield,
                onClick = { onOpen(PrivacySettings) },
            )
        }
    }
}

/**
 * GATE-CHANGES: what a moderator asked the member to fix, and "Resubmit for review"
 * (specs/16 section 6.2). `validation_failed` shows the messages and opens the matching
 * ME-EDIT section (07 section 14.3).
 */
@Composable
fun GateChangesScreen(
    modifier: Modifier = Modifier,
    viewModel: GateViewModel = hiltViewModel(),
) {
    val me = LocalMe.current ?: return
    val navigator = LocalNavigator.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.openTarget) {
        val target = state.openTarget ?: return@LaunchedEffect
        viewModel.consumeOpenTarget()
        navigator.push(target)
    }

    ChangesGate(
        reason = me.profile.statusReason,
        state = state,
        onOpen = { navigator.push(it) },
        onResubmit = { viewModel.resubmit() },
        modifier = modifier,
        actions = { GateExits(showHelp = true, showSettings = true) },
    )
}

@Composable
internal fun ChangesGate(
    reason: String?,
    state: GateUiState,
    onOpen: (AppKey) -> Unit,
    onResubmit: () -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    GateFrame(
        title = stringResource(R.string.gate_changes_title),
        modifier = modifier,
        actions = actions,
        bottomBar = {
            KrActionBar(maxWidth = Sizes.formWidth) {
                KrButton(
                    text = stringResource(R.string.gate_changes_resubmit),
                    onClick = onResubmit,
                    loading = state.busy,
                    enabled = LocalOnline.current,
                    fullWidth = true,
                )
            }
        },
    ) {
        Text(stringResource(R.string.gate_changes_text), style = MaterialTheme.typography.bodyLarge)
        if (!reason.isNullOrBlank()) {
            StatusBanner(
                text = null,
                title = stringResource(R.string.gate_changes_reason_label),
                tone = StatusTone.WARNING,
            ) {
                // The moderator's own words, whole.
                QuoteBlock(reason, Modifier.padding(top = Spacing.s8))
            }
        }
        if (state.problems.isNotEmpty()) Problems(problems = state.problems, onOpen = onOpen)
        KrButton(
            text = stringResource(R.string.gate_changes_edit),
            onClick = { onOpen(MyProfile) },
            variant = KrButtonVariant.SECONDARY,
            size = KrButtonSize.LARGE,
            icon = Icons.Outlined.Edit,
            fullWidth = true,
        )
    }
}

/**
 * The messages of a `validation_failed` answer, each with the section it belongs to, and one link
 * per screen that fixes them (07 section 14.3).
 */
@Composable
private fun Problems(
    problems: List<FieldError>,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val steps = remember(problems) { problems.mapNotNull { stepForField(it.field) }.distinct() }
    StatusBanner(
        text = null,
        title = stringResource(R.string.gate_changes_problems_title),
        tone = StatusTone.DANGER,
        announce = true,
        modifier = modifier,
    ) {
        problems.forEach { problem ->
            val message = problemText(problem).resolve(res)
            val section = stepForField(problem.field)?.let { sectionLabel(it) }
            BulletLine(
                text =
                    if (section != null) {
                        text(R.string.gate_changes_problem, "section" to stringResource(section), "message" to message)
                    } else {
                        message
                    },
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            steps.forEach { step ->
                val target = fixTargetForStep(step)
                val label = sectionLabel(step)
                if (target != null && label != null) {
                    KrTextLink(
                        text = text(R.string.gate_changes_fix_link, "section" to stringResource(label)),
                        onClick = { onOpen(target) },
                    )
                }
            }
        }
    }
}

/**
 * The ways out of a gate: [showHelp] follows the gate table (Help is open under every gate except
 * `consent_required`); [showSettings] is for the review gates, which keep the own profile and
 * settings open (16 section 3.2).
 */
@Composable
private fun GateExits(
    showHelp: Boolean,
    modifier: Modifier = Modifier,
    showSettings: Boolean = false,
) {
    val navigator = LocalNavigator.current
    val appViewModel = LocalAppViewModel.current
    var open by remember { mutableStateOf(false) }
    var confirmSignOut by rememberSaveable { mutableStateOf(false) }
    Box(modifier) {
        KrIconButton(
            icon = Icons.Filled.MoreVert,
            contentDescription = stringResource(R.string.a11y_more_options),
            onClick = { open = true },
        )
        KrMenu(expanded = open, onDismissRequest = { open = false }) {
            if (showSettings) {
                KrMenuItem(
                    text = stringResource(R.string.common_nav_settings),
                    icon = Icons.Outlined.Settings,
                    onClick = {
                        open = false
                        navigator.push(SettingsKey)
                    },
                )
            }
            if (showHelp) {
                KrMenuItem(
                    text = stringResource(R.string.gate_layout_help),
                    icon = Icons.AutoMirrored.Outlined.HelpOutline,
                    onClick = {
                        open = false
                        navigator.push(Help)
                    },
                )
            }
            KrMenuItem(
                text = stringResource(R.string.common_actions_sign_out),
                icon = Icons.AutoMirrored.Outlined.Logout,
                onClick = {
                    open = false
                    confirmSignOut = true
                },
            )
        }
        if (confirmSignOut) {
            SignOutDialog(
                onConfirm = {
                    confirmSignOut = false
                    appViewModel.signOut()
                },
                onDismiss = { confirmSignOut = false },
            )
        }
    }
}

/** The public page of each document a member can be asked to accept again. */
private fun ConsentDocument.page(): String? =
    when (this) {
        ConsentDocument.TERMS -> "terms"
        ConsentDocument.PRIVACY -> "privacy"
        ConsentDocument.COMMUNITY_GUIDELINES -> "community-guidelines"
        else -> null
    }

/** The name of a document on GATE-CONSENT, or `null` for one without a page. */
private fun ConsentDocument.label(): Int? =
    when (this) {
        ConsentDocument.TERMS -> R.string.gate_consent_documents_terms
        ConsentDocument.PRIVACY -> R.string.gate_consent_documents_privacy
        ConsentDocument.COMMUNITY_GUIDELINES -> R.string.gate_consent_documents_community_guidelines
        else -> null
    }
