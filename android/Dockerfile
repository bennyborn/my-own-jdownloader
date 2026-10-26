# Build image for the Android app: JDK + Gradle + Android SDK. Nothing is installed on the host.
FROM gradle:8.9-jdk17
# ANDROID_USER_HOME: where the debug signing key lives; without it every build would get a new key and could not update the installed app.
ENV ANDROID_HOME=/opt/android-sdk HOME=/home/builder GRADLE_USER_HOME=/home/builder/.gradle ANDROID_USER_HOME=/home/builder/.android
RUN mkdir -p /home/builder $ANDROID_HOME/cmdline-tools && chmod 777 /home/builder \
 && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest && rm /tmp/tools.zip \
 && yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null \
 && $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" >/dev/null \
 && chmod -R a+rX $ANDROID_HOME
WORKDIR /project
