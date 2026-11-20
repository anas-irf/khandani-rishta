// Root build file. Plugins are applied in each module (see app/build.gradle.kts)
// and their versions live in gradle/libs.versions.toml.

plugins {
    alias(libs.plugins.spotless)
}

// ktlint settings for every Kotlin file. They live here rather than in .editorconfig because
// Spotless overrides the code style it finds there.
val ktlintSettings =
    mapOf(
        "ktlint_code_style" to "ktlint_official",
        "max_line_length" to "120",
        // Composable functions are named like types (HomeScreen), which ktlint would flag.
        "ktlint_function_naming_ignore_when_annotated_with" to "Composable",
        // Keeps Compose modifier chains as Android Studio formats them.
        "ktlint_standard_multiline-expression-wrapping" to "disabled",
    )

// Formatting and style for all Kotlin and Gradle Kotlin DSL files, with ktlint and the
// Compose rules. Check with `./gradlew spotlessCheck`, fix with `./gradlew spotlessApply`.
spotless {
    kotlin {
        target("**/*.kt")
        targetExclude("**/build/**")
        ktlint(libs.versions.ktlint.get())
            .editorConfigOverride(ktlintSettings)
            .customRuleSets(
                listOf(
                    libs.compose.rules.ktlint
                        .get()
                        .toString(),
                ),
            )
    }
    kotlinGradle {
        target("**/*.gradle.kts")
        targetExclude("**/build/**")
        ktlint(libs.versions.ktlint.get())
            .editorConfigOverride(ktlintSettings)
    }
}
