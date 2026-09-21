import type { Storage, Change } from "./storage";
/** Browser preview uses IndexedDB transactions. Native tills use encrypted SQLite. */
export async function openStorage(): Promise<Storage> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("posnic-preview", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {
    get<T>(key: string) {
      return new Promise<T | null>((resolve, reject) => {
        const q = db.transaction("records").objectStore("records").get(key);
        q.onsuccess = () => resolve(q.result ?? null);
        q.onerror = () => reject(q.error);
      });
    },
    list<T>(prefix: string) {
      return new Promise<T[]>((resolve, reject) => {
        const q = db
          .transaction("records")
          .objectStore("records")
          .getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    },
    batch(changes: Change[]) {
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        const store = tx.objectStore("records");
        for (const c of changes) {
          if (c.value === null) store.delete(c.key);
          else store.put(c.value, c.key);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("storageUnavailable"));
      });
    },
  };
}
