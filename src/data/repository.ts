import type { Storage, Change } from "./storage";
import type {
  Cart,
  Customer,
  Item,
  Line,
  Outbox,
  Payment,
  Sale,
  SessionData,
  Settings,
  Shop,
} from "../domain/types";
import { quickCode, totals } from "../domain/money";
import { trainingItems, trainingShop } from "./training";

export class Repository {
  private tail: Promise<unknown> = Promise.resolve();
  private catalogueCache: Item[] | null = null;
  constructor(
    private store: Storage,
    private uuid: () => string,
    private now: () => number = Date.now,
  ) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  newCart(): Cart {
    return {
      id: this.uuid(),
      lines: [],
      createdAt: new Date(this.now()).toISOString(),
    };
  }
  async load(): Promise<SessionData> {
    await this.tail;
    const [shop, items, cart, held, sales, outbox, settings, customers] =
      await Promise.all([
        this.store.get<Shop>("shop"),
        this.catalogueCache ?? this.store.list<Item>("item:"),
        this.store.get<Cart>("cart"),
        this.store.list<Cart>("held:"),
        this.store.list<Sale>("sale:"),
        this.store.list<Outbox>("outbox:"),
        this.store.get<Settings>("settings"),
        this.store.list<Customer>("customer:"),
      ]);
    this.catalogueCache = items;
    return {
      shop,
      items,
      cart: cart ?? this.newCart(),
      held,
      sales: sales.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      outbox,
      settings: settings ?? {
        locale: "en",
        printer: "system",
        autoPrint: false,
      },
      customers,
    };
  }
  async startTraining() {
    return this.serial(async () => {
      if (await this.store.get("shop")) throw new Error("shopAlreadyPaired");
      await this.store.batch([
        { key: "shop", value: trainingShop },
        { key: "cart", value: this.newCart() },
        ...trainingItems.map((item) => ({
          key: "item:" + item.id,
          value: item,
        })),
      ]);
      this.catalogueCache = null;
    });
  }
  async pair(shop: Shop, items: Item[]) {
    return this.serial(async () => {
      if (await this.store.get("shop")) throw new Error("shopAlreadyPaired");
      if (!shop.id || !shop.branchId || !shop.snapshotVersion)
        throw new Error("invalidServer");
      await this.store.batch([
        { key: "shop", value: shop },
        { key: "cart", value: this.newCart() },
        ...items.map((item) => ({ key: "item:" + item.id, value: item })),
      ]);
      this.catalogueCache = null;
    });
  }
  async leaveTraining() {
    return this.serial(async () => {
      const shop = await this.store.get<Shop>("shop");
      const sales = await this.store.list<Sale>("sale:");
      if (
        shop?.mode !== "training" ||
        sales.some((s) => !s.training) ||
        (await this.store.list<Outbox>("outbox:")).length
      )
        throw new Error("permissionDenied");
      const changes: Change[] = ["shop", "cart", "receipt-sequence"].map(
        (key) => ({ key, value: null }),
      );
      for (const prefix of ["item:", "sale:", "held:", "customer:"])
        for (const row of await this.store.list<{ id: string }>(prefix))
          changes.push({ key: prefix + row.id, value: null });
      await this.store.batch(changes);
      this.catalogueCache = null;
    });
  }
  private async authorized(action: keyof Shop["permissions"]): Promise<Shop> {
    const shop = await this.store.get<Shop>("shop");
    if (!shop || !shop.permissions[action]) throw new Error("permissionDenied");
    if (
      Date.parse(shop.offlineUntil) <= this.now() ||
      !Number.isFinite(Date.parse(shop.offlineUntil))
    )
      throw new Error("grantExpired");
    return shop;
  }
  async refreshCatalogue(shop: Shop, items: Item[]) {
    return this.serial(async () => {
      const current = await this.store.get<Shop>("shop");
      if (
        !current ||
        current.mode !== "live" ||
        shop.mode !== "live" ||
        current.id !== shop.id ||
        current.branchId !== shop.branchId ||
        current.staffId !== shop.staffId ||
        current.baseUrl !== shop.baseUrl
      )
        throw new Error("invalidServer");
      if (new Set(items.map((item) => item.id)).size !== items.length)
        throw new Error("invalidServer");
      const old = await this.store.list<Item>("item:");
      // Snapshot replacement is atomic. Existing cart and sale prices remain untouched.
      await this.store.batch([
        ...old.map((item) => ({ key: "item:" + item.id, value: null })),
        ...items.map((item) => ({ key: "item:" + item.id, value: item })),
        { key: "shop", value: shop },
      ]);
      this.catalogueCache = null;
    });
  }
  async addItem(item: Item) {
    return this.serial(async () => {
      const shop = await this.authorized("sell");
      if (!item.active || item.requiresConfiguration)
        throw new Error("itemUnavailable");
      const cart = (await this.store.get<Cart>("cart")) ?? this.newCart();
      const existing = cart.lines.find(
        (line) =>
          line.itemId === item.id &&
          line.price === item.price &&
          line.snapshotVersion === shop.snapshotVersion,
      );
      if (existing) {
        if (existing.quantity >= 999) throw new Error("invalidAmount");
        existing.quantity++;
      } else
        cart.lines.push({
          snapshotVersion: shop.snapshotVersion,
          offlineUntil: shop.offlineUntil,
          id: this.uuid(),
          itemId: item.id,
          name: item.name,
          quantity: 1,
          price: item.price,
          taxBps: item.taxBps,
          taxInclusive: item.taxInclusive,
        });
      await this.store.batch([{ key: "cart", value: cart }]);
    });
  }
  async addQuick(price: number, name: string) {
    return this.serial(async () => {
      const shop = await this.authorized("quickSale");
      if (!shop.permissions.sell) throw new Error("permissionDenied");
      if (!Number.isSafeInteger(price) || price <= 0)
        throw new Error("invalidAmount");
      const cart = (await this.store.get<Cart>("cart")) ?? this.newCart();
      cart.lines.push({
        snapshotVersion: shop.snapshotVersion,
        offlineUntil: shop.offlineUntil,
        id: this.uuid(),
        name: name.trim() || "Quick sale",
        quantity: 1,
        price,
        taxBps: shop.quickTaxBps,
        taxInclusive: shop.quickTaxInclusive,
      });
      totals(cart.lines);
      await this.store.batch([{ key: "cart", value: cart }]);
    });
  }
  async quantity(lineId: string, delta: number) {
    return this.serial(async () => {
      await this.authorized("sell");
      const cart = await this.store.get<Cart>("cart");
      if (!cart) return;
      const line = cart.lines.find((i) => i.id === lineId);
      if (!line) return;
      line.quantity += delta;
      cart.lines = cart.lines.filter((i) => i.quantity > 0);
      totals(cart.lines);
      await this.store.batch([{ key: "cart", value: cart }]);
    });
  }
  async hold() {
    return this.serial(async () => {
      const cart = await this.store.get<Cart>("cart");
      if (!cart?.lines.length) throw new Error("emptyCart");
      await this.store.batch([
        { key: "held:" + cart.id, value: cart },
        { key: "cart", value: this.newCart() },
      ]);
    });
  }
  async resume(id: string) {
    return this.serial(async () => {
      const current = await this.store.get<Cart>("cart");
      if (current?.lines.length) throw new Error("cartNotEmpty");
      const held = await this.store.get<Cart>("held:" + id);
      if (!held) throw new Error("notFound");
      await this.store.batch([
        { key: "cart", value: held },
        { key: "held:" + id, value: null },
      ]);
    });
  }
  async customer(name: string, phone: string) {
    return this.serial(async () => {
      await this.authorized("customerWrite");
      if (!name.trim() && !phone.trim()) throw new Error("customerRequired");
      const customer: Customer = {
        id: this.uuid(),
        name: name.trim(),
        phone: phone.trim(),
      };
      const cart = (await this.store.get<Cart>("cart")) ?? this.newCart();
      cart.customer = customer;
      await this.store.batch([
        { key: "customer:" + customer.id, value: customer },
        { key: "cart", value: cart },
      ]);
    });
  }
  async createItem(item: Item) {
    return this.serial(async () => {
      const shop = await this.authorized("itemWrite");
      // Master writes require a server version-check contract. Training is isolated.
      if (shop.mode !== "training") throw new Error("serverRequired");
      const code = quickCode(item.code),
        items = await this.store.list<Item>("item:");
      if (code && items.some((i) => i.active && i.code === code))
        throw new Error("duplicateCode");
      if (
        !item.name.trim() ||
        !Number.isSafeInteger(item.price) ||
        item.price < 0
      )
        throw new Error("invalidAmount");
      await this.store.batch([
        {
          key: "item:" + item.id,
          value: { ...item, code, name: item.name.trim() },
        },
      ]);
      this.catalogueCache = null;
    });
  }
  async checkout(cartId: string, payment: Payment): Promise<Sale> {
    return this.serial(async () => {
      // A double-tap or retry after an ambiguous local response returns the same sale.
      const saved = await this.store.get<Sale>("sale:" + cartId);
      if (saved) return saved;
      const shop = await this.authorized("sell");
      if (shop.mode === "live" && !shop.capabilities.saleSync)
        throw new Error("serverUpgrade");
      const cart = await this.store.get<Cart>("cart");
      if (!cart?.lines.length || cart.id !== cartId)
        throw new Error("emptyCart");
      if (
        cart.lines.some(
          (line) =>
            line.offlineUntil && Date.parse(line.offlineUntil) <= this.now(),
        )
      )
        throw new Error("grantExpired");
      const amount = totals(cart.lines);
      if (amount.total <= 0) throw new Error("invalidAmount");
      if (payment.method === "cash") {
        if (
          !Number.isSafeInteger(payment.received) ||
          payment.received < amount.total
        )
          throw new Error("insufficientCash");
        payment = {
          method: "cash",
          received: payment.received,
          change: payment.received - amount.total,
        };
      } else {
        const accountId = payment.account.id;
        const account = shop.upiAccounts.find(
          (a) => a.id === accountId && a.active,
        );
        if (
          !shop.permissions.manualUpi ||
          !account ||
          account.verification !== "manual" ||
          account.vpa !== payment.account.vpa
        )
          throw new Error("upiUnavailable");
        payment = {
          ...payment,
          account: { ...account },
          status: "staff-confirmed",
        };
      }
      const sequence =
        ((await this.store.get<number>("receipt-sequence")) ?? 0) + 1;
      const sale: Sale = {
        snapshotVersion: shop.snapshotVersion,
        id: cart.id,
        shopId: shop.id,
        branchId: shop.branchId,
        staffId: shop.staffId,
        cart,
        ...amount,
        payment,
        createdAt: new Date(this.now()).toISOString(),
        currency: shop.currency,
        receipt: `${shop.mode === "training" ? "TRAIN" : "M"}-${cart.id.slice(0, 8)}-${sequence}`,
        training: shop.mode === "training",
        sync: shop.mode === "training" ? "synced" : "pending",
      };
      const printSettings = await this.store.get<Settings>("settings");
      if (
        !sale.training &&
        printSettings?.autoPrint &&
        printSettings.printer === "till"
      )
        sale.tillPrint = "pending";
      const writes: Change[] = [
        { key: "sale:" + sale.id, value: sale },
        { key: "receipt-sequence", value: sequence },
        { key: "cart", value: this.newCart() },
      ];
      if (!sale.training)
        writes.push({
          key: "outbox:" + sale.id,
          value: {
            id: sale.id,
            saleId: sale.id,
            authority: shop.baseUrl!,
            shopId: shop.id,
            branchId: shop.branchId,
            attempts: 0,
            nextAttemptAt: 0,
            state: "pending",
          } satisfies Outbox,
        });
      await this.store.batch(writes);
      return sale;
    });
  }
  async settings(settings: Settings) {
    return this.serial(() =>
      this.store.batch([{ key: "settings", value: settings }]),
    );
  }
  async acknowledge(id: string, serverId: string) {
    return this.serial(async () => {
      const sale = await this.store.get<Sale>("sale:" + id);
      if (!sale) return;
      await this.store.batch([
        { key: "sale:" + id, value: { ...sale, sync: "synced", serverId } },
        { key: "outbox:" + id, value: null },
      ]);
    });
  }
  async queueTillPrint(id: string, queued = false) {
    return this.serial(async () => {
      const sale = await this.store.get<Sale>("sale:" + id);
      if (!sale || sale.training) throw new Error("deviceUnavailable");
      if (sale.tillPrint === "queued" && !queued) return;
      await this.store.batch([
        {
          key: "sale:" + id,
          value: { ...sale, tillPrint: queued ? "queued" : "pending" },
        },
      ]);
    });
  }
  async retry(entry: Outbox, message: string, review = false) {
    return this.serial(async () => {
      const attempts = entry.attempts + 1;
      const changes: Change[] = [
        {
          key: "outbox:" + entry.id,
          value: {
            ...entry,
            attempts,
            error: message,
            state: review ? "review" : "pending",
            nextAttemptAt:
              this.now() + Math.min(300000, 1000 * 2 ** Math.min(attempts, 8)),
          },
        },
      ];
      if (review) {
        const sale = await this.store.get<Sale>("sale:" + entry.saleId);
        if (sale)
          changes.push({
            key: "sale:" + sale.id,
            value: { ...sale, sync: "review" },
          });
      }
      await this.store.batch(changes);
    });
  }
}
