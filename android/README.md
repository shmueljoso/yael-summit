# Yael Summit · Android app

A small native app that opens the live site full-screen. Accounts, connections, messages and
the board all come from the site and its database, so the app is always up to date — a new
APK is only needed if this folder changes.

What the app handles natively:
- **Profile photos:** the site's photo upload opens the phone's gallery / camera.
- **Staying signed in:** the sign-in cookie is saved when the app closes.
- **Links:** email, phone, social and external links open in the right app.
- **Back button:** goes back inside the site.
- **No connection:** a "No connection" screen with *Try again*.
- **Layout:** the page is kept clear of the status bar and the gesture bar.

## Getting the APK
GitHub builds it (`.github/workflows/android.yml`):
- after each change merged to `main`: **Releases → "Yael Summit · Android app" → yael-summit.apk**
- or **Actions → Android app → Run workflow**, then download *yael-summit-apk* from the run.

Installing on Android: open the APK, allow "Install unknown apps" for the browser or Files app
when asked, then Install. A newer APK installs over the old one.

iPhone can't install APKs. On iPhone open the site in Safari → Share → **Add to Home Screen**;
the site is a PWA, so it opens full-screen with its own icon.

## Settings
- **Site address:** `siteUrl` in `gradle.properties`, or a repository variable `SITE_URL`
  (Settings → Secrets and variables → Actions → Variables), which wins.
- **Signing:** `app/yael-summit.keystore` is a fixed key so updates install over each other.
  For Google Play, create a private upload key and keep it out of the repository.

## Building locally
Needs JDK 17 and the Android SDK: `gradle -p android assembleRelease`.
