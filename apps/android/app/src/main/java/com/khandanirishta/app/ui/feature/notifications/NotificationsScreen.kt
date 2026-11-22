package com.khandanirishta.app.ui.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.PagedState
import com.khandanirishta.app.core.network.generated.model.Notification
import com.khandanirishta.app.core.network.generated.model.NotificationActor
import com.khandanirishta.app.ui.LinkOpener
import com.khandanirishta.app.ui.components.BrandMark
import com.khandanirishta.app.ui.components.CaptionText
import com.khandanirishta.app.ui.components.DetailTopBar
import com.khandanirishta.app.ui.components.EmptyState
import com.khandanirishta.app.ui.components.KrButton
import com.khandanirishta.app.ui.components.KrButtonVariant
import com.khandanirishta.app.ui.components.KrDialog
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.LocalOnline
import com.khandanirishta.app.ui.components.MemberAvatar
import com.khandanirishta.app.ui.components.MemberText
import com.khandanirishta.app.ui.components.PagedList
import com.khandanirishta.app.ui.components.RowDivider
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.tappable
import com.khandanirishta.app.ui.feature.lists.RowMeta
import com.khandanirishta.app.ui.feature.lists.UnseenMark
import com.khandanirishta.app.ui.feature.lists.rememberRelativeTime
import com.khandanirishta.app.ui.navigation.AppKey
import com.khandanirishta.app.ui.navigation.AppNavigator
import com.khandanirishta.app.ui.navigation.DeepLink
import com.khandanirishta.app.ui.navigation.DeepLinkResolver
import com.khandanirishta.app.ui.navigation.LocalNavigator
import com.khandanirishta.app.ui.navigation.Tab
import com.khandanirishta.app.ui.rememberLinkOpener
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.theme.ArchShape
import com.khandanirishta.app.ui.theme.KrTheme
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/** What the parts of APP-NOTIFS can do. */
@Immutable
internal class NotificationsActions(
    val refresh: () -> Unit,
    val loadMore: () -> Unit,
    val markAllRead: () -> Unit,
    val open: (item: Notification, target: NotificationTarget?) -> Unit,
)

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
    // The dialog of `account_warning`; its reason may be missing.
    var warningOpen by rememberSaveable { mutableStateOf(false) }
    var warningReason by rememberSaveable { mutableStateOf<String?>(null) }

    LifecycleResumeEffect(Unit) {
        viewModel.onResume()
        onPauseOrDispose { }
    }
    val actions =
        remember(viewModel, navigator, links) {
            NotificationsActions(
                refresh = viewModel::refresh,
                loadMore = viewModel::loadMore,
                markAllRead = viewModel::markAllRead,
                open = { item, target ->
                    viewModel.markRead(item)
                    if (target is NotificationTarget.Warning) {
                        warningReason = target.reason
                        warningOpen = true
                    } else if (target != null) {
                        openTarget(target, navigator, links)
                    }
                },
            )
        }

    Scaffold(
        modifier = modifier,
        topBar = { DetailTopBar(title = stringResource(R.string.notifications_title), onBack = { navigator.back() }) },
    ) { padding ->
        Box(Modifier.padding(padding).consumeWindowInsets(padding)) {
            NotificationsContent(state = state, list = list, unread = unread, actions = actions)
            if (warningOpen) {
                WarningDialog(
                    reason = warningReason,
                    onOpenGuidelines = {
                        openLink(DeepLinkResolver.fromTarget("PUB-GUIDELINES", emptyMap()), navigator, links)
                    },
                    onDismiss = { warningOpen = false },
                )
            }
        }
    }
}

/**
 * The feed. "Mark all as read" heads the list instead of sharing the top bar, where at large
 * text it would leave the title no room.
 */
@Composable
internal fun NotificationsContent(
    state: NotificationsUiState,
    list: PagedState<Notification>,
    unread: Long,
    actions: NotificationsActions,
    modifier: Modifier = Modifier,
) {
    val canMarkAll = remember(list.items, unread) { unread > 0 || list.items.any { !it.isRead } }
    val online = LocalOnline.current
    PagedList(
        state = list,
        key = { it.id },
        onRefresh = actions.refresh,
        onLoadMore = actions.loadMore,
        modifier = modifier,
        skeleton = { FeedSkeleton() },
        header = {
            if (list.items.isNotEmpty() || canMarkAll) {
                item(key = MARK_ALL_KEY, contentType = MARK_ALL_KEY) {
                    Box(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(bottom = Spacing.s8),
                        contentAlignment = Alignment.CenterEnd,
                    ) {
                        KrButton(
                            text = stringResource(R.string.notifications_mark_all_read),
                            onClick = actions.markAllRead,
                            variant = KrButtonVariant.QUIET,
                            enabled = online && canMarkAll,
                            loading = state.markingAll,
                        )
                    }
                }
            }
        },
        empty = {
            EmptyState(title = stringResource(R.string.notifications_empty), icon = Icons.Outlined.NotificationsNone)
        },
    ) { item ->
        NotificationRow(item = item, onOpen = { target -> actions.open(item, target) })
    }
}

/**
 * One row, all of it one target: the actor's arch or the app's mark, the text, the note, then
 * the time and, while unread, a dot with its word.
 */
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
    val colors = MaterialTheme.colorScheme

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .tappable(shape = MaterialTheme.shapes.small, onClick = { onOpen(view.target) })
                .heightIn(min = Sizes.rowPhoto.height)
                .padding(vertical = Spacing.s12),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
    ) {
        NotificationAvatar(item.actor)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s4)) {
            Text(
                text = view.text,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal,
                color = colors.onSurface,
            )
            view.note?.let { note ->
                MemberText(note, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
            }
            RowMeta {
                if (unread) UnseenMark(stringResource(R.string.notifications_unread))
                CaptionText(rememberRelativeTime(item.createdAt))
                if (view.target is NotificationTarget.External) {
                    Icon(
                        Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = stringResource(R.string.notifications_announcement_opens_in_new_tab),
                        tint = colors.onSurfaceVariant,
                        modifier = Modifier.size(Sizes.iconTiny),
                    )
                }
            }
        }
    }
}

/** The actor's arch (photo or monogram), or the app's mark in one for system notifications. */
@Composable
private fun NotificationAvatar(actor: NotificationActor?) {
    if (actor != null) {
        // The feed has no gender, and needs none: with a name there is a monogram, not a silhouette.
        MemberAvatar(photo = actor.photo, name = actor.displayName, gender = null, decorative = true)
        return
    }
    val label = stringResource(R.string.notifications_app_icon)
    Box(
        modifier =
            Modifier
                .clearAndSetSemantics { contentDescription = label }
                .size(Sizes.arch46)
                .clip(ArchShape)
                .background(KrTheme.tonal),
        contentAlignment = Alignment.Center,
    ) {
        BrandMark(height = Sizes.iconBar)
    }
}

/** The first load, in the shape of the rows. */
@Composable
private fun FeedSkeleton() {
    LoadingRegion(Modifier.fillMaxWidth(), spacing = 0.dp) {
        repeat(SKELETON_ROWS) {
            Row(
                modifier =
                    Modifier
                        .heightIn(min = Sizes.rowPhoto.height)
                        .padding(vertical = Spacing.s12),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s12),
            ) {
                SkeletonBox(Modifier.size(Sizes.arch46), shape = ArchShape)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
                    SkeletonBox(Modifier.fillMaxWidth().height(Spacing.s20))
                    SkeletonBox(Modifier.fillMaxWidth(TIME_SHARE).height(Spacing.s16))
                }
            }
            RowDivider()
        }
    }
}

/** The full reason of an `account_warning`, with "Community Guidelines" and "I understand" (16 section 6.15). */
@Composable
private fun WarningDialog(
    reason: String?,
    onOpenGuidelines: () -> Unit,
    onDismiss: () -> Unit,
) {
    val body: (@Composable ColumnScope.() -> Unit)? =
        if (reason == null) {
            null
        } else {
            { MemberText(reason, style = MaterialTheme.typography.bodyMedium) }
        }
    KrDialog(
        title = stringResource(R.string.notifications_warning_title),
        confirmLabel = stringResource(R.string.notifications_warning_understand),
        onConfirm = onDismiss,
        onDismissRequest = onDismiss,
        dismissLabel = stringResource(R.string.notifications_warning_guidelines),
        onDismiss = onOpenGuidelines,
        content = body,
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

private const val MARK_ALL_KEY = "notifications:mark-all"
private const val SKELETON_ROWS = 6
private const val TIME_SHARE = 0.4f
