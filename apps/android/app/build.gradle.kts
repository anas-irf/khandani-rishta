import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    // Declared here, not in the root build file, so it loads next to the Android plugin: from the
    // root classloader it cannot see the Android plugin's classes (NoClassDefFoundError).
    alias(libs.plugins.google.services) apply false
}

// Firebase Cloud Messaging needs google-services.json, which is never committed (specs/22 section 8).
// The release workflow writes it from a secret; developers place their own copy. Without it the app
// builds and runs without push notifications.
if (file("google-services.json").exists()) {
    apply(
        plugin = libs.plugins.google.services
            .get()
            .pluginId,
    )
}

// Per-developer values (specs/22 section 14). local.properties is git-ignored.
val localProperties =
    Properties().apply {
        val file = rootProject.file("local.properties")
        if (file.exists()) file.inputStream().use { load(it) }
    }

fun localValue(
    key: String,
    default: String,
): String = localProperties.getProperty(key)?.trim()?.takeIf { it.isNotEmpty() } ?: default

fun releaseValue(
    key: String,
    default: String,
): String =
    providers.gradleProperty(key).orNull
        ?: providers.environmentVariable(key).orNull
        ?: default

fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.khandanirishta.app"
    compileSdk {
        // Android 17 QPR2 (37.2): the current Compose libraries need 37.1 or later.
        version = release(37) {
            minorApiLevel = 2
        }
    }

    defaultConfig {
        applicationId = "com.khandanirishta.app"
        minSdk = 26
        targetSdk = 37
        // CI passes -PversionCode (workflow run number) and -PversionName (from the release tag).
        versionCode = providers.gradleProperty("versionCode").orNull?.toInt() ?: 1
        versionName = providers.gradleProperty("versionName").orNull ?: "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // The release workflow passes SENTRY_DSN from a repository variable.
        buildConfigField("String", "SENTRY_DSN", quoted(releaseValue("SENTRY_DSN", localValue("SENTRY_DSN", ""))))
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Release signing comes from CI secrets. Local release builds stay unsigned.
    val keystorePath = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull
    val releaseClerkKey = releaseValue("RELEASE_CLERK_PUBLISHABLE_KEY", localValue("CLERK_PUBLISHABLE_KEY", ""))
    // A signed build is one users can install, so it must sign in against the Production
    // instance. The development key falls back from local.properties, and a blank key shows the
    // "not configured" screen: both would ship an app nobody can use.
    if (keystorePath != null) {
        require(releaseClerkKey.startsWith("pk_live_")) {
            "Signed release builds need the Production Clerk key: set RELEASE_CLERK_PUBLISHABLE_KEY=pk_live_..."
        }
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        getByName("debug") {
            // The local API on the development machine, as seen from the emulator.
            buildConfigField("String", "API_BASE_URL", quoted(localValue("API_BASE_URL", "http://10.0.2.2:8787")))
            buildConfigField("String", "WEB_BASE_URL", quoted(localValue("WEB_BASE_URL", "https://khandanirishta.app")))
            buildConfigField(
                "String",
                "CLERK_PUBLISHABLE_KEY",
                quoted(localValue("CLERK_PUBLISHABLE_KEY", "")),
            )
        }
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = signingConfigs.findByName("release")
            buildConfigField(
                "String",
                "API_BASE_URL",
                quoted(releaseValue("RELEASE_API_BASE_URL", "https://api.khandanirishta.app")),
            )
            buildConfigField(
                "String",
                "WEB_BASE_URL",
                quoted(releaseValue("RELEASE_WEB_BASE_URL", "https://khandanirishta.app")),
            )
            buildConfigField("String", "CLERK_PUBLISHABLE_KEY", quoted(releaseClerkKey))
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        // Any lint warning fails the build, so problems get fixed instead of piling up.
        warningsAsErrors = true
        abortOnError = true
        checkDependencies = true
        // These checks fail whenever a newer library or SDK is released, which would break
        // unrelated builds. Dependabot keeps versions current instead.
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable", "OldTargetApi")
        // Per-path exceptions, each with its reason.
        lintConfig = file("lint.xml")
    }
}

composeCompiler {
    // The API's models are immutable data classes: telling the compiler lets lists skip what has
    // not changed (specs/22 section 12).
    stabilityConfigurationFiles.add(layout.projectDirectory.file("compose-stability.conf"))
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.compose)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.exifinterface)
    implementation(libs.androidx.hilt.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.clerk.android.ui)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.hilt.android)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.kotlinx.serialization)
    implementation(libs.sentry.android)
    implementation(libs.sentry.okhttp)
    ksp(libs.hilt.compiler)

    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.okhttp.logging.interceptor)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.turbine)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
}
