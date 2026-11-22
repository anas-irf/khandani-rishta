package com.khandanirishta.app.ui.preview

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.khandanirishta.app.core.network.generated.model.Me
import com.khandanirishta.app.ui.text.LocalMe
import com.khandanirishta.app.ui.text.LocalReference
import com.khandanirishta.app.ui.theme.KhandaniTheme

/** The sizes every shared part must survive: a usual phone, a small one at 200% text, and Urdu's direction. */
@Preview(name = "Phone", widthDp = 360, showBackground = true)
@Preview(name = "Small phone, 200% text", widthDp = 320, fontScale = 2f, showBackground = true)
@Preview(name = "Right to left", widthDp = 360, locale = "ur", showBackground = true)
annotation class PreviewPhones

/** The theme on its page, with the sample member signed in and the sample reference data. */
@Composable
fun SampleTheme(
    modifier: Modifier = Modifier,
    me: Me = SampleData.me(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalMe provides me, LocalReference provides SampleData.reference) {
        KhandaniTheme {
            Surface(modifier = modifier, color = MaterialTheme.colorScheme.background, content = content)
        }
    }
}
