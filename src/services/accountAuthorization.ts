import * as Crypto from "expo-crypto";
import { z } from "zod";
import { credentials } from "../platform/credentials";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const ACCOUNT_ORIGIN = "https://www.posnic.com";
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function base64url(bytes: Uint8Array): string {
  let value = 0,
    bits = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += alphabet[(value >>> bits) & 63];
    }
  }
  if (bits) result += alphabet[(value << (6 - bits)) & 63];
  return result;
}
export async function authorizeAccount(
  intent: "login" | "signup",
  openBrowser: (url: string, matchCode: string) => Promise<void>,
  signal: AbortSignal,
) {
  const verifier = base64url(await Crypto.getRandomBytesAsync(32));
  const codeChallenge = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 },
    )
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  async function post(path: string, body: unknown) {
    if (signal.aborted) throw new Error("authorizationCancelled");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 15000);
    try {
      const response = await fetch(ACCOUNT_ORIGIN + "/api/mobile/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
      if (response.status === 404) throw new Error("accountServiceUnavailable");
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error === "access_denied"
            ? "authorizationCancelled"
            : "authorizationExpired",
        );
      return data;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  const request = z
    .object({
      request: z.string().regex(/^[\w-]{43}$/),
      authorizationUrl: z.string().url(),
      expiresIn: z.number().positive().max(900),
    })
    .parse(
      await post("requests", {
        codeChallenge,
        deviceId: await credentials.deviceId(),
        deviceName: "Posnic Mobile POS",
        intent,
      }),
    );
  const url = new URL(request.authorizationUrl);
  if (url.origin !== ACCOUNT_ORIGIN || url.pathname !== "/api/mobile/authorize")
    throw new Error("invalidServer");
  await openBrowser(url.href, request.request.slice(-6).toUpperCase());
  const expires = Date.now() + request.expiresIn * 1000;
  while (Date.now() < expires && !signal.aborted) {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, 5000);
      signal.addEventListener("abort", finish, { once: true });
    });
    const data = await post("token", {
      request: request.request,
      codeVerifier: verifier,
    });
    if (data.error === "authorization_pending") continue;
    const grant = z
      .object({
        baseUrl: z.string().url(),
        code: z.string().regex(/^[A-F0-9]{12}$/),
        localServers: z
          .array(
            z.object({
              name: z.string(),
              addresses: z.array(z.string()).max(8),
              code: z.string().regex(/^[A-F0-9]{12}$/),
              enrolmentId: z.string().uuid(),
            }),
          )
          .max(8)
          .default([]),
      })
      .parse(data);
    const endpoint = new URL(grant.baseUrl);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error("invalidServer");
    // Pick the sale authority once at onboarding. Never move an outbox from
    // one server to another: their idempotency journals are independent.
    const local = await findAuthorizedTill(grant.localServers, signal);
    return {
      baseUrl: local?.baseUrl || grant.baseUrl,
      code: local?.code || grant.code,
      verifier,
    };
  }
  throw new Error(
    signal.aborted ? "authorizationCancelled" : "authorizationExpired",
  );
}

export function privateApiAddress(value: string) {
  try {
    const u = new URL(value),
      p = u.hostname.split(".").map(Number);
    return (
      u.protocol === "http:" &&
      u.pathname === "/api" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      Number(u.port) >= 1024 &&
      Number(u.port) <= 65535 &&
      u.href === value &&
      p.length === 4 &&
      p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (p[0] === 10 ||
        (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) ||
        (p[0] === 192 && p[1] === 168))
    );
  } catch {
    return false;
  }
}
async function findAuthorizedTill(
  servers: Array<{ addresses: string[]; code: string; enrolmentId: string }>,
  signal: AbortSignal,
) {
  if (!servers.length) return null;
  const candidates = servers.flatMap((server) =>
    server.addresses
      .filter(privateApiAddress)
      .map((baseUrl) => ({ ...server, baseUrl })),
  );
  const until = Date.now() + 22000;
  while (Date.now() < until && !signal.aborted) {
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        const controller = new AbortController(),
          abort = () => controller.abort();
        const timer = setTimeout(abort, 1500);
        signal.addEventListener("abort", abort, { once: true });
        try {
          const nonce = base64url(await Crypto.getRandomBytesAsync(32));
          const response = await fetch(
            candidate.baseUrl + "/mobile/v1/enrolment-proof",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              redirect: "error",
              signal: controller.signal,
              body: JSON.stringify({
                enrolmentId: candidate.enrolmentId,
                nonce,
              }),
            },
          );
          if (!response.ok) return null;
          const data = await response.json();
          // Prove that this address is the enrolled till before releasing the
          // phone's proof or pairing code. An old DHCP address cannot impersonate it.
          const expected = bytesToHex(
            hmac(
              sha256,
              utf8ToBytes(bytesToHex(sha256(utf8ToBytes(candidate.code)))),
              utf8ToBytes(nonce),
            ),
          );
          return data.proof === expected ? candidate : null;
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
        }
      }),
    );
    const found = results.find(Boolean);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (signal.aborted) throw new Error("authorizationCancelled");
  return null;
}
