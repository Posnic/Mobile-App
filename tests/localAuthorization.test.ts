import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { localAuthorizations, cloudGrant } from "../src/services/cloudGrant";
import {
  verifyEnrolment,
  refreshLocalAuthorizations,
} from "../src/services/localAuthorization";
const target = {
  deviceId: "till-one",
  name: "Main till",
  addresses: ["http://192.168.1.5:5555/api"],
  code: "ABCDEF123456",
  enrolmentId: "12345678-1234-1234-1234-123456789012",
};
test("only bounded private advertised routes can receive local authorization", () => {
  const grant = cloudGrant({
    baseUrl: "https://shop.posnic.io/api",
    code: "ABCDEF123456",
    connectionToken: "c".repeat(43),
    localServers: [target],
  });
  assert.deepEqual(grant.localServers, [target]);
  for (const address of [
    "https://evil.example/api",
    "http://127.0.0.1:5555/api",
    "http://user@192.168.1.5:5555/api",
    "http://192.168.1.5:5555/api?x=1",
    "http://169.254.169.254/api",
  ])
    assert.deepEqual(
      localAuthorizations([{ ...target, addresses: [address] }]),
      [],
    );
});
test("proof binds the nonce to the secret enrolment hash before credentials are sent", () => {
  const nonce = "n".repeat(43),
    secret = createHash("sha256").update(target.code).digest("hex");
  const proof = createHmac("sha256", secret).update(nonce).digest("hex");
  verifyEnrolment(target, nonce, { proof });
  assert.throws(
    () => verifyEnrolment(target, "z".repeat(43), { proof }),
    /invalidServer/,
  );
  assert.throws(
    () =>
      verifyEnrolment({ ...target, code: "123456ABCDEF" }, nonce, { proof }),
    /invalidServer/,
  );
  assert.throws(
    () => verifyEnrolment(target, nonce, { proof: "wrong" }),
    /invalidServer/,
  );
});
test("renewal sends the proof-bound receipt only to the account service and pins the cloud origin", async () => {
  const auth = {
    baseUrl: "https://shop.posnic.io/api",
    verifier: "v".repeat(43),
    connectionToken: "c".repeat(43),
    localServers: [target],
    updatedAt: 0,
  };
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, "https://www.posnic.com/api/mobile/connections");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "error");
    assert.equal(JSON.parse(String(options?.body)).codeVerifier, auth.verifier);
    return new Response(
      JSON.stringify({ baseUrl: auth.baseUrl, localServers: [target] }),
    );
  };
  assert.deepEqual(
    (
      await refreshLocalAuthorizations(
        auth,
        new AbortController().signal,
        fetcher,
      )
    ).localServers,
    [target],
  );
  await assert.rejects(
    refreshLocalAuthorizations(
      auth,
      new AbortController().signal,
      async () =>
        new Response(
          JSON.stringify({ baseUrl: "https://other.posnic.io/api" }),
        ),
    ),
    /invalidServer/,
  );
  await assert.rejects(
    refreshLocalAuthorizations(
      auth,
      new AbortController().signal,
      async () => new Response("{}", { status: 403 }),
    ),
    /authorizationExpired/,
  );
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    refreshLocalAuthorizations(auth, ctrl.signal, async () => {
      throw Error("must not fetch");
    }),
    /authorizationCancelled/,
  );
});
