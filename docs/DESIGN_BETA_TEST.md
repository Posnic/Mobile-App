# Mobile POS design beta — end-user testing

## Matched builds

- Android: **0.3.0-beta.2**, version code **11**, `com.posnic.mobile`; Android 7 or newer, ARM64.
- Windows Till: **1.8.5-beta.1**, x64 test installer.
- Local files: `artifacts/pilot-0.3.0-beta.2/` in the Mobile-App checkout.

The Android APK uses the existing local test certificate, so it can update a previous beta signed with that certificate. It is not a Play Store production release. The Windows installer is unsigned. No iOS binary was produced on Windows; iOS native device validation and signing remain separate release gates.

## What is implemented

The approved visual direction is now in the React Native app: warm white and teal surfaces, dark mode, official Posnic branding, compact visual product tiles in two columns on phones, a fixed sale total, three main navigation tabs, and icon rows for setup and devices. Held sales remain available in More and after holding a sale.

Cloud sign-in and free-trial creation use the real browser authorization flow. Local setup presents Wi-Fi search, shop QR, pairing code and manual address choices before asking for connection details. QR pairing can carry the staff authorization code as well as the server address. PIN unlock includes a keypad, password recovery and switch-user access.

Checkout has a payment selection screen. Cash and configured staff-confirmed UPI retain their existing validation. Receipts can be searched, refreshed, browsed and printed using the phone service or configured Till. Staff permissions, offline storage and sync are retained.

The Windows Mobile POS setup and branch payment pages share the new visual style. Features remains switches only. A manager chooses the staff identity before generating a single-use QR/code; the QR returns to ordinary shop connection after expiration or a staff selection change.

## Start here

1. Keep a current shop backup, close the running Till, and install the matched Windows beta. It uses the existing shop and staff accounts; this build creates no new default password.
2. Open **Settings → Features**, and enable **Mobile POS** for the branch.
3. Open **Settings → Mobile POS**. Select the staff account and **Generate pairing code**. Keep the chosen shop network reachable from the phone.
4. Install/update the Android APK. Choose **Connect a local or Community shop → Scan shop QR**. Scan the authorization QR on the desktop, confirm pairing, and set a PIN.
5. For an independent UI walkthrough, choose **Try a training shop**. Practice sales stay on the phone and do not update your shop.

## Acceptance walkthrough

- **Setup:** verify Wi-Fi discovery, QR pairing, code entry and a typed IP/domain. Confirm a used or expired code cannot pair another phone. Cloud accounts can separately exercise browser approval.
- **Permissions:** pair a restricted cashier, not only an owner. Check customer creation, line removal, quick sales and receipt printing respect that staff account.
- **Sales:** add products repeatedly, use a quick amount and optional description, adjust permitted quantities, hold/resume a sale, and collect cash with correct change.
- **UPI:** configure branch recipients and a default in Branch payments. Check the amount and selected recipient on the phone. Only confirm after checking money arrived; a displayed QR is not payment confirmation.
- **Offline:** disconnect Wi-Fi after pairing, complete a sale, close/reopen the app and unlock. Reconnect and verify one matching sale on the Till. Do not uninstall or clear app storage while sales await sync.
- **Receipts:** search by receipt/customer, refresh, use previous/next or supported swipe navigation, and request a receipt from the chosen print route. Refresh the Till print status and check the actual paper.
- **Scanner:** try camera barcodes/product QR. For a hardware scanner, pair keyboard/HID mode in phone settings with Enter suffix. Repeatedly scan one item and verify the exact quantity. `POSNIC-DEMO-11` selects training coffee. Leaving the scanner or deliberately blurring its input clears an incomplete scan; ordinary scrolling no longer interrupts input.
- **PIN:** lock/unlock, enter a wrong PIN, try account-password recovery, and verify switch-user explains any outstanding work before disconnecting.
- **Display:** try a small phone, large text, dark mode, your staff language and Arabic layout. Confirm controls remain readable and scrollable.

## Verified before handoff

- TypeScript, formatting and attribution checks.
- 50 unit tests; 31 browser workflow tests including the language scenarios.
- 10 repeated scanner browser runs covering rapid/repeated input and blur behavior.
- 21 POS API/integration tests with an isolated database and real browser setup, offline sale sync and cloud/LAN authorization flows.
- Android release compilation, APK signature and version metadata.
- Windows package source matching and packaged database/printer/archive dependency loading.

## Hardware boundaries

This build supports camera scanning, keyboard/HID scanner input, the operating system print service and configured Till printing. Physical devices still need the walkthrough above. Direct Bluetooth/USB printer drivers, cash-drawer control from the phone, integrated card terminals, NFC payment acceptance and scales are not implemented by the visual design update. No mock screen pretends to process those transactions. The hardware roadmap remains in the Intranet documentation.
