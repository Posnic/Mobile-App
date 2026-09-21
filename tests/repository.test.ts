import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../src/data/repository";
import type { Storage, Change } from "../src/data/storage";
import { trainingItems, trainingShop } from "../src/data/training";
import { SyncWorker } from "../src/services/sync";
import { ApiError } from "../src/services/api";
import { receiptHtml } from "../src/services/receipt";

class MemoryStore implements Storage {
  records = new Map<string, unknown>();
  fail = false;
  async get<T>(key: string) {
    return structuredClone(this.records.get(key) ?? null) as T | null;
  }
  async list<T>(prefix: string) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, v]) => structuredClone(v) as T);
  }
  async batch(changes: Change[]) {
    const next = new Map(this.records);
    for (const change of changes) {
      if (change.value === null) next.delete(change.key);
      else next.set(change.key, structuredClone(change.value));
    }
    if (this.fail) throw new Error("disk full");
    this.records = next;
  }
}
function setup() {
  const storage = new MemoryStore();
  let sequence = 0;
  const repo = new Repository(
    storage,
    () => `id-${++sequence}`,
    () => 1000,
  );
  return { storage, repo };
}
test("checkout survives repository recreation and repeated checkout returns same receipt", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.addItem(trainingItems[0]!);
  const cart = (await repo.load()).cart;
  const [a, b] = await Promise.all([
    repo.checkout(cart.id, { method: "cash", received: 5000, change: 999 }),
    repo.checkout(cart.id, { method: "cash", received: 5000, change: 999 }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.payment.method, "cash");
  assert.equal(a.payment.method === "cash" && a.payment.change, 1500);
  const reboot = new Repository(storage, () => "restart");
  const data = await reboot.load();
  assert.equal(data.sales.length, 1);
  assert.equal(data.cart.lines.length, 0);
  assert.equal(data.outbox.length, 0);
});
test("failed commit retains cart and creates neither sale nor outbox", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.addItem(trainingItems[0]!);
  const cart = (await repo.load()).cart;
  storage.fail = true;
  await assert.rejects(() =>
    repo.checkout(cart.id, { method: "cash", received: 5000, change: 0 }),
  );
  storage.fail = false;
  const data = await repo.load();
  assert.equal(data.cart.id, cart.id);
  assert.equal(data.cart.lines.length, 1);
  assert.equal(data.sales.length, 0);
});
test("underpayment, denied action, duplicate code and expired offline grant do not mutate sales", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.addItem(trainingItems[0]!);
  const state = await repo.load();
  await assert.rejects(
    () =>
      repo.checkout(state.cart.id, { method: "cash", received: 1, change: 0 }),
    /insufficientCash/,
  );
  await assert.rejects(
    () => repo.createItem({ ...trainingItems[0]!, id: "other" }),
    /duplicateCode/,
  );
  await storage.batch([
    {
      key: "shop",
      value: { ...trainingShop, offlineUntil: "1970-01-01T00:00:00Z" },
    },
  ]);
  await assert.rejects(
    () =>
      repo.checkout(state.cart.id, {
        method: "cash",
        received: 5000,
        change: 0,
      }),
    /grantExpired/,
  );
  assert.equal((await repo.load()).sales.length, 0);
});
test("hold and resume preserve cart and refuse to overwrite another cart", async () => {
  const { repo } = setup();
  await repo.startTraining();
  await repo.addItem(trainingItems[0]!);
  const id = (await repo.load()).cart.id;
  await repo.hold();
  await repo.addItem(trainingItems[1]!);
  await assert.rejects(() => repo.resume(id), /cartNotEmpty/);
  await repo.hold();
  await repo.resume(id);
  assert.equal((await repo.load()).cart.lines[0]?.name, "Filter coffee");
});
test("live sale and outbox commit together; transient retry preserves authority and identifier", async () => {
  const { repo } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.addItem(trainingItems[0]!);
  const cart = (await repo.load()).cart;
  const sale = await repo.checkout(cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  assert.equal((await repo.load()).outbox.length, 1);
  let calls = 0;
  const worker = new SyncWorker(repo, (url) => ({
    upload: async (sent) => {
      assert.equal(url, "https://shop.example/api");
      assert.equal(sent.id, sale.id);
      calls++;
      throw new ApiError("networkError");
    },
  }));
  await Promise.all([worker.run(), worker.run()]);
  assert.equal(calls, 1);
  const pending = (await repo.load()).outbox[0]!;
  assert.equal(pending.attempts, 1);
  assert.equal(pending.state, "pending");
});
test("successful sync acknowledges once; permanent rejection keeps paid receipt in review", async () => {
  const { repo } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.addItem(trainingItems[0]!);
  let cart = (await repo.load()).cart;
  await repo.checkout(cart.id, { method: "cash", received: 5000, change: 0 });
  await new SyncWorker(repo, () => ({
    upload: async (sale) => ({
      saleId: sale.id,
      serverId: "remote1",
      shopId: sale.shopId,
      branchId: sale.branchId,
    }),
  })).run();
  assert.equal((await repo.load()).outbox.length, 0);
  await repo.addItem(trainingItems[0]!);
  cart = (await repo.load()).cart;
  await repo.checkout(cart.id, { method: "cash", received: 5000, change: 0 });
  await new SyncWorker(repo, () => ({
    upload: async () => {
      throw new ApiError("permissionDenied", 403);
    },
  })).run();
  assert.equal((await repo.load()).outbox[0]?.state, "review");
  assert.ok((await repo.load()).sales.some((s) => s.sync === "review"));
});
test("receipt escapes merchant and item markup", async () => {
  const { repo } = setup();
  await repo.startTraining();
  await repo.addQuick(100, "<script>alert(1)</script>");
  const cart = (await repo.load()).cart;
  const sale = await repo.checkout(cart.id, {
    method: "cash",
    received: 100,
    change: 0,
  });
  const html = receiptHtml(sale, "<img onerror=x>", (x) => x);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;img/);
  assert.match(html, /trainingReceipt/);
});

test("catalogue refresh is atomic, tenant pinned, and preserves cart price snapshots", async () => {
  const { repo, storage } = setup();
  const shop = {
    ...trainingShop,
    mode: "live" as const,
    baseUrl: "https://shop.example/api",
  };
  await repo.pair(shop, trainingItems);
  await repo.addItem(trainingItems[0]!);
  const changed = { ...trainingItems[0]!, price: 9900 };
  await assert.rejects(
    () => repo.refreshCatalogue({ ...shop, branchId: "other" }, [changed]),
    /invalidServer/,
  );
  storage.fail = true;
  await assert.rejects(
    () => repo.refreshCatalogue(shop, [changed]),
    /disk full/,
  );
  storage.fail = false;
  assert.equal((await repo.load()).items.length, trainingItems.length);
  await repo.refreshCatalogue({ ...shop, snapshotVersion: "next" }, [changed]);
  const state = await repo.load();
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0]?.price, 9900);
  assert.equal(state.cart.lines[0]?.price, 3500);
  assert.equal(state.shop?.snapshotVersion, "next");
});

test("leaving training clears only practice data and refuses live shops", async () => {
  const { repo } = setup();
  await repo.startTraining();
  await repo.settings({ locale: "ta", printer: "system", autoPrint: false });
  await repo.addItem(trainingItems[0]!);
  const cart = (await repo.load()).cart;
  await repo.checkout(cart.id, { method: "cash", received: 3500, change: 0 });
  await repo.leaveTraining();
  let state = await repo.load();
  assert.equal(state.shop, null);
  assert.equal(state.sales.length, 0);
  assert.equal(state.items.length, 0);
  assert.equal(state.settings.locale, "ta");
  await repo.pair({ ...trainingShop, mode: "live" }, trainingItems);
  await assert.rejects(() => repo.leaveTraining(), /permissionDenied/);
  state = await repo.load();
  assert.equal(state.items.length, trainingItems.length);
});

test("manual recovery bypasses backoff and a restarted worker sends the durable sale", async () => {
  const { repo, storage } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.addItem(trainingItems[0]!);
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  const entry = (await repo.load()).outbox[0]!;
  await storage.batch([
    {
      key: "outbox:" + entry.id,
      value: { ...entry, nextAttemptAt: Date.now() + 300000 },
    },
  ]);
  const reopened = new Repository(storage, () => "next-cart");
  const worker = new SyncWorker(reopened, () => ({
    upload: async (sent) => ({
      saleId: sent.id,
      shopId: sent.shopId,
      branchId: sent.branchId,
      serverId: "remote",
    }),
  }));
  await worker.run();
  assert.equal((await reopened.load()).outbox.length, 1);
  await worker.run(true);
  assert.equal((await reopened.load()).outbox.length, 0);
  assert.equal(
    (await reopened.load()).sales.find((s) => s.id === sale.id)?.sync,
    "synced",
  );
});

test("offline till print survives restart and sale acknowledgement", async () => {
  const { repo, storage } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: {
        ...trainingShop.capabilities,
        saleSync: true,
        tillPrint: true,
      },
    },
    trainingItems,
  );
  await repo.settings({ locale: "en", printer: "till", autoPrint: true });
  await repo.addItem(trainingItems[0]!);
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  const reopened = new Repository(storage, () => "next-cart");
  assert.equal((await reopened.load()).sales[0]?.tillPrint, "pending");
  await reopened.acknowledge(sale.id, "server-sale");
  assert.equal((await reopened.load()).sales[0]?.tillPrint, "pending");
  await reopened.queueTillPrint(sale.id, true);
  await reopened.queueTillPrint(sale.id);
  assert.equal((await reopened.load()).sales[0]?.tillPrint, "queued");
});

test("cart lines retain the issuing catalogue when prices refresh", async () => {
  const { repo } = setup();
  const shop = {
    ...trainingShop,
    mode: "live" as const,
    baseUrl: "https://shop.example/api",
    capabilities: { ...trainingShop.capabilities, saleSync: true },
  };
  await repo.pair(shop, trainingItems);
  await repo.addItem(trainingItems[0]!);
  await repo.refreshCatalogue(
    { ...shop, snapshotVersion: "new-catalogue" },
    trainingItems.map((i) => ({ ...i, price: i.price + 100 })),
  );
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  assert.equal(sale.snapshotVersion, "new-catalogue");
  assert.equal(sale.cart.lines[0]?.snapshotVersion, shop.snapshotVersion);
  assert.equal(sale.cart.lines[0]?.price, trainingItems[0]!.price);
});
