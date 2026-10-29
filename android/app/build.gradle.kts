plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.myownjd"
    compileSdk = 34
    defaultConfig {
        applicationId = "app.myownjd"
        minSdk = 30
        targetSdk = 34
        // build.sh passes the minutes since 1970, so every build is newer than the one before and the app can tell when the backend offers a newer one.
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = "0.1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
