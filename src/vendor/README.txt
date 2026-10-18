Receipt layout sources
======================
receiptContract.ts follows POS api/src/helpers/receipt-design.js at 93d6b597.
receiptDesigner.ts follows POS frontend/static/script/js/core/receipt-designer.js
at 93d6b597. The renderer is wrapped as a module with injected text and barcode
adapters; remote image loading and editor-only DOM operations are omitted.
Keep layout changes aligned with these POS sources and run productCreation tests.

barcode.ts contains JsBarcode 3.11.3 (MIT, Johan Lindell), from the existing POS
frontend/static/script/js/JsBarcode.all.min.js. Its copyright header is retained.
The local window shim exposes the existing universal bundle without a browser DOM.

The mobile adapter supplies actual local sale amounts and embedded branch assets.
It never runs downloaded JavaScript or HTML from a server. Receipt design data is
validated with the shared contract before rendering. An unavailable external logo
is reported in printer settings instead of fetching an arbitrary URL.
