import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { LocalAuthorization, CloudAuthorization } from "./cloudGrant";
import { localAuthorizations } from "./cloudGrant";
export function verifyEnrolment(
  target: LocalAuthorization,
  nonce: string,
  answer: unknown,
) {
  if (!target.code || !target.enrolmentId || !/^[\w-]{43}$/.test(nonce))
    throw Error("authorizationExpired");
  const secret = bytesToHex(sha256(utf8ToBytes(target.code)));
  const expected = bytesToHex(
    hmac(sha256, utf8ToBytes(secret), utf8ToBytes(nonce)),
  );
  if (
    !answer ||
    typeof answer !== "object" ||
    !("proof" in answer) ||
    answer.proof !== expected
  )
    throw Error("invalidServer");
}
export async function refreshLocalAuthorizations(
  auth: CloudAuthorization,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CloudAuthorization> {
  if (!auth.connectionToken || Date.now() - auth.updatedAt < 120000)
    return auth;
  const ctrl = new AbortController(),
    abort = () => ctrl.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  try {
    if (signal.aborted) throw Error("authorizationCancelled");
    const response = await fetcher(
      "https://www.posnic.com/api/mobile/connections",
      {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionToken: auth.connectionToken,
          codeVerifier: auth.verifier,
          connectedDevices: [],
        }),
        signal: ctrl.signal,
      },
    );
    if (!response.ok)
      throw Error(
        response.status === 401 || response.status === 403
          ? "authorizationExpired"
          : "networkError",
      );
    const data = await response.json();
    if (data.baseUrl !== auth.baseUrl) throw Error("invalidServer");
    return {
      ...auth,
      localServers: localAuthorizations(data.localServers),
      updatedAt: Date.now(),
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
