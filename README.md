# Posnic Mobile POS

A dedicated mobile till for Posnic, built with React Native, Expo and TypeScript.
This is an **independent offline counter beta for pilot testing**.
Start with **Try a training shop**. Practice transactions stay
on the device and are never uploaded.

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

## Implemented

- Persistent cashier/branch favourites with compact star controls.
- Visual item tiles, hidden numeric quick codes, camera scanning and amount-only sales.
- Integer-money checkout, cash received/change, optional customer, held carts and receipts.
- Transactional sale/outbox commits, retry identifiers, pinned shop/branch, review state
  and atomic catalogue snapshot replacement. Existing carts retain price snapshots.
- Permissions and offline grant expiry.
- Branch UPI account selection and amount-bound QR generation. Manual confirmation
  stays explicitly staff-confirmed; it never implies bank verification.
- Direct Android Bluetooth Classic/USB printer-class ESC/POS, optional printer-connected
  cash drawer, durable print recovery, OS print service and Till receipt status.
- Indexed offline product browsing/scanning, atomic persisted-page activation, cached
  product images and protected receipt retention. Items have no receipt-history cap.
- Explicit quantity entry for configured weighed items, localized decimals and receipt units.
- Cloud receipt status backed by an explicit gateway acknowledgment; community installs
  retain shop-server acknowledgment.
- All 18 POS languages with complete mobile message coverage, Arabic direction,
  localized receipts and offline language packs. Translations remain beta pending
  native-speaker review; shop-entered product names are preserved.
- Isolated training shop for evaluation without a server.
- Pull-to-refresh on data lists, receipt swipe navigation, platform back handling,
  keyboard dismissal and accessible button alternatives. See the
  [gesture inventory and device checks](docs/MOBILE_GESTURES.md).
- Account-first browser sign-in and free-trial signup, explicit device approval,
  authenticated local-till discovery, Community LAN/QR/code fallback and PIN unlock.

## Release work still required

The matching POS API implements bootstrap, one-use pairing, durable sale ingestion,
branch payments, device revocation and till receipt jobs. Live onboarding requires
features.mobilePosV1; a legacy server must be updated. Account sign-in also requires
the matching web-api, Gateway and website release. See the release notes for deployment status.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) and the required
[server contract](docs/MOBILE_API.md). The [offline test guide](docs/OFFLINE_DIRECT_PRINT_BETA.md)
maps all nine approved offline designs to implemented screens. Provider-confirmed UPI/card
payments, iOS direct adapters, richer selling options and physical hardware qualification
remain separate roadmap work. All language packs have every current
mobile key; native-speaker review and physical-device font checks remain outstanding.
See [language support](docs/LANGUAGES.md).

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

See the [research and roadmap](docs/MOBILE_POS_ROADMAP.md) for the approved direction.
See [Devices](docs/DEVICES.md) for external scanning, printer setup and Till receipt status.
See [connection and PIN unlock](docs/CONNECTION_AND_PIN.md) for Wi-Fi discovery,
remembered credentials, supported addresses and local PIN behavior.

Licensed under [AGPL-3.0-only](LICENSE). Inherited language strings come from Posnic
POS under the same license.
