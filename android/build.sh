#!/bin/sh
# Builds the debug APK in the build container and puts it into android/dist/ (offered for download by the backend, and to the app for its update).
# The volume myjd-android-home keeps the signing key: never build without it.
set -e
cd "$(dirname "$0")"
code=$(( $(date +%s) / 60 ))
docker build -q -t myjd-android .
docker run --rm --user 1000:1000 -v "$PWD":/project -v myjd-android-home:/home/builder myjd-android gradle --no-daemon -q assembleDebug -PversionCode=$code
mkdir -p dist
cp app/build/outputs/apk/debug/app-debug.apk dist/my-own-jdownloader.apk
printf '{"versionCode":%s,"versionName":"%s","sha256":"%s"}\n' "$code" "$(sed -n 's/.*versionName = "\(.*\)"/\1/p' app/build.gradle.kts)" "$(sha256sum dist/my-own-jdownloader.apk | cut -d' ' -f1)" > dist/my-own-jdownloader.json
echo "-> android/dist/my-own-jdownloader.apk (version code $code)"
