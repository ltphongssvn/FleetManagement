<!--
File:    FleetManagement/docs/adr/005-android-e2e-release-build.md
Purpose: Record the decision to run the driver-app Android E2E (Maestro) against
         a RELEASE build, and the WSL2 emulator->api networking + E2E seed
         lifecycle that the decision depends on.
Why:     The runtime choice (Expo Go vs custom dev-client vs release build) and
         the adb-reverse networking were settled empirically over a long
         debugging arc; this ADR captures the WHY so the .maestro flow and the
         CI build command can stay focused on config.
-->
# ADR-005: Android driver-app E2E runs against a release build

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: Full-stack engineering
- **Related**: ADR-001 (`turborepo-pipeline`), `apps/driver-app/.maestro/driver-login-assignment.yaml`, `apps/driver-app/test/mobile-native-bundle-config.test.ts`, `apps/driver-app/android/gradle.properties`, `apps/driver-app/app.json`, `e2e/global-teardown.ts`

## Context

The driver-app is an Expo (managed-workflow) React Native app (SDK 55, RN 0.83).
The Android E2E target is a Maestro flow that logs a driver in and opens their
assignment list, run on a headless emulator under Windows 11 + WSL2 with a
software-rendered (swiftshader) GPU.

Two classes of problem blocked a green Maestro run:

1. **Dev-menu overlays.** On every state wipe (`pm clear`), the Expo Go / debug
   dev-client renders a dev-menu onboarding sheet AND a floating Tools FAB
   (expo/expo#44234, #45640). Neither is reliably suppressible at build time
   (`skipOnboarding` does not survive `pm clear`), and they occlude the login
   form. A custom dev-client also imposed a 49-min build, an ~11 MB unminified
   bundle that ANRs the JS thread on the CPU-only emulator, and a 14-min cold
   dev-launcher start.

2. **Emulator -> api networking on WSL2.** The login POST returned
   "Network request failed" although TCP connected. Neither the emulator host
   alias `10.0.2.2:3000` nor the LAN IP `192.168.x.x:3000` actually delivered an
   HTTP request to the Docker-published api port from inside the emulator
   (verified: the api container log showed NO request arriving). A plain `nc`
   handshake succeeding was misleading.

## Decision

Run the Android E2E against a **release build** (`./gradlew :app:assembleRelease`),
talking to the api over **`adb reverse` + a `localhost` base URL baked at build
time**, with cleartext HTTP enabled and expo-updates disabled.

The Maestro flow `launchApp`s the standalone package id
`com.fleetmanagement.driver` directly (no Expo container, no `exp://` openLink,
no dev-menu dismissal).

## Rationale

A release build excludes `expo-dev-menu` / `expo-dev-launcher` (they are
`debugImplementation`-only), so they are physically absent from the binary:
no onboarding sheet, no Tools FAB, no ANR, no dev-launcher, regardless of
`pm clear`. This is the upstream-endorsed answer (Maestro discussion #3041;
expo/expo#44234: "Perform a Release rather than a Debug build... it'll stop
bothering you. As a bonus, your tests will be more representative of what your
users see."). The release APK is also ~95 MB vs ~197 MB for the debug
dev-client, and boots to the login screen in ~20s.

`adb reverse tcp:3000 tcp:3000` tunnels the emulator's `localhost:3000` to the
host's api. This is the only address proven to deliver an HTTP request to the
container from inside the WSL2 emulator. With the tunnel up, the login POST
reaches the api (verified: host `localhost:3000` -> HTTP 400 = request arrived;
the screen progressed "Network request failed" -> "Lỗi đăng nhập (HTTP 403)" ->
green home as each layer was fixed).

Three build settings are required for a release build to talk to a local api:
- `usesCleartextTraffic: true` (via `expo-build-properties` in `app.json`):
  Android blocks cleartext HTTP in release by default; debug/Expo Go permit it.
- `expo.updates.enabled=false` (in `android/gradle.properties`): the release
  build uses the EMBEDDED bundle and skips the EAS Update OTA check that
  otherwise raced the cold start as "New update available...".
- `EXPO_PUBLIC_API_URL=http://localhost:3000` baked at build time:
  `getApiUrl()` returns this untouched on native (the 10.0.2.2->page-origin
  rewrite only fires on web, where `window` exists), so it routes through the
  adb-reverse tunnel.

## Alternatives Considered

- **Expo Go (vanilla SDK 55)**: rejected. Shows the onboarding sheet + Tools FAB
  after `pm clear`; none of the documented suppression switches work in Expo Go
  (they live in `expo-dev-launcher` native code Expo Go does not ship).
  Acceptable only as a flaky canary, not a deterministic gate.
- **Custom dev-client (`expo-dev-client` + prebuild + `assembleDebug`)**:
  rejected. Built and suppressed overlays on a CLEAN launch, but `skipOnboarding`
  does not survive `pm clear` (expo#45640), the ~11 MB unminified dev bundle
  ANRs the JS thread on the swiftshader emulator, and the cold dev-launcher
  start measured 14 minutes (`am start` TotalTime 848259ms). This just moved the
  same dev-menu problem into a far slower runtime.
- **`10.0.2.2` / LAN IP from the emulator**: rejected empirically. Neither
  delivered an HTTP request to the container on this WSL2 setup, despite a `nc`
  TCP handshake succeeding.

## Consequences

**Positive**: deterministic, overlay-free E2E that mirrors a production binary;
half the APK size; ~20s cold start; no Metro dependency at run time.

**Negative**: each app code change requires a release rebuild before the E2E
sees it (cached rebuilds ~1 min); the build is not hot-reloadable. The release
buildType signs with the debug keystore (installs without prod credentials);
this is for local/CI E2E only, NOT a distributable artifact.

**Neutral**: all native build config is driven from committed source, so a
fresh `prebuild` reproduces it with no hand-edits to the gitignored `android/`:
`usesCleartextTraffic` and `expo.updates.enabled=false` come from `app.json`
(via `expo-build-properties` and `updates.enabled: false` respectively). The
`values-b+vi` ExtraTranslation lintVitalRelease failure (expo/expo#38860, #40200:
`locales` emits orphan Android string resources from iOS `NS*` purpose strings)
was root-caused by scoping `locales` under `ios` in `app.json`, so the orphan
resource is no longer generated and no lint suppression is needed (verified: a
clean `lintVitalRelease` + `assembleRelease` passes RC=0). The 95 MB APK is NOT
committed; CI rebuilds it.

## Future Work

- **CI step** (when the E2E job is added to CI): build with the recipe in
  Verification, `adb reverse`, uninstall+install, seed an active driver, run
  `maestro test`. Do NOT commit the APK; gitignore `android/app/build/`.
- **`android/` commit-vs-gitignore** (separate decision): managed-workflow
  convention is to gitignore the generated native dir and regenerate via
  prebuild. The manual gradle edits survive prebuild, so gitignoring build
  OUTPUTS while keeping the edits documented here is sufficient.

## Verification

The release-build E2E is reproducible with the following steps (driver-app is
`apps/driver-app`; `$SDK` is the Android SDK root, e.g. `~/Android/Sdk`):

1. Build the release APK (cached rebuild ~1 min):
   ```
   cd apps/driver-app/android
   printf 'sdk.dir=%s\n' "$SDK" > local.properties
   EXPO_PUBLIC_API_URL=http://localhost:3000 NODE_ENV=production \
     SENTRY_DISABLE_AUTO_UPLOAD=true SENTRY_ALLOW_FAILURE=true \
     ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK" \
     ANDROID_NDK_HOME="$SDK/ndk/27.1.12297006" \
     ./gradlew :app:assembleRelease --no-daemon --console=plain
   ```
   (`SENTRY_*` skips the source-map upload that fails without `sentry-cli`.)

2. Tunnel the emulator to the host api:
   ```
   adb -s emulator-5554 reverse tcp:3000 tcp:3000
   ```

3. Reinstall (a debug->release variant change is signature-incompatible, so
   uninstall first):
   ```
   adb -s emulator-5554 uninstall com.fleetmanagement.driver
   adb -s emulator-5554 install \
     apps/driver-app/android/app/build/outputs/apk/release/app-release.apk
   ```

4. Seed an ACTIVE driver and keep it active for the run. `global-teardown.ts`
   soft-deletes (deactivates) E2E drivers after the Playwright suite (ADR
   rationale: a deactivated driver is filtered from the dispatcher form and
   admin list; it is NOT hard-deleted because the driver row is the parent of
   `passkey_credential` via an FK with no cascade). The Maestro run is a
   separate process launched AFTER teardown, so it must REACTIVATE its seed
   immediately before running:
   ```
   docker exec fleet-pilot-postgres-1 psql -U fleet -d fleet \
     -c "UPDATE driver SET active=true WHERE phone='<seeded-phone>';"
   ```
   (The deterministic dispatcher->driver proof is the in-process API assertion
   in `e2e/dispatcher-to-driver-fulfillment.spec.ts`; Maestro is a manual
   end-to-end canary on the real binary.)

5. Run the flow with the seeded credentials:
   ```
   MAESTRO_DRIVER_PHONE=<phone> MAESTRO_DRIVER_PASSWORD=<password> \
     maestro test apps/driver-app/.maestro/driver-login-assignment.yaml
   ```

The build-time invariants (cleartext, updates disabled, `launchApp` real
package id, no dev-menu dismissal, API URL reachable) are pinned by
`apps/driver-app/test/mobile-native-bundle-config.test.ts`.
