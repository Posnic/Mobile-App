import { z } from "zod";
import { PosnicApi } from "./api";
import { credentials } from "../platform/credentials";
import type { Shop, Item } from "../domain/types";
import { productPayload, type ProductDraft } from "../domain/product";
const ref = z.object({ id: z.string(), name: z.string() });
const choices = z.object({
  shopId: z.string(),
  branchId: z.string(),
  staffId: z.string(),
  categories: z.array(ref),
  suppliers: z.array(ref),
  units: z.array(ref),
  taxes: z.array(ref.extend({ rate: z.number() })),
  trackStock: z.boolean(),
  truncated: z.boolean(),
});
export type ProductOptions = z.infer<typeof choices>;
export class ProductApi {
  constructor(private shop: Shop) {}
  private async request(path: string, body?: unknown) {
    if (!this.shop.baseUrl) throw Error("serverRequired");
    return new PosnicApi(this.shop.baseUrl).request(
      "/mobile/v1/products" + path,
      body,
      await credentials.get(this.shop.baseUrl),
    );
  }
  private check(result: { shopId: string; branchId: string; staffId: string }) {
    if (
      result.shopId !== this.shop.id ||
      result.branchId !== this.shop.branchId ||
      result.staffId !== this.shop.staffId
    )
      throw Error("invalidServer");
  }
  async lookup(barcode: string) {
    const result = z
      .object({
        shopId: z.string(),
        branchId: z.string(),
        staffId: z.string(),
        rows: z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              price: z.number(),
              active: z.boolean(),
              code: z.string(),
              category: z.string(),
              visual: z.string(),
              taxBps: z.number(),
              taxInclusive: z.boolean(),
            })
            .passthrough(),
        ),
        truncated: z.boolean(),
      })
      .parse(
        await this.request("/lookup?barcode=" + encodeURIComponent(barcode)),
      );
    this.check(result);
    return result;
  }
  async options(query = "") {
    const result = choices.parse(
      await this.request("/options?q=" + encodeURIComponent(query)),
    );
    this.check(result);
    return result;
  }
  async create(draft: ProductDraft): Promise<Item> {
    const result = z
      .object({
        shopId: z.string(),
        branchId: z.string(),
        staffId: z.string(),
        confirmedAt: z.string(),
        item: z
          .object({
            id: z.string(),
            name: z.string(),
            price: z.number().int(),
            code: z.string(),
            category: z.string(),
            visual: z.string(),
            taxBps: z.number().int(),
            taxInclusive: z.boolean(),
            active: z.boolean(),
          })
          .passthrough(),
      })
      .parse(
        await this.request("", {
          id: draft.id,
          scope: {
            shopId: this.shop.id,
            branchId: this.shop.branchId,
            staffId: this.shop.staffId,
          },
          product: productPayload(draft.form),
        }),
      );
    this.check(result);
    return result.item as Item;
  }
}
