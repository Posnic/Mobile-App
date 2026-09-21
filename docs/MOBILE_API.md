# Mobile POS API contract

Status: client and matching POS server adapter implemented for 0.1.3 testing.
Desktop location: Settings → Mobile POS. Remote servers must deploy the same API.
Paths are relative to the chosen server's `/api` base. Do not advertise the mobile
capability until complete sale ingestion passes integration tests.

## Runtime and authentication

`GET /runtime-info` returns edition (community/cloud), numeric apiSchema and
`features.mobilePosV1: true`. A URL/QR locates a server; it does not authorize access.
Password login consumes `POST /users/kioskMobileLogin` with username/password.
Code enrolment consumes `POST /mobile/v1/pair` with `{code}`. Both return `{token}`.
The server must scope and bind credentials to a device, branch and staff principal.
Pair codes must be short-lived, single-use, rate-limited and consumed atomically.
Issuance/settings belong on the Captain/Mobile module page, never Features switches.

Native bearer tokens use SecureStore; browser preview tokens are memory-only.
Credential renewal, revocation and re-authentication UX remain release work.

## Bootstrap and catalogue

`GET /mobile/v1/bootstrap`, authenticated, returns `{shop, items}`. The runtime
schema is `bootstrap` in `src/services/api.ts`; models are in `src/domain/types.ts`.

- Stable server IDs identify tenant, branch, staff and items.
- `offlineUntil` is a UTC expiry for offline permissions; `snapshotVersion` identifies
  a consistent, complete catalogue snapshot.
- Explicit permissions: sell, quickSale, customerWrite, itemWrite, priceOverride,
  manualUpi. Unsupported actions remain false.
- Prices use integer minor units, tax uses basis points. This alpha supports whole
  quantities, two-decimal currencies and one tax rate per line. Return complex
  items with requiresConfiguration until their options/tax support is implemented.
- Item code maps to existing plu_code and preserves leading zeroes. Codes are never
  displayed on sale tiles. Duplicate shortcut matches require selection.
- Branch UPI accounts carry stable ID, name, VPA, active flag and manual/provider
  verification mode. Exactly one active default must be enforced by the server.
  Provider accounts cannot collect until verified attempt handling is implemented.
- Capabilities: saleSync, devicePairing, tillPrint, terminal. Only advertise a
  capability when its complete implementation is available.

The client atomically replaces the catalogue and grants, pins authority/shop/branch/
staff and preserves existing cart and paid-sale snapshots. Refresh failure leaves
old data intact. The worker runs every 30 seconds while foregrounded and on resume.
Delta sync, authenticated image caching and OS background work remain outstanding.

## Sale ingestion

`POST /mobile/v1/sales` takes `{idempotencyKey, sale}`. Key equals immutable local
sale ID. The response is:

```json
{"saleId":"local-id","serverId":"canonical-id","shopId":"shop-id","branchId":"branch-id"}
```

Required server guarantees:

1. Resolve tenant/branch/device/staff from validated credentials and cross-check the
   payload and offline grant. Never trust caller identity fields alone.
2. Validate currency, item and price snapshots, tax and tender. Recalculate totals.
   Record legitimate offline conflicts for reconciliation without recollecting money.
3. Uniquely index tenant/branch/device/sale identity and persist a payload hash.
   Identical retries return the original response; changed payload with the same key
   returns 409. Deduplication records outlive every retry window.
4. Durably record the sale intent, then complete idempotent sale/customer/stock
   and stock-audit effects before acknowledgement. Standalone MongoDB uses a
   resumable journal rather than a cross-document transaction. Interrupted effects
   remain visible in desktop Mobile POS settings for recovery.
5. Cash is staff-recorded cash; manual UPI remains staff-confirmed and separately
   reconcilable. A screenshot, callback URL, reference or checkbox is not bank proof.

The client retains paid receipts on failure, backs off transient errors, and sends
400/403/409/422 to review. It never replays to a different LAN/cloud host. Multi-host
failover needs verified server topology and shared deduplication first.

## Printing

`POST /mobile/v1/print-jobs` accepts receipt jobs:
`{id: "receipt:<sale-id>", saleId, document: "receipt"}` or test jobs:
`{id: "<unique-test-id>", document: "test"}`. Receipt retry IDs are stable.
The server owns templates, routing, spooling and reprint audit. This alpha submits
jobs but does not track delivery or support explicit authorized reprints. Durable
offline till routing therefore remains incomplete.

Phone printing uses the OS print service. Bluetooth/USB/BLE/raw TCP drivers are
separate integrations requiring hardware, font, retry and ambiguous-delivery tests.

## Remaining contracts

Device lifecycle/renewal, sale reconciliation, print outcomes, provider payment
attempts/status queries, refunds, split tenders, catalogue deltas/images, item and
price writes with version checks, customer deduplication and authenticated LAN
discovery. Heavy configuration stays on the server/till.

### 0.1.3 additions

Password/code login includes a persistent `device` descriptor. Sales include
`snapshotVersion`; individual cart lines retain their own snapshot version so a
held price survives catalogue refresh. `/settings`, `/pair-codes`, `/devices/revoke`
and `/recover` are authenticated desktop administration endpoints. Pair codes are
single-use with a five-minute expiry. Till receipt requests are durable on the
phone until accepted by the server queue. Physical printing is not acknowledged
by the phone merely because the queue accepted a job.
