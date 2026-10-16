import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverServers } from "../src/services/discovery";
test("LAN scan probes only the phone subnet, recognizes Posnic and sends no credentials", async () => {
  const calls: string[] = [];
  const found: string[] = [];
  let final = 0;
  const fetcher: typeof fetch = async (url, options) => {
    const address = String(url);
    calls.push(address);
    assert.equal(options?.redirect, "error");
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      undefined,
    );
    return new Response(
      JSON.stringify(
        address.includes(".27:")
          ? {
              edition: "community",
              apiSchema: 1,
              syncProtocol: 1,
              version: "1.0",
              features: { mobilePosV1: true },
            }
          : { hello: true },
      ),
      { status: 200 },
    );
  };
  await discoverServers(
    "192.168.12.5",
    new AbortController().signal,
    (s) => found.push(s.address),
    (done) => {
      final = done;
    },
    fetcher,
    [5555],
  );
  assert.equal(calls.length, 256);
  assert.ok(calls.every((u) => u.startsWith("http://192.168.12.")));
  assert.deepEqual(found, ["http://192.168.12.27:5555/api"]);
  assert.equal(final, 254);
});
test("cancelled or non-private scans never send probes", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw new Error();
  };
  await discoverServers(
    "10.0.0.2",
    controller.signal,
    () => {},
    () => {},
    fetcher,
  );
  await assert.rejects(
    () =>
      discoverServers(
        "8.8.8.8",
        controller.signal,
        () => {},
        () => {},
        fetcher,
      ),
    /wifiRequired/,
  );
  assert.equal(calls, 0);
});

test("discovery reads only public shop names and falls back for older tills", async () => {
  for (const legacy of [false, true]) {
    const found: any[] = [];
    await discoverServers(
      "192.168.12.5",
      new AbortController().signal,
      (s) => found.push(s),
      () => {},
      async (url, options) => {
        assert.equal(
          (options?.headers as Record<string, string>).Authorization,
          undefined,
        );
        const path = String(url);
        if (!path.includes(".27:")) return new Response("{}", { status: 404 });
        if (path.endsWith("runtime-info"))
          return new Response(
            JSON.stringify({
              edition: "community",
              apiSchema: 1,
              syncProtocol: 1,
              features: { mobilePosV1: true },
            }),
          );
        if (path.endsWith("mobile/v1/discovery"))
          return new Response(JSON.stringify({ shopName: "South Avenue" }), {
            status: legacy ? 404 : 200,
          });
        return new Response(
          JSON.stringify({ connections: { shopName: "South Avenue" } }),
        );
      },
      [5555],
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].name, "South Avenue");
  }
});
