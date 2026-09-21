import type { SQLiteDatabase } from "expo-sqlite";
import type { Storage, Change } from "./storage";

type Connection = Pick<
  SQLiteDatabase,
  "execAsync" | "runAsync" | "getFirstAsync" | "getAllAsync"
>;

/** Owns one already-unlocked connection. Every operation uses the same queue. */
export function sqliteStorage(db: Connection): Storage {
  let tail: Promise<unknown> = Promise.resolve();
  let unusable = false;
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(() => {
      if (unusable) throw new Error("storageUnavailable");
      return operation();
    });
    tail = result.catch(() => {});
    return result;
  }
  return {
    get<T>(key: string) {
      return serial(async () => {
        const row = await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM records WHERE key=?",
          key,
        );
        return row ? (JSON.parse(row.value) as T) : null;
      });
    },
    list<T>(prefix: string) {
      return serial(async () => {
        const rows = await db.getAllAsync<{ value: string }>(
          "SELECT value FROM records WHERE key>=? AND key<? ORDER BY key",
          prefix,
          prefix + "\uffff",
        );
        return rows.map((row) => JSON.parse(row.value) as T);
      });
    },
    batch(changes: Change[]) {
      return serial(async () => {
        // Expo's exclusive transaction helper opens another, unkeyed SQLCipher
        // connection. Use this connection and serialize reads as well as writes
        // so no unrelated operation can join this transaction.
        await db.execAsync("BEGIN IMMEDIATE");
        try {
          for (const change of changes) {
            if (change.value === null)
              await db.runAsync("DELETE FROM records WHERE key=?", change.key);
            else
              await db.runAsync(
                "INSERT INTO records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                change.key,
                JSON.stringify(change.value),
              );
          }
          await db.execAsync("COMMIT");
        } catch (error) {
          try {
            await db.execAsync("ROLLBACK");
          } catch {
            unusable = true;
          }
          throw error;
        }
      });
    },
  };
}
