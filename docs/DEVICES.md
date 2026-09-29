# Devices: first delivery milestone

Open **More → Devices** to choose camera scanning, external keyboard-mode
barcode scanning, the phone print service or the configured Till printer.
These are available workflows, not a list of physically connected peripherals.
Permissions and the offline grant control which actions are enabled.

Pair an external scanner in the phone's OS settings, select its keyboard/HID
mode and configure an Enter suffix. Open **External barcode scanner**, focus
the input and scan. Leave the page to stop. The app preserves leading zeroes
and requires one active item with an exact matching barcode. It does not use
product names or internal item numbers as barcode fallbacks. Product QR codes
must contain the literal catalogue barcode; GS1 URL parsing is a later milestone.

For a quick training check, enter `POSNIC-DEMO-11` and press Enter twice. The
current sale should contain two Filter coffees (₹70). Test with internet off.
No real payment or server write occurs in training mode.

Rapid input is saved through a bounded, ordered queue. Backgrounding/locking
cancels scans that have not started; an already-started atomic item add finishes.
Review the cart after interruption. A full queue reports a pause rather than
silently treating another barcode as saved.

After a live receipt has been queued for the Till, use **Refresh** on its receipt
details to inspect its job state. This requires the matched API's `printStatus`
capability. Completion is reported by the Till and is not proof of physical
paper delivery. A status read never creates another print request.

Direct Bluetooth/USB printers, cash-drawer commands, scales and card-terminal
providers are not implemented by this milestone. Software tests and native bundle
exports do not certify a scanner or printer model. Physical Android/iPhone and
Till tests are required before a pilot release.

See `Intranet/docs/MOBILE_POS_HARDWARE_DELIVERY_ROADMAP.md` in the companion Intranet
repository for the full milestone backlog and acceptance gates, and
[Access control](ACCESS_CONTROL.md) for the existing permission mapping.
