import { test, expect } from "@playwright/test";

test("rapid HID submissions save every item and incomplete input clears on blur", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await page.getByTestId("device-hid").click();
  const input = page.getByTestId("scanner-input");
  for (let index = 0; index < 10; index++) {
    await input.fill("POSNIC-DEMO-11");
    await input.press("Enter");
  }
  await expect(page.getByText("₹350", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Current sale", exact: true }),
  ).toBeEnabled();
  await input.fill("INCOMPLETE");
  await input.blur();
  await expect(input).toHaveValue("");
  await expect(
    page.getByText("Scanning paused", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume scanning" }).click();
  await expect(input).toBeFocused();
});

test("deliberate scanner mode adds repeated products offline and stops on exit", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByTestId("start-training").click();
  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await expect(page.getByTestId("device-till-print")).toBeDisabled();
  await page.screenshot({ path: "test-results/devices.png", fullPage: true });
  await page.getByTestId("device-hid").click();
  await context.setOffline(true);
  const input = page.getByTestId("scanner-input");
  for (let count = 0; count < 2; count++) {
    await input.fill("POSNIC-DEMO-11");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("scan-result")).toHaveText("Filter coffee");
  }
  await input.fill("upi://pay?pa=test@bank");
  await input.press("Enter");
  await expect(
    page.getByText(/Payment, sign-in and card data are not accepted here/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Current sale", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cash · ₹70", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveCount(0);
});
