# Testing the Android app (APK releases)

Every change to `main` builds an installable Android APK and publishes it, so
anyone on the team can test the latest app on a real phone without a laptop,
Expo Go or a cable. The pipeline is
[`.github/workflows/mobile.yml`](../.github/workflows/mobile.yml).

## Install the latest build (testers)

1. On your phone, open the repository's **Releases** page and tap
   **Latest test build** (tag `mobile-latest`). If the repository is private,
   sign in to GitHub in the phone's browser first.
2. Download `StockSure-<commit>.apk`.
3. Open the file. Android asks to allow installs from this source (the browser
   or Files app): allow it once.
4. If Play Protect says it does not recognise the app, choose **Install
   anyway**. The app is signed for testing, not published on the Play Store.
5. Open **StockSure**.

A newer build installs over the old one and keeps your shop data. If an
install ever fails with "app not installed", uninstall StockSure first (this
clears local data).

The release notes say which commit and build number the build came from. The
build number is the CI run number and goes up with every build.

## What runs when

| When | Checks | APK |
| --- | --- | --- |
| Pull request touching `mobile/` | typecheck, lint, tests | only if the PR has the **`build-apk`** label: a download on the run page (Artifacts) |
| Merge or push to `main` | typecheck, lint, tests | published as the rolling **Latest test build** release |
| Tag `mobile-v1.2.0` | typecheck, lint, tests | a permanent release called `StockSure v1.2.0` |
| *Actions > Mobile > Run workflow* | typecheck, lint, tests | on the run page (Artifacts), for any branch |

The APK is only built after the checks pass. Expect the first build to take a
while (a React Native release build is slow); later ones are faster once
Gradle's cache is warm.

To keep a build, tag a commit on `main`:

```bash
git tag mobile-v0.1.0 && git push origin mobile-v0.1.0
```

To test a branch before it is merged: open a pull request and add the
`build-apk` label, or run the workflow manually on that branch, then download
the APK from the run's **Artifacts** section (kept for 30 days).

## Demo builds

Normal builds contain no sample data tools. For a demo build that has the
Reconcile "Add sample messages (demo)" link, set the repository variable
`MOBILE_DEMO_TOOLS` to `1` (same place as `MOBILE_API_URL`) and build again;
remove the variable for normal builds.

## Which backend the app talks to

The API address is built into the APK. It defaults to the deployed API in
`backend/README.md`. To point builds somewhere else, set a repository variable
named `MOBILE_API_URL` (*Settings > Secrets and variables > Actions >
Variables*). Without a URL a release build would try `10.0.2.2:8000`, the
emulator's address for a laptop, and fail on a real phone.

Pay requests and sync need the backend to be deployed with the same code as the
app (see `backend/README.md`).

## How it is built

1. `npm ci`, then `npm run typecheck`, `npm run lint`, `npm test` in `mobile/`.
2. `npx expo prebuild --platform android` generates the `android/` folder from
   `app.json` and the config plugins. It is not committed; do not edit it.
3. `./gradlew assembleRelease` for the `arm64-v8a` and `armeabi-v7a` phones
   (the emulator-only x86 builds are skipped to save time).
4. The `app.config.js` file sets the Android `versionCode` from the CI run
   number so each APK is newer than the last.

## Signing

Builds are signed with the standard debug key that Expo's Android template
ships. It is the same key every time, so builds update each other, but it is
not suitable for the Play Store. For the store, create a keystore, keep it and
its passwords in GitHub secrets, and point the release signing config at it.

## Building locally

```bash
cd mobile
npm ci
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

This needs the Android SDK and JDK 17. The APK ends up in
`android/app/build/outputs/apk/release/`.
