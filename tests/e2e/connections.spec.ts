import { createHash, createHmac } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
const shop = {
  id: "optional-pin-shop",
  branchId: "main",
  name: "PIN test shop",
  branchName: "Main",
  currency: "INR",
  staffId: "cashier",
  staffName: "Cashier",
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
  },
  upiAccounts: [],
  capabilities: {
    saleSync: true,
    devicePairing: true,
    tillPrint: false,
    terminal: false,
  },
};
const local = "http://192.168.50.4:5555/api";
const cloud = "https://same-shop.posnic.io/api";
async function mock(page: Page, itemWrite = false) {
  const logins: string[] = [];
  for (const base of [local, cloud])
    await page.route(base + "/**", async (route) => {
      const path = route.request().url().slice(base.length);
      const token = base === local ? "local-token" : "cloud-token";
      if (path.includes("bootstrap"))
        expect(route.request().headers().authorization).toBe("Bearer " + token);
      if (path.includes("Login") || path.includes("/pair")) logins.push(base);
      await route.fulfill({
        json: path.includes("runtime-info")
          ? {
              edition: "community",
              apiSchema: 1,
              features: { mobilePosV1: true },
            }
          : path.includes("bootstrap")
            ? {
                shop: {
                  ...shop,
                  permissions: { ...shop.permissions, itemWrite },
                },
                items: [],
              }
            : { token },
      });
    });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Connect a local or Community shop",
      exact: true,
    })
    .click();
  await page.getByTestId("manual-server").click();
  await page.getByTestId("server-input").fill(local);
  await page.getByTestId("choose-server-next").click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("cashier");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  return logins;
}
async function openConnections(page: Page) {
  await page
    .getByRole("button", { name: "Connection & sync", exact: true })
    .first()
    .click();
  if (!(await page.getByTestId("connection-panel").count()))
    await page
      .getByRole("button", { name: "Server settings", exact: true })
      .click();
  await expect(page.getByTestId("connection-panel")).toBeVisible();
}
test("connect once to each endpoint and switch using remembered endpoint-specific tokens", async ({
  page,
}, info) => {
  const logins = await mock(page);
  await openConnections(page);
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("connection-panel")
      .getByRole("button", { name: "Internet", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath("connections.png") });
  await page
    .getByRole("button", { name: "Other ways to connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Server address", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill(cloud);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("cashier");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  await page.getByTestId("route-wifi").click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  await page.getByTestId("route-internet").click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  expect(logins).toEqual([local, cloud]);
});
test("cloud approval returns directly to selling and stays on the internet endpoint", async ({
  page,
}) => {
  await page.route("https://www.posnic.com/api/mobile/**", async (route) => {
    const path = route.request().url();
    await route.fulfill({
      json: path.endsWith("/requests")
        ? {
            request: "a".repeat(43),
            expiresIn: 120,
            authorizationUrl: "https://www.posnic.com/api/mobile/authorize",
          }
        : { baseUrl: cloud, code: "ABCDEF123456" },
    });
  });
  await mock(page);
  await openConnections(page);
  await page.getByRole("button", { name: "Internet", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  await openConnections(page);
  await expect(page.getByTestId("route-internet")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("cancelling an unreachable endpoint releases the screen and ignores late replies", async ({
  page,
}) => {
  await mock(page);
  await openConnections(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("http://192.168.50.99:5555/api/**", async (route) => {
    await pending;
    await route.fulfill({
      json: {
        edition: "community",
        apiSchema: 1,
        features: { mobilePosV1: true },
      },
    });
  });
  await page
    .getByRole("button", { name: "Other ways to connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Server address", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill("192.168.50.99");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Server address", exact: true }),
  ).toBeEditable();
  release();
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
});

test("switch waits for the current sync and resumes without another tap", async ({
  page,
}) => {
  await mock(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route(local + "/mobile/v1/bootstrap**", async (route) => {
    started = true;
    await pending;
    await route.abort();
  });
  await page
    .getByRole("button", { name: "Connection & sync", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await openConnections(page);
  await page
    .getByRole("button", { name: "Other ways to connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Server address", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill(cloud);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("cashier");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
});

test("cloud approval links its advertised till without local login, then offers internet after Wi-Fi failure", async ({
  page,
}) => {
  const code = "123456ABCDEF",
    enrolmentId = "12345678-1234-1234-1234-123456789012";
  let verifier = "",
    challenge = "",
    localPairs = 0,
    passwordLogins = 0,
    outage = false;
  await page.route("https://www.posnic.com/api/mobile/**", async (route) => {
    if (route.request().url().endsWith("/requests")) {
      challenge = route.request().postDataJSON().codeChallenge;
      return route.fulfill({
        json: {
          request: "a".repeat(43),
          expiresIn: 120,
          authorizationUrl: "https://www.posnic.com/api/mobile/authorize",
        },
      });
    }
    verifier = route.request().postDataJSON().codeVerifier;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      challenge,
    );
    await route.fulfill({
      json: {
        baseUrl: cloud,
        code: "ABCDEF123456",
        connectionToken: "c".repeat(43),
        localServers: [
          {
            deviceId: "till-one",
            name: "Main till",
            addresses: [local],
            code,
            enrolmentId,
          },
        ],
      },
    });
  });
  for (const base of [cloud, local])
    await page.route(base + "/**", async (route) => {
      const path = route.request().url().slice(base.length);
      if (base === local && outage) return route.abort();
      if (path.includes("Login")) passwordLogins++;
      if (path.includes("enrolment-proof")) {
        expect(route.request().headers().authorization).toBeUndefined();
        const body = route.request().postDataJSON();
        expect(body.enrolmentId).toBe(enrolmentId);
        expect(body.codeVerifier).toBeUndefined();
        return route.fulfill({
          json: {
            proof: createHmac(
              "sha256",
              createHash("sha256").update(code).digest("hex"),
            )
              .update(body.nonce)
              .digest("hex"),
          },
        });
      }
      if (base === local && path.includes("/pair")) {
        localPairs++;
        expect(route.request().postDataJSON().code).toBe(code);
        expect(route.request().postDataJSON().codeVerifier).toBe(verifier);
      }
      await route.fulfill({
        json: path.includes("runtime-info")
          ? {
              edition: "community",
              apiSchema: 1,
              features: { mobilePosV1: true },
            }
          : path.includes("bootstrap")
            ? { shop, items: [] }
            : { token: base === local ? "local-token" : "cloud-token" },
      });
    });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  await openConnections(page);
  await page
    .getByTestId("connection-panel")
    .getByRole("button", { name: "Shop Wi-Fi", exact: true })
    .click();
  await page
    .getByRole("button", { name: /PIN test shop.*Use this server/ })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  expect(localPairs).toBe(1);
  expect(passwordLogins).toBe(0);
  outage = true;
  await page
    .getByRole("button", { name: "Connection & sync", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(
    page.getByText(/Cannot reach the shop server/).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Sell", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Switch to internet?", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Internet", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  await openConnections(page);
  await expect(page.getByTestId("route-internet")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(localPairs).toBe(1);
  expect(passwordLogins).toBe(0);
});

test("empty catalogue offers useful actions and both route icons remain visible", async ({
  page,
}) => {
  await mock(page);
  await expect(page.getByTestId("route-wifi")).toBeVisible();
  await expect(page.getByTestId("route-internet")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your catalogue is empty" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create item", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Add your first item/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Quick sale", exact: true }),
  ).toBeVisible();
  await openConnections(page);
  const panel = page.getByTestId("connection-panel");
  await expect(
    panel.getByRole("button", { name: "Server address", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Sign in again to this server" }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Shop Wi-Fi", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Internet", exact: true }),
  ).toBeVisible();
});

test("owner can create an item directly from the empty catalogue", async ({
  page,
}, info) => {
  await mock(page, true);
  await expect(
    page.getByRole("button", { name: "Create item", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("empty-catalogue.png") });
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create item", exact: true }),
  ).toBeVisible();
});

test("header route switch interrupts a pending manual connection without leaving the screen", async ({
  page,
}) => {
  await mock(page);
  await openConnections(page);
  await page
    .getByRole("button", { name: "Other ways to connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Server address", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill(cloud);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Username", exact: true })
    .fill("cashier");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
  await openConnections(page);
  await page
    .getByRole("button", { name: "Other ways to connect", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Server address", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Server address", exact: true })
    .fill("192.168.50.99");
  await page.route("http://192.168.50.99:5555/api/**", async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.abort();
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByTestId("route-wifi").click();
  await expect(
    page.getByRole("textbox", { name: "Search items", exact: true }),
  ).toBeVisible();
});
