import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { parseServerInput } from "../src/services/serverAddress";
import { ShopConnection, shopRoutes } from "../src/services/routes";
import { ApiError, PosnicApi } from "../src/services/api";
import { trainingShop } from "../src/data/training";
import type { Shop, Sale } from "../src/domain/types";

const local = "http://192.168.1.8:5555/api";
const remote = "https://shop.example/api";
const shop: Shop = {
  ...trainingShop,
  mode: "live",
  baseUrl: remote,
  capabilities: { ...trainingShop.capabilities, saleSync: true },
  connection: { idempotencyScope: "ledger-1", local, remote },
};
const sale = { id: "sale-1", shopId: shop.id, branchId: shop.branchId } as Sale;
const ack = {
  saleId: sale.id,
  shopId: shop.id,
  branchId: shop.branchId,
  serverId: "saved-1",
};

test("two real HTTP endpoints never receive each other's catalogue or failed-sale retry", async () => {
  const hits: string[][] = [[], []];
  let failing = false;
  const servers = [0, 1].map((index) =>
    createServer((req, res) => {
      hits[index]!.push(req.url!);
      res.setHeader("Content-Type", "application/json");
      res.statusCode = failing ? 503 : 200;
      res.end(
        JSON.stringify(req.url === "/catalogue" ? { shop, items: [] } : ack),
      );
    }),
  );
  try {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
          ),
      ),
    );
    const urls = servers.map(
      (server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
    for (const selected of [0, 1]) {
      hits[0]!.length = hits[1]!.length = 0;
      failing = false;
      const connection = new ShopConnection(
        {
          ...shop,
          baseUrl: urls[selected],
          connection: {
            idempotencyScope: "shared",
            local: urls[0],
            remote: urls[1],
          },
        },
        (url) => {
          const request = async (path: string) => {
            const response = await fetch(url + path);
            if (!response.ok)
              throw new ApiError("networkError", response.status);
            return response.json();
          };
          return {
            catalogue: () => request("/catalogue"),
            upload: () => request("/sale"),
          };
        },
      );
      await connection.catalogue();
      failing = true;
      await assert.rejects(connection.upload(sale), /networkError/);
      failing = false;
      await connection.upload(sale);
      assert.deepEqual(hits[selected], ["/catalogue", "/sale", "/sale"]);
      assert.deepEqual(hits[1 - selected], []);
    }
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  }
});

test("typing, pasting and scanning understand shop codes, LAN addresses and pairing payloads", () => {
  assert.equal(
    parseServerInput(" demo ").address,
    "https://demo.posnic.io/api",
  );
  assert.equal(parseServerInput("192.168.1.8").address, local);
  assert.equal(parseServerInput("shop.example/login").address, remote);
  assert.deepEqual(
    parseServerInput("https://posnic.io/pair?server=shop.example&code=001234"),
    { address: remote, code: "001234" },
  );
  assert.deepEqual(
    parseServerInput('{"server":"shop.example","code":"001234"}'),
    { address: remote, code: "001234" },
  );
  for (const raw of [
    "",
    "not an address",
    "javascript:alert(1)",
    '{"code":"123"}',
    "https://user:pass@shop.example",
  ])
    assert.throws(() => parseServerInput(raw));
});

test("internet selection never prefers an advertised Wi-Fi route", async () => {
  const calls: string[] = [];
  const connection = new ShopConnection(shop, (url) => ({
    catalogue: async () => {
      calls.push(url);
      if (url === local) throw new ApiError("networkError");
      return { shop, items: [] };
    },
    upload: async () => {
      calls.push(url);
      return ack;
    },
  }));
  assert.deepEqual(shopRoutes(shop), [remote]);
  assert.deepEqual(await connection.upload(sale), ack);
  assert.deepEqual(calls, [remote]);
});

test("lost upload reply retries only the selected Wi-Fi server even with a shared ledger", async () => {
  const ledger = new Set<string>();
  const keys: string[] = [];
  const urls: string[] = [];
  const connection = new ShopConnection({ ...shop, baseUrl: local }, (url) => ({
    catalogue: async () => ({ shop, items: [] }),
    upload: async (sent) => {
      keys.push(sent.id);
      urls.push(url);
      ledger.add(sent.id);
      if (keys.length === 1) throw new ApiError("networkError");
      return ack;
    },
  }));
  await assert.rejects(() => connection.upload(sale), /networkError/);
  await connection.upload(sale);
  assert.deepEqual(keys, [sale.id, sale.id]);
  assert.deepEqual(urls, [local, local]);
  assert.equal(ledger.size, 1);
});

test("catalogue rejects a wrong tenant, staff or branch", async () => {
  for (const changed of [
    { id: "other" },
    { staffId: "other" },
    { branchId: "other" },
  ]) {
    let writes = 0;
    const connection = new ShopConnection(shop, () => ({
      catalogue: async () => ({ shop: { ...shop, ...changed }, items: [] }),
      upload: async () => {
        writes++;
        return ack;
      },
    }));
    await assert.rejects(() => connection.catalogue(), /invalidServer/);
    assert.equal(writes, 0);
  }
});

test("offline catalogue and server errors never switch away from the selected route", async () => {
  for (const baseUrl of [local, remote]) {
    for (const status of [0, 500, 503]) {
      const calls: string[] = [];
      const connection = new ShopConnection({ ...shop, baseUrl }, (url) => ({
        catalogue: async () => {
          calls.push(url);
          throw new ApiError("networkError", status);
        },
        upload: async () => ack,
      }));
      await assert.rejects(() => connection.catalogue(), /networkError/);
      assert.deepEqual(calls, [baseUrl]);
    }
  }
});

test("server refusals do not trigger failover and legacy bootstrap remains pinned", async () => {
  let writes = 0;
  const connection = new ShopConnection(shop, () => ({
    catalogue: async () => ({ shop, items: [] }),
    upload: async () => {
      writes++;
      throw new ApiError("permissionDenied", 403);
    },
  }));
  await assert.rejects(() => connection.upload(sale), /permissionDenied/);
  assert.equal(writes, 1);
  assert.deepEqual(shopRoutes({ ...shop, connection: undefined }), [remote]);
});

test("mobile login omits ambient cookies and reflects the server probe CSRF token", async () => {
  let calls = 0;
  const api = new PosnicApi(local, (async (_url, init) => {
    assert.equal(init?.credentials, "omit");
    const headers = new Headers(init?.headers);
    if (calls++ === 0)
      return new Response(
        JSON.stringify({ edition: "community", apiSchema: 1 }),
        { headers: { "X-CSRF-TOKEN": "session-proof" } },
      );
    assert.equal(headers.get("X-XSRF-TOKEN"), "session-proof");
    return new Response(JSON.stringify({ token: "login-result" }));
  }) as typeof fetch);
  await api.probe();
  await api.request("/users/kioskMobileLogin", {
    username: "owner",
    password: "test",
  });
  assert.equal(calls, 2);
});

test("session-security rejection is not reported as a role denial and writes are not replayed", async () => {
  let calls = 0;
  const api = new PosnicApi(local, (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        message:
          "Your session security token is missing or expired. Refresh and try again.",
      }),
      { status: 403 },
    );
  }) as typeof fetch);
  await assert.rejects(
    api.request("/users/kioskMobileLogin", {}),
    (e: unknown) =>
      e instanceof ApiError && e.message === "signInFailed" && e.status === 403,
  );
  assert.equal(calls, 1);
});
