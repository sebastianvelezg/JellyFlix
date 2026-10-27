import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Optional: a file `keystore.properties` next to settings.gradle.kts (never committed) with storeFile, storePassword, keyAlias and
// keyPassword makes `assembleRelease` sign with your own key. Without it the release build is signed with the debug key.
val keystoreFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystoreFile.exists()) keystoreFile.inputStream().use { load(it) }
}

android {
    namespace = "app.jellyflix.tv"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "app.jellyflix.tv"
        // Google TV on the TCL C6K runs Android 12 or newer; 28 keeps older boxes working too.
        minSdk = 28
        targetSdk = 37
        versionCode = 20
        versionName = "1.2.0"
    }

    androidResources {
        // The app speaks English and Spanish only; the libraries' other languages are dead weight.
        localeFilters += listOf("en", "es")
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("own") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Your own key when keystore.properties exists (so updates install over each other on any TV); otherwise the debug key,
            // which gives an APK that can be installed with adb at once.
            signingConfig = signingConfigs.getByName(if (keystoreFile.exists()) "own" else "debug")
            optimization {
                enable = true
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    // The real org.json, because the one inside the Android jar only throws when run on a computer.
    testImplementation("org.json:json:20260814")

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.tvprovider) // the "Continue watching" row on the Google TV home screen
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
    implementation(libs.androidx.tv.material)
    implementation(libs.androidx.compose.material3) // text fields (TV Material has none)

    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.exoplayer.hls)
    implementation(libs.androidx.media3.ui)

    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    implementation(libs.jellyfin.core)
    // The Jellyfin SDK logs through slf4j, which Android does not ship.
    implementation(libs.slf4j.api)
    implementation(libs.logback.android)
    implementation(libs.kotlinx.coroutines.android)
}
