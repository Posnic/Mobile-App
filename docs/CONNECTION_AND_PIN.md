# Connection and optional PIN

[Back to README](../README.md) · [Everyday use](USER_GUIDE.md)

## Posnic Cloud

Choose **Sign in** or **Create account · Free trial**, complete the browser flow and approve this phone. Return to the app to finish authorization and download the catalogue. First login goes directly into the app; a PIN is optional. Cloud signup requires working account provisioning, and existing-shop approval requires the matching account/gateway and POS services.

## Your own server or local till

Choose **Connect a local or Community shop**. Find the server on Wi-Fi and select its shop card, or use **Other ways to connect** for shop QR, pairing code or server address. Enter credentials only after selecting the server. A short pairing code alone cannot locate the server; provide its address too.

Addresses can be a shop code, hostname, private IP or full URL. For example, `192.168.1.20` becomes `http://192.168.1.20:5555/api`; an explicit port is retained. Use the till's current address, not `localhost` or a previous network's address. Public HTTP addresses upgrade to HTTPS. Pairing codes are sent only to the selected shop.

The server must advertise `mobilePosV1`. In desktop settings, enable the Mobile POS feature and configure branch/device access in its module/device setup. Permissions come from the selected staff account. Updating only the phone cannot add missing APIs to an old server.

## Switching connections

The header has separate **Wi-Fi** and **globe** buttons. Tap to select a remembered local or Internet connection. The app does not automatically switch between independent servers. QR/code/address choices are grouped under **Other ways to connect**. A Cloud-authorized nearby till may offer one-time device authorization without asking for its password again.

Each endpoint retains its own session. The app checks shop, branch and cashier identity. Finish or resolve pending sales, print requests and baskets before changing independent ledgers. Stock drafts and receipts stay with their original server. If a till's IP changes, use connection setup to locate it again; do not clear local data. See the [recovery contract](CONNECTION_RECOVERY.md).

## Discovery and local networking

Wi-Fi discovery runs in the installed phone app. It probes the current private
IPv4 /24 on ports 5555, 5000 and 80, with bounded concurrency, timeouts and cancel.
Only matching runtime-info responses appear as Posnic servers. No credentials are
sent during discovery. Larger subnets, isolated guest Wi-Fi, IPv6-only networks,
custom ports and blocked firewall rules may require manual address entry. Browser
preview explains that it cannot discover the phone's LAN. Discovery results locate
servers; they do not grant trust or bypass sign-in/capability checks.

The remembered account (username, password, address and token) uses OS SecureStore
on native devices. Optionally set a 4–6 digit unlock PIN under More. Mobile
ports the local-unlock rules from POS/src/pin-lock.js; it does
not reuse a manager approval PIN or transfer a desktop device's PIN record.

New native PIN enrollment uses PBKDF2-HMAC-SHA256 with 600,000 iterations on a
background worker (CommonCrypto on iOS, Java crypto on Android). It encrypts the
remembered account with AES-256-GCM,
random salt/nonce and an install secret, then removes the unwrapped stored account
and legacy token. Backgrounding or Lock now drops the unlocked key/token from the
vault. The PIN never goes to the server. Five failed attempts require a fresh
password login for the same shop, branch and staff identity; paid sales and the
local database are retained. Existing OS-protected database encryption remains
independent of the PIN. No biometric dependency is added.

Records identify their key-derivation algorithm; existing untagged scrypt records
retain the legacy derivation path. A failed first enrollment preserves the signed-in
account and does not save a partial PIN. The first iOS pilot used the JavaScript
scrypt path and could time out; the native module fixes new iOS enrollments.

Cloud browser authorization waits for the mobile app to return to the foreground
before exchanging the one-use grant or pairing with the shop. Safari background
suspension must not consume a grant while the app cannot receive the response.
Cancellation removes the foreground listener; returning after expiry requires a
fresh authorization. The app does not blindly retry consumed one-use credentials.

The browser preview keeps vault secrets in memory only. Native persistence and
Wi-Fi discovery must be exercised on a phone; simulated discovery, SQLite,
cryptographic vault and browser interaction tests are not physical-device tests.

See [manual switching and safe recovery](CONNECTION_RECOVERY.md). Discovery never grants permission or proves two servers share one sales ledger.
