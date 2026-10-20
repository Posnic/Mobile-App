import { normalizeDigits, parseMoney } from "./money";
export interface ProductForm {
  name: string;
  barcode: string;
  sku: string;
  brand: string;
  unit: string;
  categoryId: string;
  supplierId: string;
  taxId: string;
  price: string;
  cost: string;
  mrp: string;
  opening: string;
  image: string;
  tracked: boolean;
  weighed: boolean;
  taxInclusive: boolean;
  available: boolean;
}
export interface ProductDraft {
  id: string;
  form: ProductForm;
  submitted: boolean;
}
export const emptyProduct = (): ProductForm => ({
  name: "",
  barcode: "",
  sku: "",
  brand: "",
  unit: "piece",
  categoryId: "",
  supplierId: "",
  taxId: "",
  price: "",
  cost: "",
  mrp: "",
  opening: "",
  image: "",
  tracked: false,
  weighed: false,
  taxInclusive: true,
  available: true,
});
export function productPayload(form: ProductForm) {
  const raw = normalizeDigits(form.opening.trim()).replace(/[,\u066b]/g, ".");
  if (
    raw &&
    (!/^\d{1,9}(\.\d{1,3})?$/.test(raw) || (!form.weighed && Number(raw) % 1))
  )
    throw Error("invalidQuantity");
  if (!form.name.trim()) throw Error("invalidAmount");
  return {
    ...form,
    name: form.name.trim(),
    barcode: form.barcode.trim(),
    price: parseMoney(form.price),
    cost: parseMoney(form.cost || "0"),
    mrp: parseMoney(form.mrp || "0"),
    opening: form.tracked && raw ? Math.round(Number(raw) * 1000) : null,
  };
}
