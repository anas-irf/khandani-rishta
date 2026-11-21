package com.khandanirishta.app.ui.feature.gates

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.AutoDelete
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Gavel
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Reference
import com.khandanirishta.app.core.network.generated.model.ConsentDocument
import com.khandanirishta.app.core.network.generated.model.FieldError
import com.khandanirishta.app.core.network.generated.model.Gate
import com.khandanirishta.app.ui.LocalAppViewModel
import com.khandanirishta.app.ui.components.CenteredTopBar
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.feature.settings.DeleteAccountSheet
import com.khandanirishta.app.ui.feature.settings.kit.ActionButton
import com.khandanirishta.app.ui.feature.settings.kit.ActionStyle
import com.khandanirishta.app.ui.feature.settings.kit.RowEnd
import com.khandanirishta.app.ui.feature.settings.kit.SettingsCard
import com.khandanirishta.app.ui.feature.settings.kit.SettingsInfoRow
import com.khandanirishta.app.ui.feature.settings.kit.SettingsRow
import com.khandanirishta.app.ui.feature.settings.kit.SignOutDialog
import com.khandanirishta.app.ui.feature.settings.kit.TintedIcon
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

/*
 * The gate screens of specs/16 section 6.2. None shows the primary navigation; each offers
 * "Sign out" (and Help, where the gate allows it) in the top bar menu. The gate host swaps the
 * screen by itself when `Me.gate` changes, so no screen navigates to another gate.
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
    val online by viewModel.online.collectAsStateWithLifecycle()
    var deleting by rememberSaveable { mutableStateOf(false) }
    // A suspension that ends is noticed by the next `GET /v1/me`, once a minute while visible.
    LifecycleResumeEffect(Unit) {
        viewModel.startPolling(POLL_MILLIS)
        onPauseOrDispose { viewModel.stopPolling() }
    }
    val banned = me.gate == Gate.BANNED
    val user = me.user
    // "Reason: {reason}." then the end date (suspended) or the invitation to write (banned), 06 section 8.4.
    val reason = user.statusReason?.takeIf { it.isNotBlank() }
    val reasonLine = reason?.let { text(R.string.gate_blocked_reason, "reason" to it) }
    val until = user.suspendedUntil?.let { longDateInZone(it, user.timezone) }
    val secondLine =
        if (banned) {
            stringResource(R.string.gate_blocked_banned_mistake)
        } else {
            until?.let { text(R.string.gate_blocked_suspended_until, "date" to it) }
        }
    val body = listOfNotNull(reasonLine, secondLine).joinToString(" ")
    val code = me.profile.publicCode

    GateScaffold(showHelp = true, modifier = modifier) {
        GateHero(
            icon = if (banned) Icons.Outlined.Block else Icons.Outlined.Schedule,
            title =
                if (banned) {
                    stringResource(R.string.gate_blocked_banned_title)
                } else {
                    stringResource(R.string.gate_blocked_suspended_title)
                },
            tone = if (banned) GateTone.DANGER else GateTone.WARNING,
        )
        if (body.isNotEmpty()) GateText(body)
        Text(
            text(R.string.gate_blocked_profile_code, "code" to code),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
            modifier = Modifier.fillMaxWidth(),
        ) {
            TextButton(onClick = { links.webPage("community-guidelines") }) {
                Text(stringResource(R.string.gate_layout_guidelines))
            }
            TextButton(onClick = { links.webPage("terms") }) {
                Text(stringResource(R.string.gate_layout_terms))
            }
        }
        user.purgeAfter?.let { purgeAfter ->
            StatusBanner(
                text = text(R.string.gate_blocked_data_deletion, "date" to longDateInZone(purgeAfter, user.timezone)),
                icon = Icons.Outlined.AutoDelete,
                container = MaterialTheme.colorScheme.errorContainer,
                content = MaterialTheme.colorScheme.onErrorContainer,
            )
        }
        Spacer(Modifier.height(4.dp))
        ActionButton(
            text = stringResource(R.string.gate_blocked_contact_support),
            icon = Icons.Outlined.MailOutline,
            onClick = {
                links.email(
                    to = me.config.supportEmail,
                    subject = res.text(R.string.gate_blocked_support_subject, "code" to code),
                )
            },
        )
        // Once a deletion is scheduled the date is shown instead (06 section 9.4).
        if (user.purgeAfter == null) {
            ActionButton(
                text = stringResource(R.string.gate_blocked_delete_data),
                style = ActionStyle.OUTLINED,
                enabled = online,
                onClick = { deleting = true },
            )
        }
        if (deleting) DeleteAccountSheet(onDismiss = { deleting = false })
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
    val online by viewModel.online.collectAsStateWithLifecycle()
    val date = me.user.purgeAfter?.let { longDateInZone(it, me.user.timezone) }

    GateScaffold(showHelp = true, modifier = modifier) {
        GateHero(
            icon = Icons.Outlined.AutoDelete,
            title = stringResource(R.string.gate_deletion_title),
            tone = GateTone.WARNING,
        )
        GateText(
            if (date != null) {
                text(R.string.gate_deletion_text, "date" to date)
            } else {
                stringResource(R.string.gate_deletion_text_no_date)
            },
        )
        GateText(stringResource(R.string.gate_deletion_hidden), muted = true)
        Spacer(Modifier.height(4.dp))
        ActionButton(
            text = stringResource(R.string.gate_deletion_keep),
            icon = Icons.Outlined.Restore,
            busy = state.busy,
            enabled = online,
            onClick = viewModel::keepAccount,
        )
    }
}

/**
 * GATE-CONSENT: acceptance of new versions of the legal documents (specs/16 section 6.2). Help is
 * not open under this gate (16 section 3.2), so the menu offers only "Sign out".
 */
@Composable
fun GateConsentScreen(viewModel: GateViewModel = hiltViewModel()) {
    val me = LocalMe.current ?: return
    val links = rememberLinkOpener()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val online by viewModel.online.collectAsStateWithLifecycle()
    var agreed by rememberSaveable { mutableStateOf(false) }
    var disagreeing by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val documents = me.consentsRequired.filter { it != ConsentDocument.UNKNOWN }

    GateScaffold(showHelp = false) {
        GateHero(
            icon = Icons.Outlined.Gavel,
            title = stringResource(R.string.gate_consent_title),
            tone = GateTone.CALM,
        )
        if (documents.isNotEmpty()) {
            SettingsCard {
                documents.forEachIndexed { index, document ->
                    if (index > 0) RowDivider()
                    val page = document.page()
                    val name = document.label()?.let { stringResource(it) } ?: Reference.fallback(document.wire)
                    if (page != null) {
                        SettingsRow(
                            title = name,
                            icon = Icons.Outlined.Description,
                            end = RowEnd.EXTERNAL,
                            onClick = { links.webPage(page) },
                        )
                    } else {
                        SettingsInfoRow(text = name, icon = Icons.Outlined.Description)
                    }
                }
            }
        }
        CheckboxRow(
            checked = agreed,
            onCheckedChange = { agreed = it },
            label = stringResource(R.string.gate_consent_agree),
        )
        ActionButton(
            text = stringResource(R.string.gate_consent_accept),
            busy = state.busy,
            enabled = agreed && online,
            onClick = { viewModel.acceptConsents(documents) },
        )
        ActionButton(
            text = stringResource(R.string.gate_consent_disagree),
            style = ActionStyle.OUTLINED,
            enabled = !state.busy,
            onClick = { disagreeing = true },
        )
        if (disagreeing) {
            AlertDialog(
                onDismissRequest = { disagreeing = false },
                title = { Text(stringResource(R.string.gate_consent_disagree_dialog_title)) },
                text = { Text(stringResource(R.string.gate_consent_disagree_dialog_text)) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            disagreeing = false
                            deleting = true
                        },
                    ) {
                        Text(
                            stringResource(R.string.gate_consent_disagree_dialog_delete),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                },
                dismissButton = {
                    TextButton(onClick = { disagreeing = false }) {
                        Text(stringResource(R.string.gate_consent_disagree_dialog_back))
                    }
                },
            )
        }
        if (deleting) DeleteAccountSheet(onDismiss = { deleting = false })
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
    val showPhoto = own != null && needsPhoto(own)
    val showVerify = own != null && needsVerification(own)

    GateScaffold(showHelp = true, modifier = modifier, showSettings = true) {
        GateHero(
            icon = Icons.Outlined.HourglassTop,
            title = stringResource(R.string.gate_review_title),
            tone = GateTone.CALM,
        )
        GateText(stringResource(R.string.gate_review_text))
        Text(
            stringResource(R.string.gate_review_next_steps),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp)
                    .semantics { heading() },
        )
        if (showPhoto) {
            ReviewActionCard(
                icon = Icons.Outlined.AddAPhoto,
                title = stringResource(R.string.gate_review_photo_title),
                body = stringResource(R.string.gate_review_photo_text),
                onClick = { navigator.push(MyPhotos) },
            )
        }
        if (showVerify) {
            ReviewActionCard(
                icon = Icons.Outlined.VerifiedUser,
                title = stringResource(R.string.gate_review_verify_title),
                body = stringResource(R.string.gate_review_verify_text),
                onClick = { navigator.push(Verification) },
            )
        }
        ReviewActionCard(
            icon = Icons.Outlined.Shield,
            title = stringResource(R.string.gate_review_privacy_title),
            body = stringResource(R.string.gate_review_privacy_text),
            onClick = { navigator.push(PrivacySettings) },
        )
        Spacer(Modifier.height(4.dp))
        ActionButton(
            text = stringResource(R.string.gate_review_view_profile),
            icon = Icons.Outlined.Person,
            onClick = { navigator.push(MyProfile) },
        )
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
    val online by viewModel.online.collectAsStateWithLifecycle()
    LaunchedEffect(state.openTarget) {
        val target = state.openTarget ?: return@LaunchedEffect
        viewModel.consumeOpenTarget()
        navigator.push(target)
    }
    val reason = me.profile.statusReason?.takeIf { it.isNotBlank() }

    GateScaffold(showHelp = true, modifier = modifier, showSettings = true) {
        GateHero(
            icon = Icons.Outlined.EditNote,
            title = stringResource(R.string.gate_changes_title),
            tone = GateTone.WARNING,
        )
        GateText(stringResource(R.string.gate_changes_text))
        if (reason != null) {
            NoticeBox(
                title = stringResource(R.string.gate_changes_reason_label),
                icon = Icons.Outlined.WarningAmber,
                container = KrTheme.colors.warningContainer,
                contentColor = MaterialTheme.colorScheme.onSurface,
            ) {
                Text(reason, style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (state.problems.isNotEmpty()) {
            ProblemsBox(problems = state.problems, onOpen = { navigator.push(it) })
        }
        Spacer(Modifier.height(4.dp))
        ActionButton(
            text = stringResource(R.string.gate_changes_edit),
            style = ActionStyle.OUTLINED,
            icon = Icons.Outlined.Edit,
            onClick = { navigator.push(MyProfile) },
        )
        ActionButton(
            text = stringResource(R.string.gate_changes_resubmit),
            busy = state.busy,
            enabled = online,
            onClick = viewModel::resubmit,
        )
    }
}

/**
 * The page every gate screen shares: the app name in a centred top bar with the menu, and one
 * centred, scrolling column with the screen's content. [showHelp] follows the gate table
 * (Help is open under every gate except `consent_required`); [showSettings] is for the review
 * gates, which keep the own profile and settings open (16 section 3.2).
 */
@Composable
private fun GateScaffold(
    showHelp: Boolean,
    modifier: Modifier = Modifier,
    showSettings: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val navigator = LocalNavigator.current
    val appViewModel = LocalAppViewModel.current
    var confirmSignOut by rememberSaveable { mutableStateOf(false) }
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            CenteredTopBar(
                title = stringResource(R.string.app_name),
                actions = {
                    GateMenu(
                        showHelp = showHelp,
                        showSettings = showSettings,
                        onHelp = { navigator.push(Help) },
                        // Named in full: `Settings` is also the name of the menu icon.
                        onSettings = { navigator.push(com.khandanirishta.app.ui.navigation.Settings) },
                        onSignOut = { confirmSignOut = true },
                    )
                },
            )
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
            contentAlignment = Alignment.TopCenter,
        ) {
            Column(
                Modifier
                    .widthIn(max = 560.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
                content = content,
            )
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
}

/** The overflow menu of a gate screen: Settings and Help where the gate allows them, and "Sign out". */
@Composable
private fun GateMenu(
    showHelp: Boolean,
    showSettings: Boolean,
    onHelp: () -> Unit,
    onSettings: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        IconButton(onClick = { open = true }) {
            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.a11y_more_options))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (showSettings) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.common_nav_settings)) },
                    leadingIcon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
                    onClick = {
                        open = false
                        onSettings()
                    },
                )
            }
            if (showHelp) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.gate_layout_help)) },
                    leadingIcon = { Icon(Icons.AutoMirrored.Outlined.HelpOutline, contentDescription = null) },
                    onClick = {
                        open = false
                        onHelp()
                    },
                )
            }
            DropdownMenuItem(
                text = { Text(stringResource(R.string.common_actions_sign_out)) },
                leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null) },
                onClick = {
                    open = false
                    onSignOut()
                },
            )
        }
    }
}

/** How a gate screen's illustration is tinted. */
private enum class GateTone { CALM, WARNING, DANGER }

/** The illustration: a large icon in two tinted circles, and the screen's title under it. */
@Composable
private fun GateHero(
    icon: ImageVector,
    title: String,
    tone: GateTone,
    modifier: Modifier = Modifier,
) {
    val tint: Color
    val container: Color
    when (tone) {
        GateTone.CALM -> {
            tint = MaterialTheme.colorScheme.primary
            container = MaterialTheme.colorScheme.primaryContainer
        }

        GateTone.WARNING -> {
            tint = KrTheme.colors.warning
            container = KrTheme.colors.warningContainer
        }

        GateTone.DANGER -> {
            tint = MaterialTheme.colorScheme.error
            container = MaterialTheme.colorScheme.errorContainer
        }
    }
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(124.dp)
                .clip(CircleShape)
                .background(container.copy(alpha = 0.45f)),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .size(88.dp)
                    .clip(CircleShape)
                    .background(container),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(44.dp))
            }
        }
        Spacer(Modifier.height(20.dp))
        Text(
            title,
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
    }
}

/** Body text of a gate screen, centred and easy to read. */
@Composable
private fun GateText(
    value: String,
    modifier: Modifier = Modifier,
    muted: Boolean = false,
) {
    Text(
        value,
        style = MaterialTheme.typography.bodyLarge,
        color = if (muted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth(),
    )
}

/** A highlighted box with a title, for the moderator's reason and the missing details. */
@Composable
private fun NoticeBox(
    title: String,
    icon: ImageVector,
    container: Color,
    contentColor: Color,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        color = container,
        contentColor = contentColor,
        shape = MaterialTheme.shapes.large,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    title,
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.semantics { heading() },
                )
            }
            content()
        }
    }
}

/**
 * The messages of a `validation_failed` answer, each with the section it belongs to, and one link
 * per screen that fixes them (07 section 14.3).
 */
@Composable
private fun ProblemsBox(
    problems: List<FieldError>,
    onOpen: (AppKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val steps = problems.mapNotNull { stepForField(it.field) }.distinct()
    NoticeBox(
        title = stringResource(R.string.gate_changes_problems_title),
        icon = Icons.Outlined.ErrorOutline,
        container = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        modifier = modifier,
    ) {
        problems.forEach { problem ->
            val message = problemText(problem).resolve(res)
            val section = stepForField(problem.field)?.let { sectionLabel(it) }
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    Modifier
                        .padding(top = 9.dp)
                        .size(5.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.onErrorContainer),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    if (section != null) {
                        text(R.string.gate_changes_problem, "section" to stringResource(section), "message" to message)
                    } else {
                        message
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        steps.forEach { step ->
            val target = fixTargetForStep(step)
            val label = sectionLabel(step)
            if (target != null && label != null) {
                TextButton(onClick = { onOpen(target) }) {
                    Text(text(R.string.gate_changes_fix_link, "section" to stringResource(label)))
                    Spacer(Modifier.width(4.dp))
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

/** One action card of GATE-REVIEW (07 section 15.1). */
@Composable
private fun ReviewActionCard(
    icon: ImageVector,
    title: String,
    body: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            TintedIcon(
                icon = icon,
                tint = MaterialTheme.colorScheme.primary,
                container = MaterialTheme.colorScheme.primaryContainer,
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
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
