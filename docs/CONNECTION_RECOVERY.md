# Mobile connection and recovery contract

## User-selected connection

Wi-Fi and Internet are explicit choices. The app does not automatically switch between independent local/cloud servers. Discovery locates servers but does not authenticate them. Each saved endpoint has its own session and must match the expected shop, branch and cashier. Never infer identity or trust from a similar shop name alone.

## Pending work belongs to its ledger

Checkout persists the sale and outbox atomically before clearing the basket. Reconnection retries the original sale identity; a timeout may mean the server committed it but the response was lost. Authentication refusal, permission denial and conflicts need attention rather than a different destination.

Pending sales/print work and active or parked baskets prevent unsafe movement to an independent ledger. Receipts and inventory drafts remain endpoint-scoped. Server-to-cloud replication is the core sync service's responsibility, not mobile route switching. A connected phone does not prove all tills have synchronized.

## Same-ledger address recovery

An authenticated bootstrap can advertise `shop.connection` metadata with `local`, `remote` and `idempotencyScope`. Only advertise a shared scope when both addresses use the same atomic sale-ID deduplication ledger. Matching tenant names or eventually replicated stock tables are insufficient.

Any supported address recovery must verify shop, branch, staff, sales capability and shared scope before sending pending work. An independently writable till and cloud database must not claim this invariant merely because they synchronize. Keep the original authority and retry IDs; never replay an inventory operation against another server.

## Offline boundaries

First authorization and catalogue download need a reachable compatible API. Offline actions use a time-limited server grant; a local PIN cannot renew it. Browser previews use IndexedDB; native devices use encrypted SQLite. No storage clearing is part of recovery.

Verify manual Wi-Fi/Internet selection, unavailable endpoints, different identities, pending baskets, expired grants, lost responses, reconnect and core replication separately. Browser fixtures cannot prove real hotspot discovery, native persistence or deployed multi-till behavior.
