# Development and device builds

## Run

Requires Node.js 22+, npm and, for Android, a configured Android SDK and JDK.

```sh
npm ci
npm run build:web
node scripts/serve-preview.mjs
```

The browser preview uses IndexedDB and is for UX evaluation. Native builds use
SQLCipher SQLite with a key in the OS secure store. **Expo Go is not supported**
because its SQLite build does not provide this encryption setup.

```sh
npx expo prebuild --platform android
npm run android
```

iOS uses the same source but requires macOS/Xcode and device testing. Native
project directories are generated from app.json and are not committed.
Do not uninstall or clear storage on a device with unsynced sales.


## iPhone and iPad TestFlight builds

Run the manually dispatched **iOS TestFlight** workflow in GitHub Actions. It runs
the checks, generates the Expo iOS project on a Mac runner, signs an App Store
archive and uploads it to Apple. It does not publish to the public App Store.

The Apple app is `6818860892`, bundle `com.posnic.mobile`, team `VMG89YGXKR`.
The pilot tester group is **Posnic POS Pilot**. After Apple finishes processing,
resolve any export-compliance questions, assign the processed build to that group
and verify that the tester is invited. An uploaded build alone is not confirmation
that testers can install it.

Required repository secrets: `IOS_CERT_P12` (base64), `IOS_CERT_PASSWORD`,
`IOS_APPSTORE_PROVISIONING_PROFILE` (base64, specifically for `com.posnic.mobile`),
`ASC_API_KEY_ID`, `ASC_API_ISSUER` and `ASC_API_KEY_P8`. Signing files stay outside
the repository; the temporary Mac keychain and API-key file are cleaned after use.
The workflow uses a unique numeric build number for each run/attempt. The separate
numeric `ios.version` must be updated when releasing a new iOS marketing version.

The iOS build uses the system print dialog and configured Till printing; the direct
Bluetooth Classic/USB ESC/POS adapter is Android-only. Validate local-network
permission, camera scanning, offline catalogue/sales, PIN and receipts on an iPhone
before treating an uploaded build as production-ready.

## Checks

```sh
npm run check
npm run format:check
npm run build:web
npx playwright install chromium
npm run test:e2e
```

Tests cover transaction failure/retry, money, tax, permissions, catalogue replacement,
receipt escaping, persisted checkout, offline cash, hidden codes, hold/resume and
language changes. Native storage, printer and terminal tests must run on devices.

See the [research and roadmap](MOBILE_POS_ROADMAP.md) for the approved direction.
See [Devices](DEVICES.md) for external scanning, printer setup and Till receipt status.
See [connection and PIN unlock](CONNECTION_AND_PIN.md) for Wi-Fi discovery,
remembered credentials, supported addresses and local PIN behavior.

Licensed under [AGPL-3.0-only](../LICENSE). Inherited language strings come from Posnic
POS under the same license.

