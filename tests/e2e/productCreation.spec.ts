import { test, expect, type Page } from "@playwright/test";
const product = {
  id: "a".repeat(24),
  name: "Warehouse beans",
  price: 1000,
  code: "",
  barcode: "00123",
  category: "Food",
  visual: "■",
  taxBps: 0,
  taxInclusive: true,
  active: true,
  tracked: true,
  quantity: 10000,
  revision: "b".repeat(64),
  supplierId: "supplier",
  supplierName: "Market",
  categoryId: "food",
  sku: "BEAN",
  unit: "piece",
};
const shop = {
  id: "inventory-shop",
  branchId: "main",
  name: "Inventory test shop",
  branchName: "Main",
  currency: "INR",
  staffId: "owner",
  staffName: "Owner",
  snapshotVersion: "1",
  offlineUntil: new Date(Date.now() + 86400000).toISOString(),
  quickTaxBps: 0,
  quickTaxInclusive: true,
  permissions: {
    sell: true,
    quickSale: true,
    customerWrite: false,
    itemWrite: true,
    priceOverride: false,
    manualUpi: false,
    inventoryWrite: true,
    supplierRead: true,
  },
  upiAccounts: [],
  capabilities: {
    saleSync: true,
    devicePairing: true,
    tillPrint: false,
    terminal: false,
    inventory: true,
  },
};
async function login(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Connect a local or Community shop",
      exact: true,
    })
    .click();
  await page.getByTestId("manual-server").click();
  await page.getByTestId("server-input").fill("192.168.50.4:5555");
  await page.getByTestId("choose-server-next").click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("owner");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Create item", exact: true }).click();
}

for (const retry of [false, true])
  test(`create product with opening stock, supplier and ${retry ? "lost-response retry" : "add to sale"}`, async ({
    page,
  }) => {
    let writes: any[] = [];
    await page.route("http://192.168.50.4:5555/api/**", async (route) => {
      const url = route.request().url();
      let json: any = { token: "test-token" };
      const scope = {
        shopId: shop.id,
        branchId: shop.branchId,
        staffId: shop.staffId,
      };
      if (url.includes("runtime-info"))
        json = {
          edition: "community",
          apiSchema: 1,
          features: { mobilePosV1: true },
        };
      else if (url.includes("bootstrap"))
        json = {
          shop: { ...shop, snapshotVersion: writes.length ? "new-grant" : "1" },
          items: [
            product,
            ...(writes.length
              ? [
                  {
                    ...product,
                    id: "new-item",
                    name: writes[0].product.name,
                    price: writes[0].product.price,
                  },
                ]
              : []),
          ],
        };
      else if (url.includes("products/options"))
        json = {
          ...scope,
          categories: [{ id: "food", name: "Food" }],
          suppliers: [{ id: "supplier", name: "Market supplier" }],
          taxes: [],
          units: [],
          trackStock: false,
          truncated: false,
        };
      else if (url.includes("products/lookup"))
        json = { ...scope, rows: [], truncated: false };
      else if (url.endsWith("/products")) {
        const body = route.request().postDataJSON();
        writes.push(body);
        if (retry && writes.length === 1) {
          await route.abort();
          return;
        }
        json = {
          ...scope,
          confirmedAt: new Date().toISOString(),
          item: {
            ...product,
            id: "new-item",
            name: body.product.name,
            price: body.product.price,
            barcode: body.product.barcode,
          },
        };
      }
      await route.fulfill({ json });
    });
    await login(page);
    await page
      .getByRole("textbox", { name: "Barcode", exact: true })
      .fill("8901234567890");
    await page
      .getByRole("button", { name: "Check barcode", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("New supermarket milk");
    await page
      .getByRole("textbox", { name: "Selling price", exact: true })
      .fill("65");
    await page.getByRole("button", { name: "Suppliers", exact: true }).click();
    await page
      .getByRole("button", { name: "Market supplier", exact: true })
      .click();
    await page
      .getByRole("switch", { name: "Track stock", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Opening stock (optional)", exact: true })
      .fill("12");
    await page
      .getByRole("button", { name: "Review new product", exact: true })
      .click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByRole("textbox", {
        name: "Opening stock (optional)",
        exact: true,
      }),
    ).toHaveValue("12");
    await page
      .getByRole("button", { name: "Review new product", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save & add to sale", exact: true })
      .click();
    if (retry) {
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Save & add to sale", exact: true })
        .click();
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[0]).toEqual(writes[1]);
    }
    await expect.poll(() => writes.length).toBe(retry ? 2 : 1);
    expect(writes[0].product.opening).toBe(12000);
    expect(writes[0].product.supplierId).toBe("supplier");
    expect(writes[0].product.price).toBe(6500);
    await expect(
      page.getByRole("tab", { name: "Items", exact: true }),
    ).toBeVisible();
  });
