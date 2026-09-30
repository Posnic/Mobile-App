import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Item, Shop } from "../domain/types";

export interface ImageFiles {
  get(key: string): Promise<string | null>;
  put(key: string, bytes: Uint8Array, mime: string): Promise<string>;
  prune?(keep: Set<string>): Promise<void>;
}
export const imageKey = (scope: string, url: string, revision = "") =>
  bytesToHex(sha256(utf8ToBytes(JSON.stringify([scope, url, revision]))));
export function productImageUrl(value: string, base: string): string | null {
  try {
    const url = new URL(
      value.startsWith("/uploads/") ? base.replace(/\/$/, "") + value : value,
      base + "/",
    );
    const origin = new URL(base);
    if (
      url.username ||
      url.password ||
      !["https:", "http:"].includes(url.protocol)
    )
      return null;
    if (url.protocol === "http:" && url.origin !== origin.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}
const MAX_BYTES = 2 * 1024 * 1024;
export async function readImage(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(url, {
    signal,
    credentials: "omit",
    redirect: "error",
  });
  const mime =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  if (
    !response.ok ||
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime) ||
    Number(response.headers.get("content-length")) > MAX_BYTES
  )
    throw Error("invalidImage");
  const reader = response.body?.getReader();
  if (!reader) throw Error("invalidImage");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw Error("cancelled");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error("invalidImage");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!size) throw Error("invalidImage");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const starts = (...signature: number[]) =>
    signature.every((b, i) => bytes[i] === b);
  const valid =
    mime === "image/png"
      ? starts(137, 80, 78, 71, 13, 10, 26, 10)
      : mime === "image/jpeg"
        ? starts(255, 216, 255)
        : mime === "image/gif"
          ? starts(71, 73, 70, 56) &&
            [55, 57].includes(bytes[4]!) &&
            bytes[5] === 97
          : starts(82, 73, 70, 70) &&
            bytes.slice(8, 12).join(",") === "87,69,66,80";
  if (!valid) throw Error("invalidImage");
  return { bytes, mime };
}

/** Completed images survive restart; failed/partial files are never published. */
export async function cacheProductImages(
  items: Item[],
  shop: Shop,
  files: ImageFiles,
  signal: AbortSignal,
  onImage: (id: string, uri: string) => void,
  fetcher: typeof fetch = fetch,
) {
  if (!shop.baseUrl || shop.mode !== "live") return;
  const scope = JSON.stringify([shop.baseUrl, shop.id, shop.branchId]);
  const missing: { item: Item; url: string; key: string }[] = [];
  const keep = new Set<string>();
  let inspected = 0;
  for (const item of items) {
    if (++inspected % 64 === 0)
      await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal.aborted) return;
    const url = item.image && productImageUrl(item.image, shop.baseUrl);
    if (!url) continue;
    const key = imageKey(scope, url, item.imageRevision);
    keep.add(key);
    const saved = await files.get(key).catch(() => null);
    if (saved) onImage(item.id, saved);
    else missing.push({ item, url, key });
  }
  if (signal.aborted) return;
  await files.prune?.(keep).catch(() => {});
  // Two transfers maximum. Images never hold up sale upload or catalogue activation.
  let next = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (!signal.aborted && next < missing.length) {
        const entry = missing[next++]!;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal.addEventListener("abort", cancel, { once: true });
        const timeout = setTimeout(cancel, 12000);
        try {
          const { bytes, mime } = await readImage(
            entry.url,
            controller.signal,
            fetcher,
          );
          if (signal.aborted) return;
          const uri = await files.put(entry.key, bytes, mime);
          if (!signal.aborted) onImage(entry.item.id, uri);
        } catch {
          /* Keep the item's configured icon. Retry missing images on reconnect. */
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener("abort", cancel);
        }
      }
    }),
  );
}
