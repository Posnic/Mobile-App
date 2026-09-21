import { z } from "zod";
import type { Sale, Shop, Item } from "../domain/types";
import { credentials } from "../platform/credentials";

export { serverAddress, parseShopQr } from "./serverAddress";
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export class PosnicApi {
  constructor(
    readonly base: string,
    private fetcher: typeof fetch = fetch,
    private timeoutMs = 15000,
  ) {}
  async request(
    path: string,
    body?: unknown,
    token?: string | null,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Browser fetch checks its receiver. Calling it as this.fetcher binds it
      // to PosnicApi and fails before a network request is sent.
      const fetchRequest = this.fetcher;
      const response = await fetchRequest(this.base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        const details = await response.json().catch(() => null);
        throw new ApiError(
          details?.error?.message?.startsWith("Enable Mobile POS")
            ? "mobileDisabled"
            : response.status === 401
              ? "signInFailed"
              : response.status === 403
                ? "permissionDenied"
                : response.status === 404
                  ? "serverUpgrade"
                  : "networkError",
          response.status,
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("networkError");
    } finally {
      clearTimeout(timeout);
    }
  }
  async probe() {
    const runtime = z
      .object({
        edition: z.enum(["community", "cloud"]),
        apiSchema: z.number(),
        features: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await this.request("/runtime-info"));
    return runtime;
  }
  async connect(
    username: string,
    password: string,
    code?: string,
    persist = true,
    codeVerifier?: string,
  ): Promise<{ shop: Shop; items: Item[]; token: string }> {
    const runtime = await this.probe();
    if (runtime.features?.mobilePosV1 !== true)
      throw new Error("serverUpgrade");
    const device = {
      device_id: await credentials.deviceId(),
      device_model: "Posnic Mobile POS",
      platform: "mobile-pos",
    };
    const result = z
      .object({ token: z.string().min(1) })
      .parse(
        await this.request(
          code ? "/mobile/v1/pair" : "/users/kioskMobileLogin",
          code
            ? { code, device, codeVerifier }
            : { username, password, device },
        ),
      );
    const data = bootstrap.parse(
      await this.request("/mobile/v1/bootstrap", undefined, result.token),
    );
    const shop: Shop = { ...data.shop, mode: "live", baseUrl: this.base };
    if (!shop.capabilities.saleSync) throw new Error("serverUpgrade");
    if (persist) await credentials.set(result.token);
    return { shop, items: data.items, token: result.token };
  }
  async upload(sale: Sale) {
    const { tillPrint: _print, ...payload } = sale;
    const response = z
      .object({
        saleId: z.string(),
        serverId: z.string(),
        shopId: z.string(),
        branchId: z.string(),
      })
      .parse(
        await this.request(
          "/mobile/v1/sales",
          { idempotencyKey: sale.id, sale: payload },
          await credentials.get(),
        ),
      );
    if (
      response.saleId !== sale.id ||
      response.shopId !== sale.shopId ||
      response.branchId !== sale.branchId
    )
      throw new ApiError("invalidServer", 409);
    return response;
  }
  async catalogue(): Promise<{ shop: Shop; items: Item[] }> {
    const data = bootstrap.parse(
      await this.request(
        "/mobile/v1/bootstrap",
        undefined,
        await credentials.get(),
      ),
    );
    return {
      shop: { ...data.shop, mode: "live", baseUrl: this.base },
      items: data.items,
    };
  }
  async printReceipt(saleId: string) {
    return this.request(
      "/mobile/v1/print-jobs",
      { id: "receipt:" + saleId, saleId, document: "receipt" },
      await credentials.get(),
    );
  }
}
const minor = z.number().int().min(0).max(99999999999);
const item = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price: minor,
  code: z.string().regex(/^\d{0,6}$/),
  barcode: z.string().optional(),
  category: z.string(),
  visual: z.string(),
  image: z.string().url().optional(),
  shape: z.enum(["circle", "square", "diamond"]).optional(),
  taxBps: z.number().int().min(0).max(10000),
  taxInclusive: z.boolean(),
  active: z.boolean(),
  requiresConfiguration: z.boolean().optional(),
});
export const bootstrap = z.object({
  shop: z.object({
    id: z.string().min(1),
    branchId: z.string().min(1),
    name: z.string(),
    branchName: z.string(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine(
        (currency) =>
          new Intl.NumberFormat("en", {
            style: "currency",
            currency,
          }).resolvedOptions().maximumFractionDigits === 2,
        "Only two-decimal currencies are supported by this build",
      ),
    staffId: z.string().min(1),
    staffName: z.string(),
    snapshotVersion: z.string().min(1),
    offlineUntil: z.string().datetime(),
    connection: z
      .object({
        idempotencyScope: z.string().min(1),
        local: z.string().url().optional(),
        remote: z.string().url().optional(),
      })
      .optional(),
    quickTaxBps: z.number().int().min(0).max(10000),
    quickTaxInclusive: z.boolean(),
    permissions: z.object({
      sell: z.boolean(),
      quickSale: z.boolean(),
      customerWrite: z.boolean(),
      itemWrite: z.boolean(),
      priceOverride: z.boolean(),
      manualUpi: z.boolean(),
    }),
    upiAccounts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        vpa: z.string(),
        active: z.boolean(),
        verification: z.enum(["manual", "provider"]),
      }),
    ),
    defaultUpiAccountId: z.string().optional(),
    capabilities: z.object({
      saleSync: z.boolean(),
      devicePairing: z.boolean(),
      tillPrint: z.boolean(),
      terminal: z.boolean(),
    }),
  }),
  items: z.array(item),
});
