import { test, expect } from "@playwright/test";

test("background catalogue updates keep product cards, images and scroll stable while applying real changes", async ({
  page,
}) => {
  let shop: any;
  let items: any[] = [];
  let refreshes = 0;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/api/**", (route) => {
    if (route.request().url().includes("bootstrap")) {
      refreshes++;
      return route.fulfill({
        json: { shop: { ...shop, snapshotVersion: String(refreshes) }, items },
      });
    }
    if (route.request().url().includes("/uploads/"))
      return route.fulfill({ contentType: "image/png", body: png });
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await expect(page.getByTestId("item-coffee")).toBeVisible();
  ({ shop, items } = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("posnic-preview");
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction("records", "readwrite"),
      store = tx.objectStore("records");
    const get = (key: string) =>
      new Promise<any>((resolve) => {
        const r = store.get(key);
        r.onsuccess = () => resolve(r.result);
      });
    const shop = {
      ...(await get("shop")),
      mode: "live",
      baseUrl: location.origin + "/api",
      token: "test-token",
      capabilities: {
        saleSync: true,
        devicePairing: true,
        tillPrint: false,
        terminal: false,
      },
    };
    const product = await get("item:coffee");
    const items = Array.from({ length: 40 }, (_, n) => ({
      ...product,
      id: "stable" + String(n).padStart(2, "0"),
      name: "Product " + String(n).padStart(2, "0"),
      image: "/uploads/product.png",
    }));
    store.put(shop, "shop");
    for (const item of items) store.put(item, "item:" + item.id);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
    return { shop, items };
  }));
  await page.clock.install();
  await page.reload();
  const card = page.getByTestId("item-stable39"),
    image = card.locator("img");
  await expect(image).toHaveAttribute("src", /^data:image/);
  await expect(page.locator('[data-testid^="item-"]')).toHaveCount(40);
  await card.scrollIntoViewIfNeeded();
  const scroll = page.getByTestId("screen-scroll");
  const top = await scroll.evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(1000);
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="item-stable39"]')!;
    const image = card.querySelector("img")!;
    (window as any).catalogueFlashes = 0;
    new MutationObserver((records) => {
      for (const r of records)
        for (const node of r.removedNodes) {
          if (
            node === card ||
            node === image ||
            node.contains(card) ||
            node.contains(image)
          )
            (window as any).catalogueFlashes++;
        }
    }).observe(document.body, { childList: true, subtree: true });
  });
  for (let n = 0; n < 3; n++) {
    const before = refreshes;
    await page.clock.fastForward(30000);
    await expect.poll(() => refreshes).toBeGreaterThan(before);
    // Allow the asynchronous IndexedDB transaction and render to finish.
    await page.clock.runFor(500);
    await expect(image).toHaveAttribute("src", /^data:image/);
    expect(await scroll.evaluate((el) => el.scrollTop)).toBeCloseTo(top, 0);
    expect(await page.evaluate(() => (window as any).catalogueFlashes)).toBe(0);
  }
  items = items.map((item) =>
    item.id === "stable39" ? { ...item, price: 99 } : item,
  );
  await page
    .getByRole("button", { name: "Refresh", exact: true })
    .dispatchEvent("click");
  await expect(card).toHaveAccessibleName(/99/);
  items = items.map((item) =>
    item.id === "stable39" ? { ...item, active: false } : item,
  );
  await page
    .getByRole("button", { name: "Refresh", exact: true })
    .dispatchEvent("click");
  await expect(card).toHaveCount(0);
});
