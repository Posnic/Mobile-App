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
    itemWrite: false,
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
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
}
for (const mode of ["Count stock", "Receive stock", "Damage", "Loss"])
  for (const completedElsewhere of [false, true])
    test(`${mode} review back works and clears completed drafts (${completedElsewhere ? "server status recovery" : "local confirmation"})`, async ({
      page,
    }) => {
      let writes = 0,
        prepared: any;
      await page.route("http://192.168.50.4:5555/api/**", async (route) => {
        const url = route.request().url();
        let json: any = { token: "test-token" };
        if (url.includes("runtime-info"))
          json = {
            edition: "community",
            apiSchema: 1,
            features: { mobilePosV1: true },
          };
        else if (url.includes("bootstrap")) json = { shop, items: [product] };
        else if (url.includes("inventory/catalogue"))
          json = {
            shopId: shop.id,
            branchId: shop.branchId,
            staffId: shop.staffId,
            asOf: new Date().toISOString(),
            permissions: { read: true, write: true, approvalActions: [] },
            rows: [product],
            next: null,
          };
        else if (url.endsWith("/" + "c".repeat(64))) json = prepared;
        else if (url.endsWith("/confirm")) {
          writes++;
          json = { ...prepared, state: "complete", applied: [product.id] };
        } else if (url.endsWith("inventory/operations")) {
          const body = route.request().postDataJSON();
          prepared = {
            ...body,
            operationId: "c".repeat(64),
            state: "prepared",
            approvalRequired: false,
            conflicts: [],
            applied: [],
            lines: body.lines.map((l: any) => ({
              ...l,
              name: product.name,
              expected: 10000,
            })),
          };
          json = prepared;
        }
        await route.fulfill({ json });
      });
      await login(page);
      await page.getByRole("button", { name: mode, exact: true }).click();
      await page
        .getByRole("button")
        .filter({ hasText: "Warehouse beans" })
        .click();
      await page
        .getByRole("textbox", { name: "Quantity", exact: true })
        .fill("2");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .getByRole("button", { name: "Review · 1", exact: true })
        .click();
      // Back must navigate immediately, without recursively acquiring the action lock.
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Search items", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Review · 1", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Reason / reference", exact: true })
        .fill("Delivery 123");
      await page
        .getByRole("button", { name: "Submit for review", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Confirm stock changes",
          exact: true,
        }),
      ).toBeVisible();
      expect(writes).toBe(0);
      expect(prepared.lines[0].quantity).toBe(2000);
      if (completedElsewhere) {
        prepared = { ...prepared, state: "complete", applied: [product.id] };
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Find stock", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: new RegExp("^" + mode + " ·") }),
        ).toHaveCount(0);
        await page.reload();
        await page
          .getByRole("button", { name: "Inventory", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: new RegExp("^" + mode + " ·") }),
        ).toHaveCount(0);
        expect(writes).toBe(0);
        return;
      }
      await page
        .getByRole("button", { name: "Confirm stock changes", exact: true })
        .click();
      await expect(
        page.getByText("Complete", { exact: true }).first(),
      ).toBeVisible();
      expect(writes).toBe(1);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: "test-results/inventory-confirmed.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Find stock", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: new RegExp("^" + mode + " ·") }),
      ).toHaveCount(0);
      await page.reload();
      await page
        .getByRole("button", { name: "Inventory", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: new RegExp("^" + mode + " ·") }),
      ).toHaveCount(0);
      expect(writes).toBe(1);
    });
test("count requires explicit quantity and a saved zero survives app restart", async ({
  page,
}) => {
  await page.route("http://192.168.50.4:5555/api/**", async (route) => {
    const url = route.request().url();
    await route.fulfill({
      json: url.includes("runtime-info")
        ? {
            edition: "community",
            apiSchema: 1,
            features: { mobilePosV1: true },
          }
        : url.includes("bootstrap")
          ? { shop, items: [product] }
          : url.includes("inventory/catalogue")
            ? {
                shopId: shop.id,
                branchId: shop.branchId,
                staffId: shop.staffId,
                asOf: new Date().toISOString(),
                permissions: { read: true, write: true, approvalActions: [] },
                rows: [product],
                next: null,
              }
            : { token: "test-token" },
    });
  });
  await login(page);
  await page.getByRole("button", { name: "Count stock", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "Warehouse beans" }).click();
  await expect(
    page.getByRole("textbox", { name: "Quantity", exact: true }),
  ).toHaveValue("");
  await page.getByRole("textbox", { name: "Quantity", exact: true }).fill("0");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review · 1", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: /Count stock · 1/ }).click();
  await expect(
    page.getByText("Warehouse beans · 0 piece", { exact: true }),
  ).toBeVisible();
});

test("supplier selection filters later catalogue pages and preserves the receiving draft", async ({
  page,
}) => {
  let offline = false;
  const other = {
    ...product,
    id: "d".repeat(24),
    name: "Other supplier item",
    supplierId: "other",
  };
  await page.route("http://192.168.50.4:5555/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (offline && url.pathname.includes("inventory/catalogue"))
      return route.abort("failed");
    let json: any = { token: "test-token" };
    if (url.pathname.includes("runtime-info"))
      json = {
        edition: "community",
        apiSchema: 1,
        features: { mobilePosV1: true },
      };
    else if (url.pathname.includes("bootstrap"))
      json = { shop, items: [product] };
    else if (url.pathname.includes("inventory/catalogue")) {
      const kind = url.searchParams.get("kind");
      const first = kind === "items" && !url.searchParams.get("after");
      json = {
        shopId: shop.id,
        branchId: shop.branchId,
        staffId: shop.staffId,
        asOf: new Date().toISOString(),
        permissions: { read: true, write: true, approvalActions: [] },
        rows:
          kind === "suppliers"
            ? [
                { id: "supplier", name: "Market", active: true },
                { id: "other", name: "Another supplier", active: true },
              ]
            : kind === "categories"
              ? [{ id: "food", name: "Food", active: true }]
              : first
                ? [other]
                : [product],
        next: first ? "1".repeat(24) : null,
      };
    }
    await route.fulfill({ json });
  });
  await login(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/inventory-modern-home.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Suppliers", exact: true }).click();
  await page.getByRole("textbox").fill("Market");
  await page.getByRole("button", { name: "Search items", exact: true }).click();
  await expect(
    page.getByRole("button").filter({ hasText: "Another supplier" }),
  ).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/inventory-modern-suppliers.png",
    fullPage: true,
  });
  await page.getByRole("button").filter({ hasText: "Market" }).click();
  await expect(
    page.getByRole("button").filter({ hasText: "Warehouse beans" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button").filter({ hasText: "Other supplier item" }),
  ).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/inventory-modern-products.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await page.getByRole("button").filter({ hasText: "Warehouse beans" }).click();
  await page.getByRole("textbox", { name: "Quantity", exact: true }).fill("2");
  await page.evaluate(() => window.scrollTo(0, 0));
  const quantityBox = await page
    .getByRole("textbox", { name: "Quantity", exact: true })
    .boundingBox();
  expect(quantityBox!.x + quantityBox!.width).toBeLessThanOrEqual(390);
  await page.getByRole("textbox", { name: "Quantity", exact: true }).blur();
  await page.screenshot({
    path: "test-results/inventory-modern-quantity.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  offline = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Offline: only downloaded records are shown."),
  ).toBeVisible();
  await expect(
    page.getByRole("button").filter({ hasText: "Other supplier item" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Review · 1", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Reason / reference", exact: true })
    .fill("Delivery note 1042");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/inventory-modern-review.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(page.getByText("Market", { exact: false }).last()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/inventory-modern-drafts.png",
    fullPage: true,
  });
});

test("availability review hides selected duplicate and restores with server confirmation", async ({
  page,
}) => {
  const products = [
    { ...product, availableForSale: true, availabilityRevision: "" },
    {
      ...product,
      id: "c".repeat(24),
      name: "Premium beans",
      price: 2000,
      availableForSale: true,
      availabilityRevision: "",
    },
  ];
  let writes = 0;
  await page.route("http://192.168.50.4:5555/api/**", async (route) => {
    const url = route.request().url();
    let json: any = { token: "test-token" };
    if (url.includes("runtime-info"))
      json = {
        edition: "community",
        apiSchema: 1,
        features: { mobilePosV1: true },
      };
    else if (url.includes("bootstrap")) json = { shop, items: products };
    else if (url.includes("inventory/catalogue"))
      json = {
        shopId: shop.id,
        branchId: shop.branchId,
        staffId: shop.staffId,
        asOf: new Date().toISOString(),
        permissions: { read: true, write: true, approvalActions: [] },
        rows: products,
        next: null,
      };
    else if (url.endsWith("inventory/availability")) {
      writes++;
      const body = route.request().postDataJSON();
      expect(body.changes).toHaveLength(1);
      json = {
        confirmedAt: new Date().toISOString(),
        results: body.changes.map((x: any) => {
          const row = products.find((p) => p.id === x.itemId)!;
          row.availableForSale = x.available;
          row.active = x.available;
          row.availabilityRevision = body.id;
          return { itemId: row.id, state: "confirmed", item: row };
        }),
      };
    }
    await route.fulfill({ json });
  });
  await login(page);
  await page.getByRole("button", { name: "Find stock", exact: true }).click();
  await page
    .getByRole("button", { name: "Review product availability", exact: true })
    .click();
  await expect(
    page.getByText("Different selling prices — check carefully"),
  ).toBeVisible();
  await page
    .getByRole("switch", {
      name: "Available for sale: Warehouse beans",
      exact: true,
    })
    .click();
  expect(writes).toBe(0);
  await page.getByText("Review 1 changes", { exact: true }).click();
  await expect(
    page.getByText("Available → Hidden from sales", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/availability-review.png",
    fullPage: true,
  });
  await page.getByText("Confirm changes", { exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(
    page.getByRole("switch", {
      name: "Available for sale: Warehouse beans",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("switch", {
      name: "Available for sale: Warehouse beans",
      exact: true,
    })
    .click();
  await page.getByText("Review 1 changes", { exact: true }).click();
  await page.getByText("Confirm changes", { exact: true }).click();
  await expect.poll(() => writes).toBe(2);
  expect(products[0]!.quantity).toBe(10000);
  expect(products[1]!.availableForSale).toBe(true);
});
