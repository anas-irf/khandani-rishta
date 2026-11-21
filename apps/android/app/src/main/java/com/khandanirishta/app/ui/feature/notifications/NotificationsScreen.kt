package com.khandanirishta.app.ui.feature.notifications

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.Notification
import com.khandanirishta.app.core.network.generated.model.NotificationActor
import com.khandanirishta.app.core.util.Formatters
import com.khandanirishta.app.ui.LinkOpener
import com.khandanirishta.app.ui.components.Avatar
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.feature.lists.ButtonSpinner
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.AppNavigator
import com.khandanirishta.app.ui.navigation.DeepLink
import com.khandanirishta.app.ui.navigation.DeepLinkResolver
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference

/**
 * APP-NOTIFS: the in-app feed with "Mark all as read" (specs/16 section 6.15, 14 section 3).
 * Tapping a row marks it read and opens its target.
 */
@Composable
fun NotificationsScreen(
    modifier: Modifier = Modifier,
    viewModel: NotificationsViewModel = hiltViewModel(),
) {
    val navigator = LocalNavigator.current
    val links = rememberLinkOpener()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val list by viewModel.list.collectAsStateWithLifecycle()
    val unread = LocalMe.current?.counters?.unreadNotifications ?: 0L
    val canMarkAll = state.online && (unread > 0 || list.items.any { !it.isRead })
    // The dialog of `account_warning`; its reason may be missing.
    var warningOpen by rememberSaveable { mutableStateOf(false) }
    var warningReason by rememberSaveable { mutableStateOf<String?>(null) }

    LifecycleResumeEffect(Unit) {
        viewModel.onResume()
        onPauseOrDispose { }
    }

    val open: (NotificationTarget?) -> Unit = { target ->
        if (target is NotificationTarget.Warning) {
            warningReason = target.reason
            warningOpen = true
        } else if (target != null) {
            openTarget(target, navigator, links)
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            DetailTopBar(
                title = stringResource(R.string.notifications_title),
                onBack = { navigator.back() },
                actions = {
                    TextButton(onClick = viewModel::markAllRead, enabled = canMarkAll && !state.markingAll) {
                        if (state.markingAll) {
                            ButtonSpinner()
                        } else {
                            Text(stringResource(R.string.notifications_mark_all_read))
                        }
                    }
                },
            )
        },
    ) { padding ->
        PagedList(
            state = list,
            key = { it.id },
            onRefresh = viewModel::refresh,
            onLoadMore = viewModel::loadMore,
            modifier = Modifier.padding(padding),
            contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp),
            spacing = Arrangement.spacedBy(0.dp),
            empty = {
                EmptyState(
                    title = stringResource(R.string.notifications_empty),
                    icon = Icons.Outlined.NotificationsNone,
                )
            },
        ) { item ->
            NotificationRow(
                item = item,
                onOpen = { target ->
                    viewModel.markRead(item)
                    open(target)
                },
            )
        }
        if (warningOpen) {
            WarningDialog(
                reason = warningReason,
                onGuidelines = {
                    openLink(DeepLinkResolver.fromTarget("PUB-GUIDELINES", emptyMap()), navigator, links)
                },
                onDismiss = { warningOpen = false },
            )
        }
    }
}

/** One row: the actor's photo or the app icon, the text, the note, the time, and a dot while unread. */
@Composable
private fun NotificationRow(
    item: Notification,
    onOpen: (NotificationTarget?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val res = LocalResources.current
    val reference = LocalReference.current
    val urdu = LocalConfiguration.current.locales[0]?.language == "ur"
    val view = remember(item, res, reference, urdu) { describeNotification(item, res, reference, urdu) }
    val unread = !item.isRead
    val unreadLabel = stringResource(R.string.notifications_unread)
    val rowColor = if (unread) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f) else Color.Transparent

    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(rowColor)
                .clickable(role = Role.Button, onClick = { onOpen(view.target) })
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            NotificationAvatar(item.actor)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    view.text,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                )
                view.note?.let { note ->
                    Text(
                        note,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        Formatters.relative(res, item.createdAt),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (view.target is NotificationTarget.External) {
                        Spacer(Modifier.width(6.dp))
                        Icon(
                            Icons.AutoMirrored.Outlined.OpenInNew,
                            contentDescription = stringResource(R.string.notifications_announcement_opens_in_new_tab),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
            }
            if (unread) {
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier
                        .padding(top = 8.dp)
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary)
                        .semantics { contentDescription = unreadLabel },
                )
            }
        }
        HorizontalDivider(Modifier.padding(start = 76.dp), color = MaterialTheme.colorScheme.outlineVariant)
    }
}

/** The actor's photo, the actor's initial without a photo, or the app icon for system notifications. */
@Composable
private fun NotificationAvatar(actor: NotificationActor?) {
    val photo = actor?.photo
    when {
        photo != null -> {
            Avatar(photo = photo, gender = null, contentDescription = null, size = 48.dp)
        }

        actor != null -> {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    actor.displayName.take(1).uppercase(),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }

        else -> {
            Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                Image(
                    painter = painterResource(R.drawable.ic_logo_mark),
                    contentDescription = stringResource(R.string.notifications_app_icon),
                    modifier =
                        Modifier
                            .size(40.dp)
                            .clip(MaterialTheme.shapes.small),
                )
            }
        }
    }
}

/** The full reason of an `account_warning`, with "Community Guidelines" and "I understand" (16 section 6.15). */
@Composable
private fun WarningDialog(
    reason: String?,
    onGuidelines: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.notifications_warning_title)) },
        text =
            if (reason != null) {
                { Text(reason, style = MaterialTheme.typography.bodyLarge) }
            } else {
                null
            },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.notifications_warning_understand)) }
        },
        dismissButton = {
            TextButton(onClick = onGuidelines) { Text(stringResource(R.string.notifications_warning_guidelines)) }
        },
    )
}

/** Opens a screen through the deep-link table (16 section 4.1), or an announcement's link. */
private fun openTarget(
    target: NotificationTarget,
    navigator: AppNavigator,
    links: LinkOpener,
) {
    when (target) {
        is NotificationTarget.Screen -> {
            openLink(DeepLinkResolver.fromTarget(target.target, target.params), navigator, links)
        }

        is NotificationTarget.External -> {
            links.url(target.url)
        }

        // The warning opens its dialog on the screen itself.
        is NotificationTarget.Warning -> {}
    }
}

/** Opens a resolved target: screens on top of the current stack, web pages in a Custom Tab. */
private fun openLink(
    link: DeepLink,
    navigator: AppNavigator,
    links: LinkOpener,
) {
    when (link) {
        is DeepLink.Screen -> {
            if (link.keys.isEmpty()) {
                // A tab root such as `APP-HOME`: show that tab from its root.
                navigator.openOnTab(link.tab, emptyList())
            } else {
                navigator.pushAll(link.keys)
            }
        }

        is DeepLink.WebPage -> {
            links.webPage(link.path)
        }

        is DeepLink.External -> {
            links.url(link.url)
        }

        is DeepLink.ProfileCode -> {}
    }
}

/**
 * Pushes [keys] on the current stack, so Back returns to the feed. A first key that is already the
 * root of the stack (the gate screen of `profile_changes_requested`) is returned to instead.
 */
private fun AppNavigator.pushAll(keys: List<AppKey>) {
    val stack = stack(if (tabbed) currentTab else Tab.HOME)
    keys.forEachIndexed { index, key ->
        if (index == 0 && stack.firstOrNull()?.key == key) popUntil { it == key } else push(key)
    }
}
