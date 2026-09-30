# Independent offline counter beta

30 September 2026. Android `0.3.0-beta.3`, matching Windows `1.8.5-beta.2`.

## Included

- Android Bluetooth Classic SPP adapter using ESC/POS raster receipts at 384/576 dots (typical 58/80 mm profiles). Localized text is rendered on the phone. No generic NFC/card capture, USB or iOS direct adapter is included.
- More → Printing: choose Bluetooth, list devices already paired in Android settings, choose the exact printer, choose width, and run a test print. Names are paired device names, not proof of compatibility or connection health. The native option is absent from web/iOS and builds without the module.
- Cash sales and print intents are saved locally together when Bluetooth automatic printing is enabled. Printing does not depend on sale upload or on a reachable Till.
- A durable journal prevents concurrent or automatic repeated sends of the same receipt. Recovery after an interrupted send reports an uncertain outcome. An explicit, audited reprint requires the cashier to allow another copy.
- A successful Bluetooth write is submitted, not proof of physical paper output. Confirm the printed receipt after checking the paper. Resolve pending/uncertain print jobs before signing out.
- Direct print jobs cannot also enter the automatic Till queue. Printer failure does not discard the paid sale.
- POS → Mobile POS settings controls local receipt history: 90 days/10,000 acknowledged receipts by default. Both bounds apply; older records remain on the server. Bounds: 1–365 days, 100–100,000 receipts. Old clients omitting the new fields preserve existing values.
- Items are never subject to the receipt limit. Pending/review sales, outbox records and unresolved direct prints are protected. Till-queued receipts are conservatively protected until a separate final-status retention contract is implemented. Cleanup runs at startup and after a sync pass.
- Connection page exposes item count, local receipt count, unresolved direct jobs, offline-grant expiry and received history policy. New mobile text is supplied in all 18 bundled locales; language review remains welcome.

## Test on a phone

1. Install the Android beta and pair to a test branch. In Android Bluetooth settings pair an ESC/POS Bluetooth Classic SPP printer. Bluetooth LE-only printers do not use this adapter.
2. In More → Printing choose Bluetooth, list paired devices, select the printer and width, then print a test. Check alignment and all languages used by the shop before using real transactions.
3. Enable automatic printing. Turn off internet and shop Wi-Fi, keeping Bluetooth enabled. Add several items, accept cash and verify both the saved receipt and paper output.
4. Close/reopen the app and verify the saved sale remains. Reconnect to the shop; the sale should upload once without creating an extra Till receipt.
5. Switch off the printer before a sale. The sale must remain saved; after reconnecting, open its receipt and retry. Disconnect during a longer receipt: check the paper and use the explicit another-copy control only if needed.
6. Turn on the phone PIN and repeat lock/unlock and restart. Check permission denial, denied Bluetooth permission, wrong device selection and disabled Bluetooth.
7. Set a shorter history policy on the desktop test branch. Sync and restart. Acknowledged eligible receipts can disappear from local history, but pending sales and unresolved prints remain. Catalogue count must not shrink because of receipt retention.

Do not clear app storage or uninstall while sales are waiting to synchronize. This beta's APK uses the existing development signing certificate; Windows package is unsigned. These are pilot artifacts, not store releases or printer certification.

## Validation and boundaries

Software checks cover journal persistence, concurrent attempts, disk-write failure, restart uncertainty, explicit reprints, no dual Till delivery, localized raster source, protected cleanup, the 10,000-receipt boundary, server settings and existing sales/pairing flows. Native Kotlin compilation and Android release assembly are checked. Software tests cannot prove a particular printer's buffers, paper handling or Bluetooth firmware behaviour.

The wider roadmap remains open: USB/iOS/vendor adapters, paged/delta catalogue and resumable image caching, online older-receipt search, cloud delivery acknowledgments and cross-authority reconciliation, richer item selling options, and provider-verified electronic payments. Existing offline authorization remains 24 hours by default, configurable 1–72; it has not been silently extended. Existing cash/manual-UPI semantics and ACL remain in force.

Technical references: [Expo local modules](https://docs.expo.dev/modules/get-started/) and [Android Bluetooth connections](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices).
