package com.khandanirishta.app.ui.text

import android.content.Context
import android.content.res.Resources
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink

/*
 * The copy in res/values/copy.xml comes from the web app and uses named placeholders such as
 * {name} (scripts/generate-android-strings.mjs). These helpers fill them by name, so the order of
 * the arguments never matters and the Urdu copy can reorder them freely.
 */

private val PLACEHOLDER = Regex("\\{([A-Za-z0-9_]+)\\}")

/** Replaces each `{key}` with its value. Unknown keys are left as they are. */
fun String.fill(vararg args: Pair<String, Any?>): String {
    if (args.isEmpty() || !contains('{')) return this
    val values = args.toMap()
    return PLACEHOLDER.replace(this) { match ->
        val key = match.groupValues[1]
        if (values.containsKey(key)) values[key]?.toString().orEmpty() else match.value
    }
}

fun Resources.text(
    @StringRes id: Int,
    vararg args: Pair<String, Any?>,
): String = getString(id).fill(*args)

fun Resources.plural(
    @PluralsRes id: Int,
    count: Int,
    vararg args: Pair<String, Any?>,
): String = getQuantityString(id, count).fill("count" to count, *args)

fun Context.text(
    @StringRes id: Int,
    vararg args: Pair<String, Any?>,
): String = resources.text(id, *args)

fun Context.plural(
    @PluralsRes id: Int,
    count: Int,
    vararg args: Pair<String, Any?>,
): String = resources.plural(id, count, *args)

/** A string resource with its `{placeholders}` filled. */
@Composable
@ReadOnlyComposable
fun text(
    @StringRes id: Int,
    vararg args: Pair<String, Any?>,
): String = LocalResources.current.text(id, *args)

/** A plural resource; `{count}` is filled automatically. */
@Composable
@ReadOnlyComposable
fun plural(
    @PluralsRes id: Int,
    count: Int,
    vararg args: Pair<String, Any?>,
): String = LocalResources.current.plural(id, count, *args)

private val TAG = Regex("<([a-z]+)>(.*?)</\\1>")

/**
 * Builds text with links from copy that marks them with tags, for example
 * "I agree to the <terms>Terms of Use</terms>". [links] maps each tag to the action of that link.
 */
fun linkedText(
    raw: String,
    linkColor: androidx.compose.ui.graphics.Color,
    links: Map<String, () -> Unit>,
): AnnotatedString =
    buildAnnotatedString {
        var index = 0
        for (match in TAG.findAll(raw)) {
            append(raw.substring(index, match.range.first))
            val tag = match.groupValues[1]
            val label = match.groupValues[2]
            val action = links[tag]
            if (action == null) {
                append(label)
            } else {
                withLink(
                    LinkAnnotation.Clickable(
                        tag = tag,
                        styles =
                            TextLinkStyles(
                                style = SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline),
                            ),
                    ) { action() },
                ) { append(label) }
            }
            index = match.range.last + 1
        }
        append(raw.substring(index))
    }
