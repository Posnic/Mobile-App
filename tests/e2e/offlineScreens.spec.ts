import { test, expect } from "@playwright/test";

test("offline data and sync screens preserve the basket and explain server acknowledgments", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByTestId("item-coffee").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByText("Offline data", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Offline data", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Unsynced sales and unresolved printing/),
  ).toBeVisible();
  await expect(page.getByText("App storage", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Available storage", { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/offline-data-screen.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByText(/Synced means accepted by your shop server/),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/sync-centre-screen.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Sell", exact: true }).click();
  await expect(page.getByTestId("view-cart")).toContainText("35");
});
