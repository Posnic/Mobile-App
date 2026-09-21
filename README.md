# Posnic Mobile POS

A dedicated mobile till for Posnic, built with React Native, Expo and TypeScript.
This first implementation is an **alpha for local evaluation**, not a production
payment release. Start with **Try a training shop**. Practice transactions stay
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

- Visual item tiles, hidden numeric quick codes, camera scanning and amount-only sales.
- Integer-money checkout, cash received/change, optional customer, held carts and receipts.
- Transactional sale/outbox commits, retry identifiers, pinned shop/branch, review state
  and atomic catalogue snapshot replacement. Existing carts retain price snapshots.
- Permissions and offline grant expiry.
- Branch UPI account selection and amount-bound QR generation. Manual confirmation
  stays explicitly staff-confirmed; it never implies bank verification.
- Phone print-service receipts and a capability-gated till print-job client.
- All 18 language choices, Arabic direction, Tamil mobile translations, beta packs
  with visible coverage and English fallback.
- Isolated training shop for evaluation without a server.
- Account-first browser sign-in and free-trial signup, explicit device approval,
  authenticated local-till discovery, Community LAN/QR/code fallback and PIN unlock.

## Release work still required

The matching POS API implements bootstrap, one-use pairing, durable sale ingestion,
branch payments, device revocation and till receipt jobs. Live onboarding requires
features.mobilePosV1; a legacy server must be updated. Account sign-in also requires
the matching web-api, Gateway and website release. See the release notes for deployment status.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) and the required
[server contract](docs/MOBILE_API.md). Direct Bluetooth/USB printer drivers, provider-confirmed UPI/card payments and
native hardware QA remain release requirements. English and Tamil have all current
keys; the other 16 packs have partial mobile keys and need completion and language review.

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
See [connection and PIN unlock](docs/CONNECTION_AND_PIN.md) for Wi-Fi discovery,
remembered credentials, supported addresses and local PIN behavior.

Licensed under [AGPL-3.0-only](LICENSE). Inherited language strings come from Posnic
POS under the same license.
