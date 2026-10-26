plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "de.bennyborn.myjd"
    compileSdk = 34
    defaultConfig {
        applicationId = "de.bennyborn.myjd"
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        versionName = "0.1-spike"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
