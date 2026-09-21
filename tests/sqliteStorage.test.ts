import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteStorage } from "../src/data/sqliteStorage";

function connect(file: string) {
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)))",
  );
  // The adapter is intentionally passed a single connection with no API for
  // opening an extra, unkeyed transaction connection.
  const storage = sqliteStorage({
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, ...params: SQLInputValue[]) =>
      db.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, ...params: SQLInputValue[]) =>
      db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, ...params: SQLInputValue[]) =>
      db.prepare(sql).all(...params),
  } as unknown as Parameters<typeof sqliteStorage>[0]);
  return { db, storage };
}
test("first settings write and sale batch use one connection and survive reopening", async () => {
  const dir = mkdtempSync(join(tmpdir(), "posnic-storage-"));
  const file = join(dir, "test.db");
  let db: DatabaseSync | undefined;
  try {
    const first = connect(file);
    db = first.db;
    assert.equal(await first.storage.get("settings"), null);
    await first.storage.batch([
      { key: "settings", value: { locale: "ta" } },
      { key: "sale:1", value: { id: "1" } },
      { key: "outbox:1", value: { saleId: "1" } },
    ]);
    db.close();
    db = undefined;
    const second = connect(file);
    db = second.db;
    assert.deepEqual(await second.storage.get("settings"), { locale: "ta" });
    assert.deepEqual(await second.storage.list("sale:"), [{ id: "1" }]);
    assert.deepEqual(await second.storage.list("outbox:"), [{ saleId: "1" }]);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true });
  }
});
test("a failed SQL batch rolls back before queued reads and subsequent writes", async () => {
  const { db, storage } = connect(":memory:");
  try {
    await storage.batch([{ key: "cart", value: { id: "original" } }]);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const failed = storage.batch([
      { key: "cart", value: null },
      { key: "sale:1", value: { id: "1" } },
      { key: "outbox:1", value: cycle },
    ]);
    const queuedRead = storage.get("cart");
    await assert.rejects(failed, /circular/i);
    assert.deepEqual(await queuedRead, { id: "original" });
    assert.deepEqual(await storage.list("sale:"), []);
    await storage.batch([{ key: "settings", value: { locale: "en" } }]);
    assert.deepEqual(await storage.get("settings"), { locale: "en" });
  } finally {
    db.close();
  }
});
