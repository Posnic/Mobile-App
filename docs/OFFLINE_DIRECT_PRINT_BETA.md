# Independent offline counter beta

30 September 2026. Android `0.3.0-beta.4`, matching Windows `1.8.5-beta.3`.

## Included

- Android Bluetooth Classic SPP adapter using ESC/POS raster receipts at 384/576 dots (typical 58/80 mm profiles). Localized text is rendered on the phone. No generic NFC/card capture, USB or iOS direct adapter is included.
- More → Printing: choose Bluetooth, list devices already paired in Android settings, choose the exact printer, choose width, and run a test print. Names are paired device names, not proof of compatibility or connection health. The native option is absent from web/iOS and builds without the module.
- Cash sales and print intents are saved locally together when Bluetooth automatic printing is enabled. Printing does not depend on sale upload or on a reachable Till.
- A durable journal prevents concurrent or automatic repeated sends of the same receipt. Recovery after an interrupted send reports an uncertain outcome. An explicit, audited reprint requires the cashier to allow another copy.
- A successful Bluetooth write is submitted, not proof of physical paper output. Paper confirmation is optional for a normal submission. Queued, failed or uncertain jobs need resolution before signing out; a normally submitted job does not block sign-out or acknowledged-receipt retention.
- Direct print jobs cannot also enter the automatic Till queue. Printer failure does not discard the paid sale.
- POS → Mobile POS settings controls local receipt history: 90 days/10,000 acknowledged receipts by default. Both bounds apply; older records remain on the server. Bounds: 1–365 days, 100–100,000 receipts. Old clients omitting the new fields preserve existing values.
- Items are never subject to the receipt limit. Pending/review sales, outbox records and unresolved direct prints are protected. Till-queued receipts are conservatively protected until a separate final-status retention contract is implemented. Cleanup runs at startup and after a sync pass.
- More → Offline data is a dedicated screen showing item count, local receipt count, protected pending sales, catalogue refresh time, offline-grant expiry and received history policy. Connection & sync shows server-accepted and pending/review counts with receipt drill-down and a separate printer-attention list. Refresh gestures apply to these data screens. New mobile text is supplied in all 18 bundled locales; language review remains welcome.

- Receipts → Find an older receipt searches the signed-in cashier’s mobile receipts on the paired shop server. Searches are literal and paginated, 50 results at a time, newest first. Server receipt details are read-only; they do not enqueue another upload or print. Other cashiers and branches are excluded even when client parameters are altered. This does not expose all desktop sales.
- The app explicitly distinguishes server acceptance from cloud confirmation. The current server does not report downstream cloud acknowledgment, so the app never fabricates that status.

## Test on a phone

1. Install the Android beta and pair to a test branch. In Android Bluetooth settings pair an ESC/POS Bluetooth Classic SPP printer. Bluetooth LE-only printers do not use this adapter.
2. In More → Printing choose Bluetooth, list paired devices, select the printer and width, then print a test. Check alignment and all languages used by the shop before using real transactions.
3. Enable automatic printing. Turn off internet and shop Wi-Fi, keeping Bluetooth enabled. Add several items, accept cash and verify both the saved receipt and paper output.
4. Close/reopen the app and verify the saved sale remains. Reconnect to the shop; the sale should upload once without creating an extra Till receipt.
5. Switch off the printer before a sale. The sale must remain saved; after reconnecting, open its receipt and retry. Disconnect during a longer receipt: check the paper and use the explicit another-copy control only if needed.
6. Turn on the phone PIN and repeat lock/unlock and restart. Check permission denial, denied Bluetooth permission, wrong device selection and disabled Bluetooth.
7. Set a shorter history policy on the desktop test branch. Sync and restart. Acknowledged eligible receipts can disappear from local history, but pending sales and unresolved prints remain. Catalogue count must not shrink because of receipt retention.

8. Open More → Offline data and verify the catalogue, expiry and history limits. Open Connection & sync, then a pending receipt or printer-attention entry. Return to Sell and verify an unfinished basket is unchanged.
9. After synchronizing a sale, open Receipts → Find an older receipt. Search its receipt number or customer name. Open a result and confirm the total. Test a read-denied cashier and an unreachable server; local selling/history must remain intact.

## Mockup implementation map

| Design journey | Application entry point |
| --- | --- |
| Offline counter | Sell, using the saved branch catalogue |
| Cash payment | Cart → Take payment → Cash |
| Saved receipt | Sale completion and Receipts |
| Direct printer | More → Printing → Bluetooth (Android native) |
| Printer attention | Connection & sync → Check the paper; explicit confirmation/reprint on receipt |
| Sync centre | Connection & sync, receipt drill-down and refresh |
| Receipt history | Receipts, local search and server older-receipt search |
| Offline data | More → Offline data |
| Desktop settings | Mobile POS module: retention, offline access and printer route guidance |

Mockup example storage usage, downloaded-thumbnail badges and cloud confirmations are not displayed as real facts. Resumable image caching and cloud acknowledgments remain wider-roadmap work. The desktop printing policy uses the existing receipt Till assignment; no setting was added to a Features card.

Do not clear app storage or uninstall while sales are waiting to synchronize. This beta's APK uses the existing development signing certificate; Windows package is unsigned. These are pilot artifacts, not store releases or printer certification.

## Validation and boundaries

Software checks cover journal persistence, concurrent attempts, disk-write failure, restart uncertainty, explicit reprints, no dual Till delivery, localized raster source, protected cleanup, the 10,000-receipt boundary, server settings and existing sales/pairing flows. Native Kotlin compilation and Android release assembly are checked. Software tests cannot prove a particular printer's buffers, paper handling or Bluetooth firmware behaviour.

The wider roadmap remains open: USB/iOS/vendor adapters, paged/delta catalogue and resumable image caching, cloud delivery acknowledgments and cross-authority reconciliation, richer item selling options, and provider-verified electronic payments. Existing offline authorization remains 24 hours by default, configurable 1–72; it has not been silently extended. Existing cash/manual-UPI semantics and ACL remain in force.

Technical references: [Expo local modules](https://docs.expo.dev/modules/get-started/) and [Android Bluetooth connections](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices).
