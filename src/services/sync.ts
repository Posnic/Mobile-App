import type { Repository } from "../data/repository";
import { ApiError, PosnicApi } from "./api";
import { ShopConnection } from "./routes";
import type { Shop } from "../domain/types";
/** Single flight and durable retries, with verified routes for the paired shop. */
export class SyncWorker {
  lastError: string | null = null;
  private flight: Promise<void> | null = null;
  constructor(
    private repository: Repository,
    private api: (
      url: string,
      shop: Shop,
    ) => Pick<PosnicApi, "upload"> & Partial<Pick<PosnicApi, "catalogue">> = (
      url,
      shop,
    ) => new ShopConnection(shop),
  ) {}
  run(force = false): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = this.drain(force).finally(() => {
      this.flight = null;
    });
    return this.flight;
  }
  private async drain(force: boolean) {
    this.lastError = null;
    const state = await this.repository.load();
    if (
      !state.shop ||
      state.shop.mode === "training" ||
      !state.shop.capabilities.saleSync
    )
      return;
    const client = this.api(state.shop.baseUrl!, state.shop);
    for (const entry of state.outbox) {
      if (
        entry.state === "review" ||
        (!force && entry.nextAttemptAt > Date.now())
      )
        continue;
      const sale = state.sales.find((s) => s.id === entry.saleId);
      if (
        !sale ||
        entry.authority !== state.shop.baseUrl ||
        entry.shopId !== state.shop.id ||
        entry.branchId !== state.shop.branchId
      ) {
        await this.repository.retry(entry, "invalidServer", true);
        continue;
      }
      try {
        const response = await client.upload(sale);
        await this.repository.acknowledge(sale.id, response.serverId);
      } catch (error) {
        const review =
          error instanceof ApiError &&
          [400, 403, 409, 422].includes(error.status);
        await this.repository.retry(
          entry,
          error instanceof Error ? error.message : "networkError",
          review,
        );
        this.lastError =
          error instanceof Error ? error.message : "networkError";
        if (!review) break;
      }
    }
    const updated = await this.repository.load();
    for (const sale of updated.sales) {
      if (sale.tillPrint !== "pending" || sale.sync !== "synced") continue;
      try {
        await new PosnicApi(state.shop.baseUrl!).printReceipt(sale.id);
        await this.repository.queueTillPrint(sale.id, true);
      } catch (error) {
        this.lastError =
          error instanceof Error ? error.message : "networkError";
        break;
      }
    }
    if (state.shop.baseUrl) {
      if (client.catalogue) {
        const snapshot = await client.catalogue();
        await this.repository.refreshCatalogue(snapshot.shop, snapshot.items);
      }
    }
  }
}
