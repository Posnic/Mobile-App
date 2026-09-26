import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  SessionVault,
  validPin,
  type SecretStore,
} from "../src/services/sessionVault";
function setup() {
  const data = new Map<string, string>();
  const store: SecretStore = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
  return { data, store, vault: new SessionVault(store, randomBytes) };
}
const account = {
  username: "cashier",
  password: "password-to-remember",
  token: "signed-session",
  server: "https://shop.example/api",
};
test("PIN follows existing till rules and never accepts common sequences", () => {
  for (const pin of [
    "0000",
    "1234",
    "2580",
    "1212",
    "4567",
    "543210",
    "12",
    "abcd",
  ])
    assert.equal(validPin(pin), false);
  assert.equal(validPin("4829"), true);
});
test("PIN seals remembered credentials, locks tokens, and unlocks after process restart", async () => {
  const { vault, store, data } = setup();
  await vault.remember(account);
  await vault.enroll("4829");
  assert.equal(data.has("posnic.account"), false);
  assert.equal(
    [...data.values()].some(
      (s) => s.includes(account.password) || s.includes(account.token),
    ),
    false,
  );
  vault.lock();
  assert.equal(await vault.token(), null);
  const restarted = new SessionVault(store, randomBytes);
  assert.deepEqual(await restarted.profile(), {
    username: account.username,
    server: account.server,
  });
  await assert.rejects(() => restarted.unlock("9871"), /pinWrong/);
  assert.equal(await restarted.token(), null);
  assert.deepEqual(await restarted.unlock("4829"), account);
  assert.equal(await restarted.token(), account.token);
});
test("five failures persist across restarts; recovery preserves server account", async () => {
  const { vault, store } = setup();
  await vault.remember(account);
  await vault.enroll("4829");
  vault.lock();
  for (let n = 0; n < 5; n++)
    await assert.rejects(() =>
      new SessionVault(store, randomBytes).unlock("9871"),
    );
  await assert.rejects(() => vault.unlock("4829"), /pinAttempts/);
  await vault.recover(account);
  assert.equal(await vault.hasPin(), false);
  assert.equal(await vault.token(), account.token);
});

test("cancelling an in-flight unlock cannot restore a session later", async () => {
  const { vault } = setup();
  await vault.remember(account);
  await vault.enroll("4829");
  vault.lock();
  const opening = vault.unlock("4829");
  await new Promise((resolve) => setTimeout(resolve, 10));
  vault.lock();
  await assert.rejects(() => opening, /pinLocked/);
  assert.equal(await vault.token(), null);
  assert.deepEqual(await vault.unlock("4829"), account);
});
