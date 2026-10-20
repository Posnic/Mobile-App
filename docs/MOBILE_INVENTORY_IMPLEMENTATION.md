# Mobile inventory pilot implementation

The mobile client and POS server must both support these APIs. See the [current user guide](USER_GUIDE.md) for operational steps. This document records implemented scope; it does not mark the complete inventory roadmap finished.

Mobile inventory is enabled by default when no policy exists. An explicit administrator disable survives upgrades. Configure **Core Settings → Inventory → Mobile inventory**, then refresh the phone's connection/catalogue. Existing explicit approval choices are preserved.

## Implemented

- Inventory is available through More; inventory-only staff land in Inventory without receiving sales permission.
- Server item lookup including inactive stock, category and supplier records, barcode/QR search, quantity/unit/supplier details and shared stock-log history.
- Paged catalogue reads and explicit offline download. Completed downloads replace the active cache atomically; interrupted downloads retain the previous cache.
- Persistent partial-count, direct-receiving, damage and loss drafts. Counted zero differs from an item never added to a count. Quantities use thousandths, with whole-unit validation.
- Server prepare/review/confirm/status/cancel endpoints. A durable request identity and atomic per-item effect prevent duplicate stock changes after a lost reply or restart. Conflicted operations report applied and unapplied lines separately.
- Current server ACL and branch/tenant checks, including approval policy rechecking at confirmation. An unchanged count uses an atomic expected-quantity/date/revision check; a changed item requires another observation. Pending sales on this phone block count confirmation.
- Direct confirmation by default. Administrators can require approval for selected actions under Core Settings → Inventory → Mobile inventory. Owners/admins approve in Inventory → Stock Counts or in the phone's operation history.
- Stock changes update the existing item balance and stocklogs; the normal POS sync transports these records. Operation journals remain on the issuing server and are never replayed against a different server.
- Mobile labels and messages in all 18 app languages (beta translations; native-speaker review remains necessary).

## Boundaries still requiring work

This is a pilot candidate, not the full roadmap. Purchase-order-linked receipts, carton conversion, low-stock/expiry action lists, scheduled/full-branch counts, manager recount assignments and large-catalogue performance measurements are not implemented in this increment. Product creation, label-photo assistance and opening stock are now implemented separately; see the user guide. Language packs are beta. Automated web/API checks do not certify physical devices or hardware.

Offline stock observations remain drafts. They do not modify a separate phone stock balance. Confirmation must reach the original server. The current stock system does not provide a global barrier proving that every other offline till has uploaded its sales; do not conduct final physical reconciliation while another till has outstanding offline activity. Cross-server concurrent stock reconciliation remains a core-sync limitation, not an app failover feature.

Operations accept at most 200 lines and reject excess explicitly; larger work must be split. Never clear app data with unsubmitted observations or ambiguous requests. Before reopening a frozen draft, the app cancels its original request identity on the server. A cancellation tombstone prevents a delayed submission from later applying that abandoned draft. If some lines applied, preserve that operation and recount only unresolved items.

## Verification

Local tests use a disposable MongoDB database, never production shop stock:

- API: `node --test api/tests/mobile-inventory.integration.cjs api/tests/mobile-pos.integration.cjs` (set `MONGOMS_SYSTEM_BINARY` when using an existing test mongod).
- Core sync classification: `node --test tests/sync-classification.test.js`.
- Mobile: `npm run check`, web export and Playwright tests including receiving/review/confirm and saved zero counts across restart.

Device acceptance still needs: offline count/restart, reconnect, interrupted confirmation, actual cashier/admin roles, branch isolation, fractional quantities, camera permission recovery and the installed desktop's sync behavior.
