# Implementation status — 22 September 2026

## Current delivery

React Native / Expo application source is implemented in this repository. This is
an alpha for evaluating the approved selling flow, not a completed production POS
release. The browser preview runs the same UI with IndexedDB; native builds use
SQLCipher SQLite and SecureStore. The matching POS desktop test build includes the Mobile POS server integration. Version 0.2.0 adds browser account approval, free-trial return handling and authenticated local-till discovery. Consult release notes for actual deployment status.

| Area | Implemented now | Required before release |
|---|---|---|
| Selling | Visual tiles, compact scan/keypad icons, internal PLU lookup, quick amount, cash/change, optional customer, hold/resume, receipts | Modifiers, variants, weighted quantities, complex taxes, refunds, split tenders and reconciliation |
| Offline | Atomic local checkout/outbox, retry identity, persisted cart and sale history, permissions/expiry, pinned authority, snapshot refresh | Native interruption/encryption tests, background sync, catalogue/image scale testing, server ingestion |
| Pairing | Account browser approval, phone-bound grants, LAN discovery, QR/address/code fallback, PIN, revocation and capability checks | Seamless token renewal, changed-IP recovery and physical-device transport QA |
| Payments | Cash, branch UPI account selection and amount QR, explicit staff confirmation | Branch account administration in POS, verified UPI attempts, terminal providers/readers, uncertain-payment recovery |
| Printing | Escaped localized HTML receipts, OS print service, separate test document, till-job client | Real printer drivers, delivery tracking, durable offline queue, audited reprints and multilingual hardware QA |
| Minimal management | Local customer attached to sale; training-only item creation with PLU uniqueness | Version-checked live item/price writes, server customer deduplication and existing customer search |
| Languages | All 18 choices; English/Tamil complete current keys; other 16 partial beta packs; Arabic direction | Beta completion and native-speaker review; thermal-printer font coverage |
| Training | Isolated sample shop; no live upload; explicit practice-data clearing to return to onboarding | Additional fixtures for complex retail/hospitality cases |

The matching POS backend implements the mobile API. Enable the branch under
Settings → Features in the updated desktop build. Browser account consent also enables the matched branch. Live connection remains gated
by features.mobilePosV1 so older servers are refused. See [MOBILE_API.md](MOBILE_API.md).

## Verification

- TypeScript strict check, formatting and attribution checks passed; 30 domain/
  repository/SQLite/vault/connection tests and 8 browser scenarios passed. The matching server integration has 15 passing real MongoDB/browser tests, including account onboarding to cloud and LAN.
- Domain/repository tests cover duplicate checkout, commit failure, cash underpayment,
  offline permission expiry, held carts, durable retry/review, tenant-pinned catalogue
  replacement, receipt escaping, UPI URI binding and practice-data clearing.
- Browser tests cover cash checkout while offline, persistence across reload,
  hidden codes, numeric lookup, quick amount, hold/resume, Tamil persistence,
  Arabic selected-state accessibility and narrow-screen layout.
- Production web export passed. The web preview is not an offline-installed PWA.
- Android ARM64 release-variant compilation succeeded with SQLCipher enabled. This
  local evaluation APK uses the generated debug signing key, not production signing.
  No working Android device was attached (ADB reported an offline emulator).
- iOS, camera hardware, encrypted-storage runtime, printers and payment readers have
  not been tested on physical devices.

## Integration order

1. Implement and test the authenticated bootstrap/device grant and atomic sale
   ingestion contract in POS using existing domain/accounting services.
2. Test real offline recovery, duplicate server submission and revoked-device flows.
3. Add branch UPI account administration and a selected payment-provider adapter.
4. Implement direct printer support for the chosen models and till delivery tracking.
5. Finish language packs, reconciliation, accessibility and field testing before beta.

Printer model/connectivity and payment provider/reader details are still required
for hardware-specific adapters. Generic platform printing is not universal thermal
printer support, and a QR display is not a confirmed payment.

## Known engineering limits

This alpha uses two-decimal currencies, whole quantities and one tax rate per line.
Unsupported currency bootstrap data is rejected. Large catalogues use cached local
records and bounded pages; performance targets have not yet been benchmarked at
production scale. Receipts and customer lists need pagination/retention policy.
Native HTTP LAN access and mDNS permissions must be validated rather than assumed
from the URL parser. There is no automatic LAN/cloud write failover.

The dependency audit reports 10 moderate findings, all flowing from the build-tool
xcode/uuid chain. No high/critical findings were reported. npm's suggested force fix
downgrades the Expo SDK across incompatible major versions, so it was not applied.
Resolve the upstream build-tool advisory before distributing signed releases.

## 0.1.1 — native startup repair

The first-run settings save used Expo’s exclusive transaction helper, which opens
a second connection. The SQLCipher key had only been set on the original
connection, so the new connection could not read the encrypted records table.
The native adapter now owns one unlocked connection and serializes all reads and
transactional writes on it. It preserves the database, encryption key and schema.

Startup failures now stop the spinner, show a non-sensitive stage code and offer
Retry. Added real SQLite tests for first-run writes, reopen persistence and failed
transaction rollback, a language-detection compatibility check, plus a browser
startup-failure/retry scenario. These tests
do not replace SQLCipher runtime testing on a phone.

Version 0.1.1 uses Android versionCode 2 and the same application ID. Install the
update over 0.1.0; do not uninstall or clear storage.

## 0.1.2 — connection shortcuts and local PIN

Implemented the compact server field with LAN/QR/pair-code shortcuts, native
Wi-Fi subnet discovery, address normalization and secure remembered credentials.
Added local PIN setup/unlock, background lock, persisted attempt limits and
same-account password recovery. See [connection/PIN details](CONNECTION_AND_PIN.md).
Actual Wi-Fi and PIN persistence on the user’s phone still require verification.

## 0.1.3 — live POS integration

The matching POS build adds Settings → Mobile POS, device pairing codes, catalogue
and offline grants, durable sale ingestion, branch UPI accounts, receipt queue
routing and interrupted-sync review. Ten real-database/browser integration tests
cover the complete mobile sign-in → offline cash sale → desktop Sales flow.
Till print requests are persisted locally and sent after sale acknowledgement.
Cart lines retain the catalogue that issued their prices. The web fetch receiver
bug discovered by the live UI test is fixed. See POS/docs/MOBILE_POS_TESTING.md
for test instructions, replay retention and remaining hardware/provider scope.
