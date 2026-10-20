import type { Sale, Shop } from "../domain/types";
import { lineAmounts } from "../domain/money";
import contract from "../vendor/receiptContract";
import { receiptDesigner } from "../vendor/receiptDesigner";
import JsBarcode from "../vendor/barcode";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
// Desktop's plain-text adapter uses an inert DOM. Mobile has no DOM; strip tags
// and decode only text entities before the renderer escapes the result again.
const plain = (v: unknown) =>
  String(v ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|quot|#39|nbsp);/g,
      (_, key) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[
          key as string
        ] || "",
    );
function barcode(value: string) {
  if (!value || value.length > 100 || /[^\x20-\x7e]/.test(value)) return "";
  const target: { encodings?: { data: string }[] } = {};
  try {
    JsBarcode(target, value, { format: "CODE128", displayValue: false });
  } catch {
    return "";
  }
  const bits = target.encodings?.map((e) => e.data).join("") || "";
  const bars = [...bits]
    .map((b, x) =>
      b === "1" ? `<rect x="${x + 10}" y="0" width="1" height="42"/>` : "",
    )
    .join("");
  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bits.length + 20} 56"><rect width="100%" height="100%" fill="white"/><g fill="black">${bars}</g><text x="50%" y="53" text-anchor="middle" font-size="9">${esc(value)}</text></svg>`,
    )
  );
}
export function designedReceipt(
  sale: Sale,
  shop: Shop,
  t: (key: string) => string,
  locale = "en",
  requested?: "58" | "80",
): string | null {
  if (!shop.receiptProfile) return null;
  if (sale.receiptWording) {
    const original = t,
      saved = sale.receiptWording;
    locale = saved.locale;
    t = (key) =>
      typeof saved.values[key] === "string"
        ? saved.values[key]!
        : original(key);
  }
  const source = (fallback: string) =>
    sale.receiptWording?.sources?.[fallback] ?? fallback;
  const profile = shop.receiptProfile;
  const design = contract.normalize(profile.data.receipt_designs);
  const format = requested || design.defaultFormat;
  const amounts = sale.cart.lines.map(lineAmounts);
  const data = {
    ...profile.data,
    receipt_designs: design,
    sales_id: sale.receipt,
    receipt_date: new Date(sale.createdAt).toLocaleString(locale),
    currency_type: sale.currency,
    customer_name: sale.cart.customer?.name || "",
    customer_phone: sale.cart.customer?.phone || "",
    items: sale.cart.lines.map((line, i) => ({
      item_name: line.name,
      item_quantity: line.quantity,
      item_unit: line.unit || "",
      item_price: line.price / 100,
      total_amount: amounts[i]!.total / 100,
    })),
    items_subtotal: (sale.total - sale.tax) / 100,
    tax: sale.tax / 100,
    items_total: sale.total / 100,
    payment_mode: t(sale.payment.method),
  };
  const labels: Record<string, string> = {
    Total: t("total"),
    Tax: t("tax"),
    Receipt: t("receipt"),
    Qty: t("quantity"),
    Item: t("items"),
    "Item name": t("name"),
    Payment: t(sale.payment.method),
  };
  const engine = receiptDesigner(
    contract,
    {
      escapeHtml: esc,
      local: { get: () => "" },
      i18n: { t: (_k: string, fallback: string) => source(fallback) },
      receiptDesignLabel: (label: string) =>
        sale.receiptWording?.sources?.[label] ?? labels[label] ?? label,
      BRAND_URL: "https://posnic.com",
    },
    {
      rows: () => [
        { method: t(sale.payment.method), amount: sale.total / 100 },
      ],
    },
    plain,
    barcode,
  );
  const status = sale.training
    ? t("trainingReceipt")
    : sale.sync === "synced"
      ? t("receipt")
      : t("offlineReceipt");
  const html = engine.render(data, format, false);
  return `<!doctype html><html lang="${esc(locale)}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"></head><body>${html}<p style="text-align:center;font-size:11px">${esc(status)}${sale.payment.method === "upi" ? " · " + esc(t("unverified")) : ""}</p></body></html>`;
}
