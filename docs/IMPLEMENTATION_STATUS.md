# Implementation status — 1 October 2026

## Current delivery

Android `0.3.0-beta.9` with Windows `1.8.5-beta.6` is the independent offline counter
pilot. All nine approved offline screen journeys are implemented in the application
and matching POS module. Installation, screen mapping and failure checks are in
[the test guide](OFFLINE_DIRECT_PRINT_BETA.md). This is a test distribution, not a
claim that every hardware/provider or future selling feature is finished.

| Area | Implemented and checked | Remaining scope |
|---|---|---|
| Selling | Compact visual tiles, local search/PLU/barcode, quick amount, cash/change, optional customer, hold/resume, receipts; explicit weighed-item quantity entry and units | Variants, modifiers, controlled discounts/price overrides, compound taxes, refunds and split tenders |
| Offline | Atomic sale/outbox/print intent; bounded paged catalogue activation; indexed Android lookup; persistent images; protected 90-day/10k receipt defaults; server history search | OS background scheduling and wider production-scale benchmarks; physical encrypted-storage interruption testing |
| Pairing | Cloud account consent/free-trial return, authenticated LAN discovery, QR/address/code fallback, secure remembered credentials, PIN recovery, revocation and ACL | Physical network qualification and broader credential lifecycle work |
| Payments | Cash; branch-administered UPI accounts/default/selection; amount QR; explicit unverified staff confirmation | Provider-confirmed attempts, terminal/Tap to Pay adapters, refunds and uncertain-payment recovery |
| Printing | Android Bluetooth Classic SPP/USB printer-class ESC/POS; OS/Till alternatives; durable direct journal; explicit uncertain-outcome recovery; opt-in cash drawer; Till status reads | iOS/vendor adapters and qualification on actual printers/drawers; generic USB does not support every vendor protocol |
| Sync | Durable idempotent sale/customer/stock effects; local/server/cloud receipt states from explicit evidence | Independent-ledger failover and broader cross-authority reconciliation |
| Management | Customer attached to sale under ACL; minimal item creation in training | Version-checked live item/price writes and expanded existing-customer search |
| Languages | All 18 bundled POS locales, including beta packs; persistent choice, Arabic direction, localized quantity parsing | Native-speaker review and physical thermal-font qualification |

The native database is SQLCipher SQLite; the browser preview uses IndexedDB and
memory-only credentials. The public Android APK retains the existing development
certificate and the Windows installer is unsigned. Neither software tests nor a
transport write certify physical paper delivery or received electronic funds.

See the [control-by-control mockup audit](MOCKUP_IMPLEMENTATION_CHECKLIST.md) for both approved galleries and linked screens. Beta9 adds scoped offline favourites and correct full-catalogue image readiness. The desktop installer is unchanged from beta8.

## Verification

- 74 mobile unit tests, 36 browser scenarios and 23 real mobile/POS integration
  cases pass. Strict TypeScript, formatting and attribution checks pass.
- Matching POS: 11,585 API tests pass (13 skipped), 3,639 desktop tests pass
  (5 skipped). Gateway/signed-component receipt evidence: 215 tests pass.
- Tests include 10,017 catalogue items, old-schema migration, lookup beyond the
  visible page, Unicode search, interrupted/duplicate activation rollback,
  stale-price selection, restart persistence, repeated uploads, quantity ACL,
  weighed-item stock replay, cached images and cloud receipt evidence.
- Android release assembly and Windows payload/source verification pass. No
  physical printer, terminal or attached weighing machine is certified here.
- Cloud receipt labels require gateway protocol 1 and signed sync component 1.7.3,
  published to assigned beta-channel cloud tenants. Community installs retain
  server-only acknowledgment. No automatic independent-ledger failover is enabled.

## Current contracts

Money uses integer minor units for supported two-decimal currencies and one rate
per line. Piece-count quantities remain integral. Weight-machine-based items with
a configured selling unit are explicitly negotiated (`quantity=fixed3`) and allow
three decimals; the phone asks for entered weight and does not infer it from a
normal barcode or claim a live scale adapter. Other unsupported item configurations
remain blocked. Paid/held snapshots preserve the grant that issued their prices.

[API contract](MOBILE_API.md), [devices](DEVICES.md), [ACL](ACCESS_CONTROL.md) and
[offline test guide](OFFLINE_DIRECT_PRINT_BETA.md) describe the implemented scope.
The wider roadmap remains a backlog, not an assertion of delivered capability.

## Historical repairs

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
