package com.khandanirishta.app.ui.feature.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import com.khandanirishta.app.R
import com.khandanirishta.app.core.network.generated.model.ManagedBy
import com.khandanirishta.app.ui.components.ChoiceRow
import com.khandanirishta.app.ui.components.FieldLabel
import com.khandanirishta.app.ui.components.KrSheet
import com.khandanirishta.app.ui.components.KrTextField
import com.khandanirishta.app.ui.components.SheetAnswers
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.text
import com.khandanirishta.app.ui.theme.Spacing

/**
 * "Send an interest to {name}" (16 section 6.7, send dialog), as a sheet: what is left today, the
 * message, then the templates as rows that are shown in full.
 */
@Composable
internal fun SendInterestSheet(
    name: String,
    busy: Boolean,
    error: String?,
    onSend: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val me = LocalMe.current
    var message by rememberSaveable { mutableStateOf("") }
    val managedBy = me?.profile?.managedBy
    val templates =
        buildList {
            add(R.string.profile_send_template_1)
            add(R.string.profile_send_template_2)
            if (managedBy != null && managedBy != ManagedBy.SELF) add(R.string.profile_send_template_3)
        }
    val left =
        me?.usage?.let { usage ->
            text(
                R.string.profile_send_left,
                "left" to (usage.interestsPerDay - usage.interestsSentToday).coerceAtLeast(0),
                "total" to usage.interestsPerDay,
            )
        }
    KrSheet(
        title = text(R.string.profile_send_title, "name" to name),
        description = left,
        onDismissRequest = onDismiss,
        dismissible = !busy,
        actions = {
            SheetAnswers(
                confirmLabel = stringResource(R.string.profile_send_submit),
                onConfirm = { onSend(message) },
                onCancel = onDismiss,
                busy = busy,
            )
        },
    ) {
        KrTextField(
            value = message,
            onValueChange = { message = it },
            label = stringResource(R.string.profile_send_message_label),
            optional = true,
            helper = stringResource(R.string.profile_send_helper),
            error = error,
            maxLength = MESSAGE_MAX,
            counter = text(R.string.profile_send_count, "count" to message.length, "max" to MESSAGE_MAX),
            singleLine = false,
            minLines = 3,
            enabled = !busy,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
        FieldLabel(stringResource(R.string.profile_send_templates_label))
        Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(Spacing.s8)) {
            templates.forEach { template ->
                val words = stringResource(template)
                ChoiceRow(text = words, selected = message == words, onClick = { message = words }, enabled = !busy)
            }
            ChoiceRow(
                text = stringResource(R.string.profile_send_template_none),
                selected = message.isEmpty(),
                onClick = { message = "" },
                enabled = !busy,
            )
        }
    }
}

private const val MESSAGE_MAX = 300
