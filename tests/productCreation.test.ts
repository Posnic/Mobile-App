import { test } from "node:test";
import assert from "node:assert/strict";
import { productPayload, emptyProduct } from "../src/domain/product";
import { designedReceipt } from "../src/services/designedReceipt";
import { trainingShop } from "../src/data/training";
import contract from "../src/vendor/receiptContract";
import { receiptDesigner } from "../src/vendor/receiptDesigner";
import type { Sale } from "../src/domain/types";
test("opening stock accepts explicit zero, supports weighed units and keeps MRP distinct", () => {
  const form = {
    ...emptyProduct(),
    name: "Milk",
    price: "65",
    mrp: "70",
    tracked: true,
    opening: "0",
  };
  assert.equal(productPayload(form).opening, 0);
  assert.equal(productPayload(form).mrp, 7000);
  assert.throws(() => productPayload({ ...form, opening: "1.25" }));
  assert.equal(
    productPayload({ ...form, weighed: true, opening: "1.25" }).opening,
    1250,
  );
  assert.equal(
    productPayload({ ...form, tracked: false, opening: "9" }).opening,
    null,
  );
});
test("downloaded receipt layouts retain store text, block order, barcode and escaped product names offline", () => {
  const engine = receiptDesigner(
    contract,
    { escapeHtml: (v: unknown) => String(v), local: { get: () => "" } },
    { rows: () => [] },
    (v: unknown) => String(v),
    () => "",
  );
  const design = engine.defaults({
    branch_name: "Shop",
    footer_print: "Custom footer",
    receipt_barcode: true,
  });
  const shop = {
    ...trainingShop,
    receiptProfile: {
      version: "v1",
      assetsComplete: true,
      data: {
        branch_name: "My supermarket",
        printing_address: "Market road",
        receipt_designs: design,
      },
    },
  };
  const sale: Sale = {
    id: "sale",
    shopId: shop.id,
    branchId: shop.branchId,
    staffId: shop.staffId,
    receipt: "S123",
    createdAt: "2026-10-18T10:00:00Z",
    currency: "INR",
    training: false,
    sync: "pending",
    cart: {
      id: "cart",
      createdAt: "2026-10-18T10:00:00Z",
      lines: [
        {
          id: "line",
          name: "Milk <script>bad</script>",
          quantity: 2,
          price: 6500,
          taxBps: 0,
          taxInclusive: true,
        },
      ],
    },
    total: 13000,
    tax: 0,
    payment: { method: "cash", received: 13000, change: 0 },
  };
  for (const format of ["58", "80"] as const) {
    const html = designedReceipt(sale, shop, (k) => k, "en", format)!;
    assert.match(html, /My supermarket/);
    assert.match(html, /Market road/);
    assert.match(html, /Custom footer/);
    assert.match(html, /Milk &lt;script&gt;bad/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /data:image\/svg\+xml/);
    assert.match(html, /offlineReceipt/);
    assert.ok(
      html.indexOf("rd-block-items") < html.lastIndexOf("Custom footer"),
    );
  }
});
