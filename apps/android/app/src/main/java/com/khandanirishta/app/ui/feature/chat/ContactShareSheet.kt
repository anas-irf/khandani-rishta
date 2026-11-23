package com.khandanirishta.app.ui.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.khandanirishta.app.R
import com.khandanirishta.app.core.data.Lists
import com.khandanirishta.app.core.network.ApiError
import com.khandanirishta.app.core.network.generated.model.ContactShareBody
import com.khandanirishta.app.core.network.generated.model.ContactsSection
import com.khandanirishta.app.core.network.generated.model.OwnProfile
import com.khandanirishta.app.ui.components.AdaptiveRow
import com.khandanirishta.app.ui.components.CheckboxRow
import com.khandanirishta.app.ui.components.ErrorState
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.KrTextLink
import com.khandanirishta.app.ui.components.LoadingRegion
import com.khandanirishta.app.ui.components.SheetAnswers
import com.khandanirishta.app.ui.components.SkeletonBox
import com.khandanirishta.app.ui.components.StatusBanner
import com.khandanirishta.app.ui.components.StatusTone
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Sizes
import com.khandanirishta.app.ui.theme.Spacing

/**
 * The member's current value for an item, as the sheet and "You are sharing:" show it; `null`
 * when missing. The guardian item needs the guardian's name and phone number (08 section 3.5).
 */
@Composable
internal fun contactValue(
    contacts: ContactsSection,
    item: ShareItem,
): String? {
    val reference = LocalReference.current
    if (!contacts.has(item)) return null
    return when (item) {
        ShareItem.PHONE -> {
            contacts.phoneE164?.let(::displayPhone)
        }

        ShareItem.WHATSAPP -> {
            contacts.whatsappE164?.let(::displayPhone)
        }

        ShareItem.EMAIL -> {
            contacts.contactEmail?.let(::leftToRight)
        }

        ShareItem.GUARDIAN -> {
            val relation =
                contacts.guardianRelation
                    ?.let { reference.option(Lists.GUARDIAN_RELATION, it) }
                    ?.takeIf { it.isNotBlank() }
            buildString {
                append(contacts.guardianName.orEmpty())
                if (relation != null) append(" (").append(relation).append(")")
                append(", ").append(displayPhone(contacts.guardianPhoneE164.orEmpty()))
            }
        }
    }
}

/**
 * "Share contact details with {name}" (16 section 6.12, 09 section 10): four checkboxes with the
 * member's current values, "Add" for a missing value (it opens `SET-CONTACTS` and comes back here),
 * the guardian hint when families prefer it, and the fixed warning of 09 section 10.3. A sheet
 * (DESIGN.md section 6.13), so the answers stay in view at large text.
 */
@Composable
internal fun ContactShareSheet(
    name: String,
    profile: OwnProfile?,
    profileError: ApiError?,
    selection: ContactShareBody?,
    missing: ShareItem?,
    busy: Boolean,
    onRetry: () -> Unit,
    onChange: (ContactShareBody) -> Unit,
    onAdd: (ShareItem, ContactShareBody) -> Unit,
    onShare: () -> Unit,
    onDismiss: () -> Unit,
) {
    KrSheet(
        title = text(R.string.chat_share_title, "name" to name),
        onDismissRequest = onDismiss,
        dismissible = !busy,
        actions = {
            // With the buttons, so it is seen however far the items have scrolled.
            if (missing != null && selection != null) {
                StatusBanner(
                    text = text(R.string.chat_share_add_first, "item" to stringResource(missing.missing)),
                    tone = StatusTone.DANGER,
                    announce = true,
                    actionLabel = stringResource(R.string.chat_share_add_now),
                    onAction = { onAdd(missing, selection) },
                    actionEnabled = !busy,
                )
            }
            SheetAnswers(
                confirmLabel = stringResource(R.string.chat_share_submit),
                onConfirm = onShare,
                onCancel = onDismiss,
                enabled = profile != null && selection?.anyOn == true,
                busy = busy,
            )
        },
    ) {
        when {
            profile != null && selection != null -> {
                ShareItems(
                    profile = profile,
                    selection = selection,
                    enabled = !busy,
                    onChange = onChange,
                    onAdd = { item -> onAdd(item, selection) },
                )
            }

            profileError != null -> {
                ErrorState(error = profileError, onRetry = onRetry)
            }

            else -> {
                ShareSkeleton()
            }
        }
    }
}

@Composable
private fun ShareItems(
    profile: OwnProfile,
    selection: ContactShareBody,
    enabled: Boolean,
    onChange: (ContactShareBody) -> Unit,
    onAdd: (ShareItem) -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s12)) {
        if (guardianFirst(profile)) {
            Text(
                text = stringResource(R.string.chat_share_guardian_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(Modifier.fillMaxWidth()) {
            ShareItem.entries.forEach { item ->
                val value = contactValue(profile.contacts, item)
                val label = stringResource(item.label)
                AdaptiveRow(spacing = Spacing.s8, lineSpacing = Spacing.s8) {
                    CheckboxRow(
                        checked = selection.isOn(item),
                        onCheckedChange = { on -> onChange(selection.with(item, on)) },
                        label = label,
                        helper = value,
                        enabled = enabled && value != null,
                        modifier = Modifier.grow(basis = ItemBasis),
                    )
                    if (value == null) {
                        KrTextLink(
                            text = stringResource(R.string.chat_share_add),
                            onClick = { onAdd(item) },
                            enabled = enabled,
                            contentDescription =
                                text(R.string.chat_share_add_named, "item" to stringResource(item.missing)),
                        )
                    }
                }
            }
        }
        StatusBanner(text = stringResource(R.string.chat_share_warning), tone = StatusTone.WARNING)
    }
}

/** The four items before the member's own profile is known (rule G1). */
@Composable
private fun ShareSkeleton() {
    LoadingRegion(Modifier.fillMaxWidth(), spacing = Spacing.s16) {
        repeat(ShareItem.entries.size) {
            Row(Modifier.padding(vertical = Spacing.s4), horizontalArrangement = Arrangement.spacedBy(Spacing.s12)) {
                SkeletonBox(Modifier.size(Sizes.iconSmall))
                SkeletonBox(Modifier.weight(1f).height(Spacing.s40))
            }
        }
    }
}

private val ItemBasis = 160.dp
